#!/usr/bin/env python3
"""`sales.sale.created_from_appointment` → the agenda sees the booking as charged (sales#280).

WHY THIS FILE EXISTS. Charging a booking is a chain that crosses TWO modules, and until this file
landed the RECEIVING half of it had no test at all. `sales` persists the link and emits the event
(pinned by its own handler unit tests: `the_appointment_trace_event_carries_the_resolved_staff`
and `appointment_emits_created_from_appointment_event`, which assert the payload field names).
What nobody checked is the half that lives HERE: that the event is listened to, that the listener
writes `converted_sale_id`, and that the agenda then hands that column back so the counter can
answer «has this one been paid?» and grey out «Cobrar».

It was measured, not assumed. Deleting the whole `events.listen` entry from `module.json` left the
suite at **49 batteries green, 2 not run** — the agenda could be unplugged from the till and
nothing anywhere turned red. That is the same symptom sales#280 describes (the customer pays and
her booking still looks unpaid), reachable again by a one-line edit.

The chain, and who guards each link:

    POS charges with appointment_id  → sales: `erp-pos-appointment-remount.test.ts` + PG battery
    sales emits the trace event      → sales: `handler/src/lib.rs` unit tests (payload field names)
    appointments listens to it       → ✅ THIS FILE, layer 1
    `_mark_converted` writes the id  → ✅ THIS FILE, layer 2
    the agenda reads it back         → ✅ THIS FILE, layer 2
    the agenda paints it charged     → `erp-appointments-charge.test.ts`

What it pins:

  1. WIRING (layer 1, no database needed). `sales.sale.created_from_appointment` is listened to and
     lands on a command of THIS module — since hub#659 a listener may not name another module's
     command and the installer refuses the whole install if it does. The command is transactional
     and runs the SQL file. Its binds are checked against the payload `sales` actually emits: a
     bind the event does not carry arrives NULL, and `WHERE id = NULL` matches nothing and raises
     nothing — the exact silent failure this chain is prone to. `sales` stays OUT of `depends_on`
     on purpose: the bus does not consult it, and a salon with a diary and no till must keep
     working (same reasoning as `whatsapp_inbox` in `booking_from_request.contract.test.py`).

  2. POSTGRES REAL (layer 2), on a throwaway database built from the module's own migrations:
     - the booking the event names comes back carrying its sale, and the AGENDA READ hands that
       column over (`appointments.appointments.list`) — the read is the part that broke once
       already: the column existed and the listener wrote it, but no query projected it (sales#89);
     - the write is TRACEABILITY ONLY: `status` is not touched. The authority over the state of a
       booking stays manual, and a listener that silently completed bookings would close the ones
       the salon charged in advance;
     - a booking that belongs to ANOTHER HUB is never touched, even though the event names it
       by an id that is unique across the whole table (tenancy);
     - a soft-deleted booking is not touched;
     - an event naming a booking that does not exist changes nothing and raises nothing.

Usage: tests/sale_conversion.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). It creates a
  throwaway database and DROPS it at the end, pass or fail. Without a container the Postgres layer
  is SKIPPED — never counted as passed.
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
DB = f"appointments_sale_conversion_test_{os.getpid()}"

TRIGGER = "sales.sale.created_from_appointment"
COMMAND = "appointments._mark_converted"
SQL_FILE = "commands/_mark_converted.sql"
LIST_QUERY = "appointments.appointments.list"

# The payload `sales` emits (`handler/src/lib.rs`, `sales.sale.created_from_appointment`), plus
# what the runtime injects into every command. A bind outside this set can only ever be NULL.
EVENT_FIELDS = {"sender", "sale_id", "appointment_id", "staff_id", "total"}
RUNTIME_FIELDS = {"hub_id", "now", "current_user_id"}
REQUIRED_BINDS = {"appointment_id", "sale_id", "hub_id"}

HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-09-11T13:40:00+02:00"
DAY_START = "2026-09-11T00:00:00+02:00"
DAY_END = "2026-09-12T00:00:00+02:00"
SALE = "sale-7742"

failures: list[str] = []
notes: list[str] = []
postgres_ran = False
list_sql: str | None = None


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: the wiring that makes the event ARRIVE ──────────────────────────────────────


def strip_comments(sql: str) -> str:
    """Line comments hold prose that names the binds; only real SQL counts."""
    return re.sub(r"--[^\n]*", "", sql)


def binds_of(sql: str) -> set[str]:
    return set(re.findall(r"(?<![:\w]):([a-z_][a-z0-9_]*)", strip_comments(sql)))


def check_listener() -> None:
    listen = (MANIFEST.get("events") or {}).get("listen") or {}
    entry = listen.get(TRIGGER)
    if not entry:
        fail(
            f"events.listen: nothing listens to {TRIGGER!r} — charging a booking from the till "
            "would leave it in the agenda looking unpaid, and no error anywhere (sales#280)"
        )
        return
    command = entry.get("command") if isinstance(entry, dict) else entry
    if command != COMMAND:
        fail(f"events.listen[{TRIGGER}]: expected {COMMAND!r}, got {command!r}")
        return
    if not command.startswith(MANIFEST["id"] + "."):
        fail(
            f"events.listen[{TRIGGER}] points outside this module — "
            "`installer::validate_event_listeners` refuses the whole install (hub#659)"
        )


def check_command() -> None:
    command = (MANIFEST.get("commands") or {}).get(COMMAND)
    if not command:
        fail(f"commands[{COMMAND}] does not exist, so the listener lands nowhere")
        return
    if not command.get("transaction"):
        fail(
            f"{COMMAND}: must be `transaction: true` — the mark is a write, not a read"
        )
    if list(command.get("sql") or []) != [SQL_FILE]:
        fail(f"{COMMAND}.sql: expected [{SQL_FILE!r}], got {command.get('sql')!r}")


def check_binds() -> None:
    path = MODULE_DIR / SQL_FILE
    if not path.exists():
        fail(f"{SQL_FILE} is missing")
        return
    binds = binds_of(path.read_text())
    missing = REQUIRED_BINDS - binds
    if missing:
        fail(
            f"{SQL_FILE}: does not bind {sorted(missing)} — without them the UPDATE cannot name "
            "the booking, its sale or its hub"
        )
    unknown = binds - EVENT_FIELDS - RUNTIME_FIELDS
    if unknown:
        fail(
            f"{SQL_FILE}: binds {sorted(unknown)}, which {TRIGGER!r} does not carry and the "
            "runtime does not inject. An absent bind arrives NULL, `= NULL` matches no row and "
            "nothing is raised: the booking would stay unpaid in silence. If `sales` renamed a "
            "field, this chain is broken on BOTH sides — fix the emitter too"
        )


def check_the_agenda_read_is_declared() -> None:
    """Resolves the agenda read THROUGH the manifest — never by filename.

    The counter asks the hub for `appointments.appointments.list`; which file answers it is the
    manifest's business. Opening `queries/appointments_list.sql` by hand would leave this battery
    green with the query repointed at another file, or gone: the counter would get no column and
    the button would stay lit, which is sales#89 one level up.
    """
    global list_sql
    entry = (MANIFEST.get("queries") or {}).get(LIST_QUERY)
    if not entry:
        fail(
            f"queries[{LIST_QUERY}] does not exist: the agenda has no read to ask for, so nothing "
            "can hand the counter back the sale a booking was charged with"
        )
        return
    sql = entry.get("sql") if isinstance(entry, dict) else entry
    if isinstance(sql, list):
        sql = sql[0] if sql else None
    if not sql or not (MODULE_DIR / sql).exists():
        fail(f"{LIST_QUERY}.sql points at {sql!r}, which is not a file of this module")
        return
    list_sql = sql


def check_sales_is_not_a_dependency() -> None:
    ids = {
        d["id"] if isinstance(d, dict) else d for d in MANIFEST.get("depends_on") or []
    }
    if "sales" in ids:
        fail(
            "depends_on names `sales`: the event bus does not consult it, and a salon with a "
            "diary and no till would stop being able to install this module"
        )


# ── Layer 2: Postgres, the write and the read the counter actually sees ──────────────────


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
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def run_sql_file(rel: str, params: dict) -> None:
    psql([], db=DB, stdin=bind((MODULE_DIR / rel).read_text(), params))


def run_query(rel: str, params: dict) -> list[dict]:
    body = bind((MODULE_DIR / rel).read_text(), params).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def seed(
    appointment_id: str, hub: str, *, is_deleted: int = 0, status: str = "confirmed"
) -> None:
    psql(
        [
            "-c",
            f"""
        INSERT INTO appointments_appointment
            (id, hub_id, appointment_number, customer_id, customer_name, staff_id, staff_name,
             service_id, service_name, service_price, start_datetime, end_datetime,
             duration_minutes, status, is_deleted, created_at)
        VALUES ({literal(appointment_id)}, {literal(hub)}, 'APT-20260911-0001', 'cust-1', 'Ana',
                'staff-3', 'Lucía', 'svc-1', 'Corte', 2500,
                '2026-09-11T10:00:00+02:00', '2026-09-11T10:45:00+02:00', 45,
                {literal(status)}, {is_deleted}, '2026-09-01T09:00:00+02:00')
        """,
        ],
        db=DB,
    )


def row(appointment_id: str, hub: str) -> dict:
    out = psql(
        [
            "-t",
            "-A",
            "-c",
            f"""
        SELECT row_to_json(r) FROM (
            SELECT converted_sale_id, status, updated_at FROM appointments_appointment
             WHERE id = {literal(appointment_id)} AND hub_id = {literal(hub)}
        ) r""",
        ],
        db=DB,
    )
    return json.loads(out.strip())


def mark_converted(appointment_id: str, hub: str = HUB, sale_id: str = SALE) -> None:
    """Runs the listener's SQL with the payload `sales` emits, plus what the runtime injects."""
    run_sql_file(
        SQL_FILE,
        {
            "sender": "sales",
            "sale_id": sale_id,
            "appointment_id": appointment_id,
            "staff_id": "staff-3",
            "total": 2500,
            "hub_id": hub,
            "now": NOW,
        },
    )


def check_the_agenda_sees_it_charged() -> None:
    seed("appt-charged", HUB)
    before = row("appt-charged", HUB)
    mark_converted("appt-charged")
    after = row("appt-charged", HUB)

    if after["converted_sale_id"] != SALE:
        fail(
            "the booking the event names did NOT come back with its sale "
            f"(converted_sale_id={after['converted_sale_id']!r}): the counter charges the customer "
            "and the agenda still offers «Cobrar» (sales#280)"
        )
    if after["status"] != before["status"]:
        fail(
            f"`status` moved {before['status']!r} → {after['status']!r}: the mark is traceability "
            "only. Deciding the state of a booking stays manual — a listener that completes it "
            "would close the ones charged in advance, before the customer even arrived"
        )

    if list_sql is None:
        return  # the manifest does not declare the read; already reported by layer 1
    rows = run_query(
        list_sql,
        {
            "hub_id": HUB,
            "day_start": DAY_START,
            "day_end": DAY_END,
            "status": None,
            "staff_id": None,
            "limit": 200,
        },
    )
    listed = [r for r in rows if r["id"] == "appt-charged"]
    if not listed:
        fail(f"{LIST_QUERY} did not return the charged booking at all")
    elif listed[0].get("converted_sale_id") != SALE:
        fail(
            f"{LIST_QUERY} hands the row back WITHOUT its sale "
            f"({listed[0].get('converted_sale_id')!r}): the listener wrote the link and the agenda "
            "still cannot see it — exactly the shape sales#89 had to fix once already"
        )


def check_other_hub_is_never_touched() -> None:
    """A sale in one salon naming a booking of another one has to find nothing.

    `id` is the primary key of the whole table, so two hubs cannot share one — which is exactly
    why the filter is easy to drop without noticing. The event carries the id and the runtime
    injects the hub: take away `AND hub_id = :hub_id` and this same call reaches across the
    tenancy line, because the id on its own already matches the row.
    """
    seed("appt-neighbour", OTHER_HUB)
    mark_converted("appt-neighbour", hub=HUB)

    if row("appt-neighbour", OTHER_HUB)["converted_sale_id"] is not None:
        fail(
            "a sale of this hub marked a booking belonging to ANOTHER hub: the id on its own was "
            "enough, so the tenancy filter is not doing its job (ADR-0007)"
        )


def check_deleted_and_unknown_are_no_ops() -> None:
    seed("appt-deleted", HUB, is_deleted=1)
    mark_converted("appt-deleted")
    if row("appt-deleted", HUB)["converted_sale_id"] is not None:
        fail(
            "a soft-deleted booking was marked as charged: deleted rows are out of the contract"
        )

    before = psql(
        [
            "-t",
            "-A",
            "-c",
            "SELECT count(*) FROM appointments_appointment "
            "WHERE converted_sale_id IS NOT NULL",
        ],
        db=DB,
    ).strip()
    mark_converted("appt-does-not-exist")
    after = psql(
        [
            "-t",
            "-A",
            "-c",
            "SELECT count(*) FROM appointments_appointment "
            "WHERE converted_sale_id IS NOT NULL",
        ],
        db=DB,
    ).strip()
    if before != after:
        fail(f"an event naming an unknown booking changed rows ({before} → {after})")


def check_against_postgres() -> None:
    global postgres_ran
    if not docker_available():
        # `SKIPPED:` VERBATIM AND AT COLUMN 0. That exact shape is what the gate reads
        # (`run-batteries.mjs::looksSkipped`, module-toolkit#57) to tell «the battery skipped
        # itself» from a note inside a section, and it is the only thing standing between an
        # unreachable container and a green that verified nothing. `erplora test` hands the
        # container name over WITHOUT checking it answers, so a Postgres that died after
        # starting reaches here — and printed as an indented note this file would exit 0
        # claiming the whole chain is guarded while tenancy, soft-delete and the agenda read
        # never ran.
        print(
            f"SKIPPED: no Postgres in container {CONTAINER} (nothing of the Postgres layer was "
            "verified; the wiring layer above did run)"
        )
        return

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for entry in MANIFEST["migrations"]["postgres"]:
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
        notes.append(
            f"scratch database {DB} built from {len(MANIFEST['migrations']['postgres'])} migrations"
        )
        check_the_agenda_sees_it_charged()
        check_other_hub_is_never_touched()
        check_deleted_and_unknown_are_no_ops()
        postgres_ran = True
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    check_listener()
    check_command()
    check_binds()
    check_the_agenda_read_is_declared()
    check_sales_is_not_a_dependency()
    check_against_postgres()

    for note in notes:
        print(f"  · {note}")
    print()
    if failures:
        print(
            f"FAILED — {len(failures)} break(s) in the booking→sale chain (sales#280):"
        )
        for f in failures:
            print(f"  - {f}")
        return 1
    if not postgres_ran:
        print(
            f"WIRING ONLY — appointments v{MANIFEST.get('version')}: the event reaches a command "
            "of this module and its binds match the payload. Nothing was proved about the write "
            "or the agenda read (see SKIPPED above)"
        )
        return 0
    print(
        f"PASS — appointments v{MANIFEST.get('version')}: a sale born from a booking reaches this "
        "module, marks that booking and only that booking, and the agenda reads it back as charged"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
