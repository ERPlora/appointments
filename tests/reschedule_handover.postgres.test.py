#!/usr/bin/env python3
"""Handing ONE appointment to another professional or service from the agenda — regression of
ERPlora/appointments#263.

The agenda could only move the hour: `reschedule` wrote the slot and nothing else, so a client who
asked for Carla instead of Bea, or for colour on top of the cut, had to be cancelled and booked
again. Since #263 the handler resolves the new professional / service and binds them to
`_reschedule_row`; this battery runs that command's WHOLE `sql[]` in ONE transaction with the binds
the handler emits (the way the runtime runs one WASM operation) and holds:

  - a hand-over writes Carla on the row (id and name), keeps the service and its price, and leaves
    ONE «staff_changed» line from Bea to Carla;
  - a service change writes the new service, its name and its price, keeps the professional, and
    leaves ONE «service_changed» line;
  - a plain move (empty `staff_id` / `service_id`) keeps both and leaves a «rescheduled» line;
  - a hand-over onto Carla's taken slot is refused by the overlap gate: the row keeps Bea and no
    line is written;
  - the WHERE is the hub's: the same command bound with another hub never touches its row.

Usage: tests/reschedule_handover.postgres.test.py   (exit 0 = green)
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
DB = f"appointments_reschedule_handover_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
COMMAND = "appointments._reschedule_row"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def chain_files() -> list[str]:
    files = (MANIFEST.get("commands", {}).get(COMMAND) or {}).get("sql") or []
    return [files] if isinstance(files, str) else list(files)


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


def shim(sql: str) -> str:
    """Bridge functions (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs::shim_functions`."""
    forms = {
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


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def rows(sql: str) -> list[dict]:
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({sql}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


# ── Scenarios ────────────────────────────────────────────────────────────────────────────

SEQ = [0]


def seed(
    id_: str,
    hub: str = HUB,
    staff: tuple[str, str] = ("s1", "Bea"),
    start: str = "2026-09-10T11:00:00+02:00",
    end: str = "2026-09-10T11:30:00+02:00",
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, "
            "is_deleted, created_at, updated_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', '', '', "
            f"{literal(staff[0])}, {literal(staff[1])}, 's-corte', 'Corte', 2000, "
            f"{literal(start)}, {literal(end)}, 30, 'confirmed', '', '', 0, 0, '', 0, "
            "'2026-09-01T00:00:00+02:00', '2026-09-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def move(appointment_id: str, hub: str = HUB, **changes) -> str | None:
    """`_reschedule_row` as the handler emits it: the slot, the hand-over (empty = keeps it) and
    what the appointment HAD (from its row), plus the runtime's system params — ONE `:now` for
    the whole `sql[]`, as the runtime binds one WASM operation. None = committed, else the error."""
    SEQ[0] += 1
    params = {
        "appointment_id": appointment_id,
        "start_datetime": "2026-09-10T16:00:00+02:00",
        "end_datetime": "2026-09-10T16:30:00+02:00",
        "duration_minutes": 30,
        "channel": "staff",
        "staff_id": "",
        "staff_name": "",
        "service_id": "",
        "service_name": "",
        "service_price": 0,
        "from_staff_id": "s1",
        "from_staff_name": "Bea",
        "from_service_id": "s-corte",
        "from_service_name": "Corte",
        "from_start_datetime": "2026-09-10T11:00:00+02:00",
        "hub_id": hub,
        "current_user_id": "u-front",
        "now": f"2026-09-20T09:00:00.{SEQ[0]:06d}+02:00",
        "new_id": f"h-move-{SEQ[0]}",
    }
    params.update(changes)
    body = "\n".join(
        shim(bind((MODULE_DIR / f).read_text(), params)) for f in chain_files()
    )
    try:
        psql([], db=DB, stdin=f"BEGIN;\n{body}\nCOMMIT;\n")
        return None
    except RuntimeError as e:
        return str(e)


def row_of(appointment_id: str) -> dict:
    return rows(
        "SELECT hub_id, staff_id, staff_name, service_id, service_name, service_price, "
        "start_datetime, duration_minutes FROM appointments_appointment "
        f"WHERE id = {literal(appointment_id)}"
    )[0]


def history_of(appointment_id: str) -> list[dict]:
    return rows(
        "SELECT action, old_value, new_value FROM appointments_history "
        f"WHERE appointment_id = {literal(appointment_id)} ORDER BY created_at, id"
    )


def parsed(raw) -> dict:
    return json.loads(raw) if isinstance(raw, str) else (raw or {})


def only_line(appointment_id: str, what: str) -> dict | None:
    lines = history_of(appointment_id)
    if len(lines) != 1:
        fail(f"{what} must leave ONE history line, got {lines!r}")
        return None
    return lines[0]


def check_handover_to_another_professional() -> None:
    seed("a-staff")
    err = move("a-staff", staff_id="s2", staff_name="Carla")
    if err:
        fail(f"handing the appointment to Carla was refused: {err}")
        return
    row = row_of("a-staff")
    if (row["staff_id"], row["staff_name"]) != ("s2", "Carla"):
        fail(f"the appointment was not handed to Carla: {row!r}")
    if (row["service_id"], row["service_name"], row["service_price"]) != ("s-corte", "Corte", 2000):
        fail(f"a hand-over rewrote the service or its price: {row!r}")
    if not str(row["start_datetime"]).startswith("2026-09-10T16:00"):
        fail(f"the hand-over lost the new slot: {row!r}")
    line = only_line("a-staff", "a hand-over")
    if not line:
        return
    if line["action"] != "staff_changed":
        fail(f"a hand-over wrote {line['action']!r}, expected 'staff_changed'")
    before, after = parsed(line["old_value"]), parsed(line["new_value"])
    if before.get("staff_name") != "Bea" or after.get("staff_name") != "Carla":
        fail(f"the line does not say from Bea to Carla: {before!r} -> {after!r}")


def check_service_change() -> None:
    seed("a-service", start="2026-09-11T11:00:00+02:00", end="2026-09-11T11:30:00+02:00")
    err = move(
        "a-service",
        start_datetime="2026-09-11T11:00:00+02:00",
        end_datetime="2026-09-11T12:30:00+02:00",
        duration_minutes=90,
        service_id="s-tinte",
        service_name="Tinte",
        service_price=4500,
        from_start_datetime="2026-09-11T11:00:00+02:00",
    )
    if err:
        fail(f"changing the service to colour was refused: {err}")
        return
    row = row_of("a-service")
    if (row["service_id"], row["service_name"], row["service_price"]) != ("s-tinte", "Tinte", 4500):
        fail(f"the service, its name or its price did not change: {row!r}")
    if (row["staff_id"], row["staff_name"]) != ("s1", "Bea"):
        fail(f"a service change handed the appointment to someone else: {row!r}")
    if row["duration_minutes"] != 90:
        fail(f"the new length did not land: {row!r}")
    line = only_line("a-service", "a service change")
    if line and line["action"] != "service_changed":
        fail(f"a service change wrote {line['action']!r}, expected 'service_changed'")


def check_plain_move_keeps_both() -> None:
    seed("a-plain", start="2026-09-12T11:00:00+02:00", end="2026-09-12T11:30:00+02:00")
    err = move(
        "a-plain",
        start_datetime="2026-09-12T16:00:00+02:00",
        end_datetime="2026-09-12T16:30:00+02:00",
        from_start_datetime="2026-09-12T11:00:00+02:00",
    )
    if err:
        fail(f"a plain move was refused: {err}")
        return
    row = row_of("a-plain")
    if (row["staff_id"], row["staff_name"], row["service_id"], row["service_name"],
            row["service_price"]) != ("s1", "Bea", "s-corte", "Corte", 2000):
        fail(f"a plain move rewrote the professional or the service: {row!r}")
    line = only_line("a-plain", "a plain move")
    if line and line["action"] != "rescheduled":
        fail(f"a plain move wrote {line['action']!r}, expected 'rescheduled'")
    if line and parsed(line["new_value"]).get("channel") != "staff":
        fail(f"the move line lost its channel: {line!r}")


def check_overlap_on_the_new_professional() -> None:
    seed("a-carla-busy", staff=("s2", "Carla"), start="2026-09-13T16:00:00+02:00",
         end="2026-09-13T16:30:00+02:00")
    seed("a-bea", start="2026-09-13T11:00:00+02:00", end="2026-09-13T11:30:00+02:00")
    err = move(
        "a-bea",
        start_datetime="2026-09-13T16:00:00+02:00",
        end_datetime="2026-09-13T16:30:00+02:00",
        staff_id="s2",
        staff_name="Carla",
        from_start_datetime="2026-09-13T11:00:00+02:00",
    )
    if err is None:
        fail("the overlap gate did NOT fire: the appointment was handed onto Carla's taken slot")
    row = row_of("a-bea")
    if row["staff_id"] != "s1" or not str(row["start_datetime"]).startswith("2026-09-13T11:00"):
        fail(f"a refused hand-over changed the row anyway: {row!r}")
    if history_of("a-bea"):
        fail(f"a refused hand-over left a history line: {history_of('a-bea')!r}")


def check_another_hubs_row_is_never_touched() -> None:
    seed("a-neighbour", hub=OTHER_HUB, start="2026-09-14T11:00:00+02:00",
         end="2026-09-14T11:30:00+02:00")
    err = move("a-neighbour", staff_id="s2", staff_name="Carla", service_id="s-tinte",
               service_name="Tinte", service_price=4500)
    if err:
        fail(f"the command bound with another hub aborted instead of touching nothing: {err}")
    row = row_of("a-neighbour")
    if (row["staff_id"], row["service_id"], row["service_price"]) != ("s1", "s-corte", 2000):
        fail(f"a hand-over reached another hub's appointment: {row!r}")
    if history_of("a-neighbour"):
        fail("a hand-over wrote a history line on another hub's appointment")


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
        check_handover_to_another_professional()
        check_service_change()
        check_plain_move_keeps_both()
        check_overlap_on_the_new_professional()
        check_another_hubs_row_is_never_touched()
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    if not chain_files():
        fail(f"{COMMAND}: the manifest declares no sql chain")
    check_against_postgres()
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("ok: one appointment is handed to another professional or service, and says so")
    return 0


if __name__ == "__main__":
    sys.exit(main())
