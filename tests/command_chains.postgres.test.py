#!/usr/bin/env python3
"""E2E de las CADENAS DE ESCRITURA contra Postgres real (appointments#16).

Lo que esta batería cubre, y por qué no lo cubre nada más:

`cargo test` prueba el handler WASM, que es lógica PURA — decide y devuelve *intenciones*. Los
contract tests prueban que el manifest cablea esas intenciones. Entre las dos cosas queda el trozo
donde de verdad se escribe: las sentencias SQL que el runtime ejecuta en UNA transacción. Ahí viven
tres invariantes que ningún test de Rust puede ver caerse:

  1. **El número de cita** (`APT-YYYYMMDD-NNNN`) se calcula leyendo el contador recién incrementado
     EN LA MISMA transacción. Este es el sitio donde ya nos mordió una vez: el `last_number` sin
     cualificar del `DO UPDATE` era AMBIGUO en Postgres y NINGUNA cita se podía crear en producción
     (QA 2026-07-16). Y el contador es POR HUB: el primer cliente del vecino también empieza en 0001.
  2. **Las dos guardas de `reschedule`** (appointments#20/#10) son tablas-gate con `CHECK (ok = 1)`:
     mover una cita terminal, o encima de otra de la misma profesional, tiene que **abortar la
     transacción entera**, no devolver un OK silencioso. Un gate que nunca dispara es indistinguible
     de un gate que funciona hasta que un cliente pierde su hora.
  3. **El historial se escribe DESPUÉS y atado al run** (`updated_at = :now`): una reprogramación
     rechazada no puede dejar rastro de un movimiento que no ocurrió.

Se ejecutan las MISMAS sentencias que emite el handler, en el MISMO orden, con los binds que pone
el runtime (`:hub_id`, `:current_user_id`, `:now`, `:new_id`) — leídas del propio `module.json`,
así que si alguien reordena la cadena o renombra un fichero, esto se entera.

Usage: tests/command_chains.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  scratch database and DROPS it at the end, pass or fail. Without the container the Postgres layer
  is SKIPPED, never passed.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_command_chains_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"

# The intention chains the WASM handler emits, as commands. The SQL files come from the manifest.
CREATE_CHAIN = [
    "appointments._bump_counter",
    "appointments._insert_appointment",
    "appointments._insert_history",
]
RESCHEDULE_CHAIN = [
    "appointments._reschedule_state_assert",
    "appointments._reschedule_row",
    "appointments._gate_clear",
]
# The gate table's drain (appointments#116). It is the last link of every chain that uses a gate,
# so the table is empty once the command commits.
GATE_CLEAR = "appointments._gate_clear"
# `appointments.appointments.update` is DECLARATIVE: its chain is the manifest's own `sql[]`, and
# it writes the same gate table through `_appointment_overlap_assert`.
UPDATE_CHAIN = ["appointments.appointments.update"]

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def statements_of(command: str) -> list[str]:
    """Every statement of a command, in manifest order.

    A command may chain several files — `appointments.appointments.update`, and the internal
    `_reschedule_row`, whose row UPDATE, overlap gate and history line have to share one `:now`
    (appointments#196) — and the runtime runs them in that order inside one transaction, bound
    with ONE set of params — so the battery has to as well.
    """
    files = (MANIFEST.get("commands", {}).get(command) or {}).get("sql") or []
    if not files:
        fail(f"{command}: the manifest declares no sql chain")
        return []
    return [(MODULE_DIR / f).read_text() for f in files]


# ── Postgres plumbing ────────────────────────────────────────────────────────────────────


def docker_available() -> bool:
    try:
        res = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return False
    return res.returncode == 0 and res.stdout.strip() == "true"


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
    ]
    if db:
        cmd += ["-d", db]
    cmd += args
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def _call_args(sql: str, start: int) -> tuple[list[str], int]:
    """Splits the arguments of a call whose `(` is at `start`, honouring nesting and quotes.

    `erp_pad`'s first argument is a whole SUBQUERY in `_insert_appointment.sql`, so a regex over
    `[^()]*` reads it wrong and Postgres answers «function erp_pad(integer, integer) does not
    exist» — exactly the kind of shim mismatch this battery must not paper over.
    """
    depth, args, buf, i, quoted = 0, [], "", start, False
    while i < len(sql):
        c = sql[i]
        if quoted:
            buf += c
            if c == "'":
                quoted = False
        elif c == "'":
            quoted = True
            buf += c
        elif c == "(":
            depth += 1
            if depth > 1:
                buf += c
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(buf)
                return args, i + 1
            buf += c
        elif c == "," and depth == 1:
            args.append(buf)
            buf = ""
        else:
            buf += c
        i += 1
    raise ValueError("unbalanced call")


def pad_min_width(a: list[str]) -> str:
    """What the runtime emits TODAY (hub#1378): the width is a floor, so a value longer than it
    survives WHOLE — mirror of `hub/crates/db/src/lib.rs::pad_to_min_width`."""
    return f"lpad(({a[0]})::text, greatest({a[1]}, length(({a[0]})::text)), '0')"


def pad_truncating(a: list[str]) -> str:
    """What the runtime emitted BEFORE hub#1378 — a bare `lpad`, an EXACT width. Exists ONLY so
    `check_control_still_sees_the_bug` below can prove this harness still sees the bug
    (`lpad('10000', 4, '0')` = `'1000'`); nothing else in this file should use it."""
    return f"lpad(({a[0]})::text, {a[1]}, '0')"


def shim(sql: str, pad=pad_min_width) -> str:
    """Bridge functions (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs::shim_functions`."""
    forms = {
        "erp_pad": pad,
        "erp_dt": lambda a: f"(({a[0]})::timestamptz)",
        "erp_date": lambda a: f"(({a[0]})::date)",
    }
    for name, render in forms.items():
        while True:
            m = re.search(rf"\b{name}\(", sql)
            if not m:
                break
            args, end = _call_args(sql, m.end() - 1)
            sql = sql[: m.start()] + render(args) + sql[end:]
    return sql


def op_params(params: dict, index: int) -> dict:
    """The params ONE operation of the chain is bound with, the way the runtime binds them.

    The runtime mints the system params once PER OPERATION a WASM handler returns (`system_params`
    inside the loop over `output.operations`, `crates/runtime/src/commands.rs`): each operation
    gets its own `:now`, microseconds apart. Binding one `:now` for the whole chain — what this
    battery used to do — is what hid appointments#196: a history line pinned to
    `updated_at = :now` in an operation of its own matched in here and nothing in the real hub.
    Statements of the SAME command still share one `:now`, as they do in the runtime.
    """
    now = params.get("now")
    if not now or len(now) < 19:
        return params
    return {**params, "now": f"{now[:19]}.{index:06d}{now[19:]}"}


def run_chain(commands: list[str], params: dict, pad=pad_min_width) -> str | None:
    """Runs a whole intention chain in ONE transaction, like the runtime does.

    Returns None when it committed, or the Postgres error when the transaction aborted — which is
    how a gate with `CHECK (ok = 1)` refuses.
    """
    body = "\n".join(
        shim(bind(stmt, op_params(params, i)), pad)
        for i, c in enumerate(commands)
        for stmt in statements_of(c)
    )
    try:
        psql([], db=DB, stdin=f"BEGIN;\n{body}\nCOMMIT;\n")
        return None
    except RuntimeError as e:
        return str(e)


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def rows(sql: str) -> list[dict]:
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({sql}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


# ── The scenarios ────────────────────────────────────────────────────────────────────────

NOW = "2026-08-20T09:00:00+02:00"


def booking(
    hub: str, appointment_id: str, day: str, start: str, minutes: int, **extra
) -> dict:
    """The params the handler hands to the create chain, plus the runtime's system params."""
    p = {
        "hub_id": hub,
        "current_user_id": "u-owner",
        "now": NOW,
        "new_id": f"n-{appointment_id}",
        "appointment_id": appointment_id,
        "day": day,
        "customer_id": "c1",
        "customer_name": "Ada Lovelace",
        "customer_phone": "+34600000001",
        "customer_email": "ada@example.com",
        "staff_id": "s1",
        "staff_name": "Bea Pro",
        "service_id": "s-corte",
        "service_name": "Corte",
        "service_price": 2000,
        "start_datetime": start,
        "end_datetime": f"{start[:11]}{int(start[11:13]) + 1:02}{start[13:]}",
        "duration_minutes": minutes,
        "status": "pending",
        "notes": "",
        "internal_notes": "",
        "booked_online": 0,
        "recurring_id": None,
        "occurrence_date": None,
        "action": "created",
        "description": "Cita creada",
        "old_value": None,
        "new_value": "{}",
    }
    p.update(extra)
    return p


def check_create_chain() -> None:
    """The appointment number is computed in the same transaction, and the counter is PER HUB."""
    first = booking(HUB, "a-1", "20260820", "2026-08-20T11:00:00+02:00", 30)
    second = booking(HUB, "a-2", "20260820", "2026-08-20T13:00:00+02:00", 30)
    neighbour = booking(OTHER_HUB, "a-n1", "20260820", "2026-08-20T11:00:00+02:00", 30)
    series = booking(
        HUB,
        "a-3",
        "20260820",
        "2026-08-21T11:00:00+02:00",
        30,
        recurring_id="r1",
        occurrence_date="2026-08-21",
    )

    for params in (first, second, neighbour, series):
        err = run_chain(CREATE_CHAIN, params)
        if err:
            fail(f"create chain for {params['appointment_id']} aborted: {err}")
            return

    got = {
        r["id"]: r["appointment_number"]
        for r in rows(
            f"SELECT id, appointment_number FROM appointments_appointment WHERE hub_id = '{HUB}'"
        )
    }
    want = {
        "a-1": "APT-20260820-0001",
        "a-2": "APT-20260820-0002",
        "a-3": "APT-20260820-0003",
    }
    if got != want:
        fail(f"appointment numbers: got {got}, expected {want}")

    neighbour_number = scalar(
        f"SELECT appointment_number FROM appointments_appointment WHERE id = 'a-n1'"
    )
    if neighbour_number != "APT-20260820-0001":
        fail(
            "the counter is not per hub: the neighbour's first appointment got "
            f"{neighbour_number!r} instead of APT-20260820-0001"
        )

    # The snapshot and the series stamp landed on the row (appointments#11/#54/#15).
    row = rows(
        "SELECT customer_name, service_price, recurring_id, occurrence_date, status "
        "FROM appointments_appointment WHERE id = 'a-3'"
    )[0]
    if row["customer_name"] != "Ada Lovelace" or row["service_price"] != 2000:
        fail(f"the frozen snapshot did not land: {row!r}")
    if (row["recurring_id"], row["occurrence_date"]) != ("r1", "2026-08-21"):
        fail(f"the series stamp did not land: {row!r}")
    if row["status"] != "pending":
        fail(f"a new appointment must be born `pending`, got {row['status']!r}")

    history = scalar(
        "SELECT count(*) FROM appointments_history WHERE action = 'created' AND hub_id = '"
        + HUB
        + "'"
    )
    if history != "3":
        fail(f"the create chain wrote {history} history rows for 3 appointments")


def reschedule_params(
    appointment_id: str,
    start: str,
    end: str,
    minutes: int,
    now: str,
    channel: str | None = None,
) -> dict:
    return {
        "channel": channel,
        "hub_id": HUB,
        "current_user_id": "u-owner",
        "now": now,
        "new_id": f"h-{appointment_id}-{now}",
        "appointment_id": appointment_id,
        "start_datetime": start,
        "end_datetime": end,
        "duration_minutes": minutes,
    }


def check_reschedule_chain() -> None:
    """The two gates abort the transaction; the history never records a move that did not happen."""
    # Happy path: a-1 (11:00) moves to 16:00.
    err = run_chain(
        RESCHEDULE_CHAIN,
        reschedule_params(
            "a-1",
            "2026-08-20T16:00:00+02:00",
            "2026-08-20T16:30:00+02:00",
            30,
            "2026-08-20T09:10:00+02:00",
            channel="customer",
        ),
    )
    if err:
        fail(f"a legitimate reschedule was refused: {err}")
    moved = scalar(
        "SELECT start_datetime FROM appointments_appointment WHERE id = 'a-1'"
    )
    if not moved.startswith("2026-08-20T16:00"):
        fail(f"the appointment did not move: start_datetime = {moved!r}")
    trail = scalar(
        "SELECT count(*) FROM appointments_history WHERE action = 'rescheduled'"
    )
    if trail != "1":
        fail(f"the reschedule wrote {trail} history rows, expected 1")
    # appointments#145: the trail says WHO asked for the move, like the cancel line does.
    raw = scalar(
        "SELECT new_value FROM appointments_history WHERE action = 'rescheduled'"
    )
    try:
        stamped = json.loads(raw)
    except json.JSONDecodeError:
        stamped = {}
        fail(f"the reschedule history new_value is not JSON: {raw!r}")
    if stamped.get("channel") != "customer":
        fail(
            f"the reschedule history new_value.channel is {stamped.get('channel')!r}, "
            "expected 'customer'"
        )
    if not str(stamped.get("start_datetime", "")).startswith("2026-08-20T16:00"):
        fail(f"the reschedule history lost the landing slot: {raw!r}")

    # The overlap gate: a-1 back onto a-2's slot (13:00, same professional) must ABORT.
    err = run_chain(
        RESCHEDULE_CHAIN,
        reschedule_params(
            "a-1",
            "2026-08-20T13:15:00+02:00",
            "2026-08-20T13:45:00+02:00",
            30,
            "2026-08-20T09:20:00+02:00",
        ),
    )
    if err is None:
        fail(
            "the overlap gate did NOT fire: an appointment was moved on top of another of the same "
            "professional and the transaction committed"
        )
    still = scalar(
        "SELECT start_datetime FROM appointments_appointment WHERE id = 'a-1'"
    )
    if not still.startswith("2026-08-20T16:00"):
        fail(f"a refused reschedule moved the row anyway: {still!r}")
    trail = scalar(
        "SELECT count(*) FROM appointments_history WHERE action = 'rescheduled'"
    )
    if trail != "1":
        fail(f"a refused reschedule left a history row ({trail} rows)")

    # The state gate: a cancelled appointment cannot be moved, and does not answer OK in silence.
    psql(
        [
            "-c",
            "UPDATE appointments_appointment SET status = 'cancelled' WHERE id = 'a-2'",
        ],
        db=DB,
    )
    err = run_chain(
        RESCHEDULE_CHAIN,
        reschedule_params(
            "a-2",
            "2026-08-22T11:00:00+02:00",
            "2026-08-22T11:30:00+02:00",
            30,
            "2026-08-20T09:30:00+02:00",
        ),
    )
    if err is None:
        fail("the state gate did NOT fire: a cancelled appointment was rescheduled")
    still = scalar(
        "SELECT start_datetime FROM appointments_appointment WHERE id = 'a-2'"
    )
    if not still.startswith("2026-08-20T13:00"):
        fail(f"a cancelled appointment was moved anyway: {still!r}")

    # With `allow_overlapping = 1` the business said yes: the same move is accepted.
    psql(
        [
            "-c",
            "INSERT INTO appointments_settings (id, hub_id, allow_overlapping, is_deleted, "
            f"created_at) VALUES ('st-1', '{HUB}', 1, 0, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )
    psql(
        [
            "-c",
            "UPDATE appointments_appointment SET status = 'confirmed' WHERE id = 'a-2'",
        ],
        db=DB,
    )
    err = run_chain(
        RESCHEDULE_CHAIN,
        reschedule_params(
            "a-1",
            "2026-08-20T13:15:00+02:00",
            "2026-08-20T13:45:00+02:00",
            30,
            "2026-08-20T09:40:00+02:00",
        ),
    )
    if err is not None:
        fail(f"with allow_overlapping = 1 the move must be accepted, got: {err}")


def check_number_survives_the_ten_thousandth_of_the_day() -> None:
    """The width `erp_pad` takes is a MINIMUM, never a ceiling (appointments#111). Postgres' bare
    `lpad` imposes an EXACT width and CUTS what does not fit; the kernel fixed that (hub#1378,
    `lpad(v, greatest(width, length(v)), fill)`) so a real create never truncates. This is the
    harness's own mirror of that lowering (`shim`, above) staying true to it: with the counter
    parked at 9999 the 10.000th appointment of the day must come back as `APT-<day>-10000`
    WHOLE, not cut down to the four digits `_insert_appointment.sql` asks for."""
    day = "20260901"
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment_counter (id, hub_id, day, last_number) "
            f"VALUES ('cnt-{day}', '{HUB}', '{day}', 9999)",
        ],
        db=DB,
    )
    params = booking(HUB, "a-10000", day, "2026-09-01T09:00:00+02:00", 30)
    err = run_chain(CREATE_CHAIN, params)
    if err:
        fail(f"the ten-thousandth appointment of the day was refused: {err}")
        return
    number = scalar(
        "SELECT appointment_number FROM appointments_appointment WHERE id = 'a-10000'"
    )
    want = f"APT-{day}-10000"
    if number != want:
        fail(
            f"the ten-thousandth appointment number came back {number!r}, expected {want!r}"
        )


def check_control_still_sees_the_bug() -> None:
    """THE CONTROL (appointments#111): put the pre-hub#1378 lowering back and demand the SAME
    border break the SAME way. The two checks above are green because `shim` mirrors the kernel's
    CURRENT lowering — that mirror had drifted before (this issue), and if it drifts again every
    green above goes silently worthless. `pad_truncating` is that old mirror; run through it, the
    ten-thousandth appointment of a day must still come back cut to `APT-<day>-1000`, exactly the
    symptom appointments#111 reported."""
    day = "20260902"
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment_counter (id, hub_id, day, last_number) "
            f"VALUES ('cnt-{day}', '{HUB}', '{day}', 9999)",
        ],
        db=DB,
    )
    params = booking(HUB, "a-control-10000", day, "2026-09-02T09:00:00+02:00", 30)
    err = run_chain(CREATE_CHAIN, params, pad=pad_truncating)
    if err:
        fail(
            f"the control scenario aborted instead of writing a truncated number: {err}"
        )
        return
    number = scalar(
        "SELECT appointment_number FROM appointments_appointment WHERE id = 'a-control-10000'"
    )
    want = f"APT-{day}-1000"
    if number != want:
        fail(
            "the control lowering did not truncate — this harness can no longer see the erp_pad "
            f"bug: got {number!r}, expected the truncated {want!r}"
        )


def check_the_gate_table_is_drained() -> None:
    """`appointments__gate` is scratch space for ONE command run, not a log (appointments#116).

    Every assert that PASSES inserts `(gate, 1)` and the command commits, so with nothing to drain
    the table the row stays for good: two per reschedule, one per update, for ever. Only the `ok = 0`
    row disappears, and only because its own transaction is rolled back.

    `verifactu` already solved this — `commands/_gate_clear.sql` is the last link of the `sql[]`
    chain of every command that uses a gate — and this pins the same contract for appointments
    where it is actually executed: after a run that COMMITS the table is empty, and after a run the
    gate REFUSES it is empty too (the rollback takes the refusing row with it).
    """
    psql(
        [], db=DB, stdin="DELETE FROM appointments__gate;"
    )  # a known floor, whatever ran before

    # A reschedule that passes both gates: a-1 to a day nobody else uses.
    err = run_chain(
        RESCHEDULE_CHAIN,
        reschedule_params(
            "a-1",
            "2026-08-25T10:00:00+02:00",
            "2026-08-25T10:30:00+02:00",
            30,
            "2026-08-20T10:00:00+02:00",
        ),
    )
    if err:
        fail(f"the drain scenario's reschedule was refused: {err}")
        return
    left = scalar("SELECT count(*) FROM appointments__gate")
    if left != "0":
        fail(
            f"a committed reschedule left {left} row(s) in appointments__gate - the gate table is "
            "not drained and grows for ever (appointments#116)"
        )

    # A reschedule the state gate refuses: an id that does not exist is not reschedulable.
    err = run_chain(
        RESCHEDULE_CHAIN,
        reschedule_params(
            "a-does-not-exist",
            "2026-08-25T12:00:00+02:00",
            "2026-08-25T12:30:00+02:00",
            30,
            "2026-08-20T10:10:00+02:00",
        ),
    )
    if err is None:
        fail("the state gate did NOT fire for an appointment that does not exist")
        return
    left = scalar("SELECT count(*) FROM appointments__gate")
    if left != "0":
        fail(f"a refused reschedule left {left} row(s) in appointments__gate")

    # The other consumer of the gate is the DECLARATIVE chain of `appointments.appointments.update`,
    # whose overlap assert writes the very same table.
    err = run_chain(
        UPDATE_CHAIN,
        booking(
            HUB,
            "a-1",
            "20260825",
            "2026-08-25T10:00:00+02:00",
            30,
            now="2026-08-20T10:20:00+02:00",
            notes="edited",
            # The runtime mints a fresh `:new_id` per command; since appointments#260 the edit
            # writes a history line with it, so it cannot reuse the one the create chain took.
            new_id="n-a-1-edit",
        ),
    )
    if err:
        fail(f"a legitimate update was refused: {err}")
        return
    left = scalar("SELECT count(*) FROM appointments__gate")
    if left != "0":
        fail(
            f"a committed update left {left} row(s) in appointments__gate - the declarative chain "
            "is not drained (appointments#116)"
        )


def check_control_still_sees_the_accumulation() -> None:
    """THE CONTROL: a battery that only ever asserts «the table is empty» passes just as well when
    it has stopped looking. Run the SAME reschedule with the drain link taken out of the chain and
    demand the rows the issue reported — two, one per gate. If this stops failing, the check above
    proves nothing."""
    psql([], db=DB, stdin="DELETE FROM appointments__gate;")
    without_drain = [c for c in RESCHEDULE_CHAIN if c != GATE_CLEAR]
    if without_drain == RESCHEDULE_CHAIN:
        fail(
            f"the control cannot remove `{GATE_CLEAR}`: it is not in the reschedule chain"
        )
        return
    err = run_chain(
        without_drain,
        reschedule_params(
            "a-1",
            "2026-08-26T10:00:00+02:00",
            "2026-08-26T10:30:00+02:00",
            30,
            "2026-08-20T10:30:00+02:00",
        ),
    )
    if err:
        fail(f"the control scenario's reschedule was refused: {err}")
        return
    left = scalar("SELECT count(*) FROM appointments__gate")
    if left != "2":
        fail(
            "the control no longer sees the accumulation: without the drain link a passing "
            f"reschedule left {left} row(s), expected the 2 the two gates insert"
        )
    psql([], db=DB, stdin="DELETE FROM appointments__gate;")


def check_against_postgres() -> None:
    if failures:
        return
    if not docker_available():
        notes.append(f"SKIPPED Postgres layer: container {CONTAINER!r} is not running")
        return

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for entry in MANIFEST.get("migrations", {}).get("postgres", []):
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
        check_create_chain()
        if not failures:
            check_reschedule_chain()
        if not failures:
            check_number_survives_the_ten_thousandth_of_the_day()
        if not failures:
            check_control_still_sees_the_bug()
        if not failures:
            check_the_gate_table_is_drained()
        if not failures:
            check_control_still_sees_the_accumulation()
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def check_chains_are_declared() -> None:
    for command in CREATE_CHAIN + RESCHEDULE_CHAIN + UPDATE_CHAIN:
        if not isinstance(MANIFEST.get("commands", {}).get(command), dict):
            fail(
                f"{command}: the handler emits it as an intention but it is not a declared command"
            )


def main() -> int:
    check_chains_are_declared()
    check_against_postgres()
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("ok: the create and reschedule chains, run against real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
