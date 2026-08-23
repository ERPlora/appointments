#!/usr/bin/env python3
"""Editing a series «this and all following» — the SQL side (appointments#15).

`cargo test` proves what the handler DECIDES: which occurrences move, that the past is frozen, that
a cancelled one stays cancelled and an invoiced one is locked, and that the count of a bounded
series is split instead of doubled. What it cannot see is whether the statements it emits actually
run, and whether the DOOR they go through is really shut.

That distinction is the whole point. `_recurring_move_occurrence.sql` carries its guard in the
`WHERE`, not in the handler: `status IN ('pending','confirmed')` and no `converted_sale_id`. A
handler that got it wrong would still be stopped there — but only if the clause is right, and a
guard nobody proved rejects anything is a guard that opens (appointments#16, and the same lesson as
`tenancy-scoping-tests-that-prove-nothing`).

So this file covers, against a scratch Postgres built from this module's own migrations:

  1. MANIFEST + MIGRATION. `appointments.recurring.update` is declared with its closed `scope`
     enum, its two `required` reads, and migration 007 is in the shipped list.
  2. REAL POSTGRES.
     - migration 007 applies and `split_from_id` exists;
     - `_recurring_split` inserts the new half with the trail back to the old one;
     - `_recurring_close` writes the `UNTIL` without deactivating or deleting the old half;
     - `_recurring_move_occurrence` MOVES a `pending`/`confirmed` occurrence…
     - …and REFUSES to touch one that is `completed`, `cancelled`, soft-deleted, already turned
       into a sale, or belongs to another hub — each one checked separately, because a `WHERE`
       that is too tight and one that is too loose fail in opposite directions;
     - the occurrences read hands back the columns the move needs (`id`, `converted_sale_id`).

Usage: tests/recurring_series_split.postgres.test.py   (exit 0 = green)
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

COMMAND = "appointments.recurring.update"
MIGRATION = "migrations/postgres/007_recurring_split.sql"
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_series_split_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-08-20T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest + migration ────────────────────────────────────────────────────────


def check_manifest() -> None:
    if MIGRATION not in MANIFEST.get("migrations", {}).get("postgres", []):
        fail(f"migrations.postgres: {MIGRATION!r} is not shipped — split_from_id would not exist")

    cmd = MANIFEST.get("commands", {}).get(COMMAND)
    if not isinstance(cmd, dict):
        fail(f"{COMMAND}: not declared in module.json")
        return
    if cmd.get("transaction") is not True:
        fail(f"{COMMAND}: must be transactional — a half-split series is two truths at once")

    schema_rel = cmd.get("schema")
    if not schema_rel or not (MODULE_DIR / schema_rel).exists():
        fail(f"{COMMAND}.schema: {schema_rel!r} is not in the package")
    else:
        schema = json.loads((MODULE_DIR / schema_rel).read_text())
        scope = (schema.get("properties") or {}).get("scope") or {}
        # A CLOSED set. «all» arriving as a typo and rewriting a past that is already invoiced is
        # exactly what must fail validation instead of falling into a default.
        if scope.get("enum") != ["this_and_following"]:
            fail(f"{schema_rel}: scope must be a closed enum, got {scope.get('enum')!r}")
        if schema.get("additionalProperties") is not False:
            fail(f"{schema_rel}: additionalProperties must be false")
        if set(schema.get("required") or []) != {"recurring_id", "scope", "from_occurrence_date"}:
            fail(f"{schema_rel}: required must name the series, the scope and the cut")

    reads = {r.get("query"): r for r in cmd.get("reads") or [] if isinstance(r, dict)}
    for needed in ("appointments.recurring.get", "appointments.recurring.occurrences"):
        read = reads.get(needed)
        if read is None:
            fail(f"{COMMAND}.reads: missing {needed!r} — the split would be decided from the payload")
        elif read.get("required") is not True:
            fail(
                f"{COMMAND}.reads[{needed}]: must be `required`. Moving «the following ones» "
                "without knowing what is on the books is moving an unknown set"
            )

    # The read has to hand back what the move needs, or the handler cannot address a row.
    occ_sql = (MODULE_DIR / MANIFEST["queries"]["appointments.recurring.occurrences"]["sql"]).read_text()
    for column in ("id", "converted_sale_id", "start_datetime"):
        if not re.search(rf"\b{column}\b", occ_sql.split("FROM")[0]):
            fail(f"recurring_occurrences.sql: does not select {column} — the split cannot use it")

    move = (MODULE_DIR / "commands/_recurring_move_occurrence.sql").read_text()
    if "updated_at = :now" not in move:
        fail("_recurring_move_occurrence.sql: must pin the run with updated_at = :now, or the "
             "history statement would record a move that did not happen")


# ── Layer 2: real Postgres ───────────────────────────────────────────────────────────────


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
    cmd = ["docker", "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"]
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


def run_command(sql_rel: str, params: dict) -> None:
    psql([], db=DB, stdin=bind((MODULE_DIR / sql_rel).read_text(), params))


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def seed_series(series_id: str, hub: str = HUB) -> None:
    run_command(
        "commands/recurring_create.sql",
        {
            "new_id": series_id, "hub_id": hub, "customer_id": "c1", "customer_name": "Ada",
            "service_id": "s-corte", "service_name": "Corte", "staff_id": "s1",
            "staff_name": "Bea", "frequency": "weekly", "day_of_week": None, "time": "11:00",
            "duration_minutes": 30, "start_date": "2026-08-03", "end_date": None,
            "max_occurrences": None, "current_user_id": "u1", "now": NOW,
        },
    )


def seed_occurrence(id_: str, hub: str, series: str, day: str, status: str = "confirmed",
                    sale: str | None = None, deleted: int = 0) -> None:
    psql(
        ["-c",
         "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
         "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
         "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
         "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, "
         "converted_sale_id, recurring_id, occurrence_date, is_deleted, created_at) VALUES "
         f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', '', '', 's1', 'Bea', "
         f"'s-corte', 'Corte', 2000, '{day}T11:00:00+02:00', '{day}T11:30:00+02:00', 30, "
         f"{literal(status)}, '', '', 0, 0, '', {literal(sale)}, {literal(series)}, "
         f"{literal(day)}, {deleted}, '2026-08-01T00:00:00+02:00')"],
        db=DB,
    )


def move(appointment_id: str, hub: str = HUB) -> None:
    run_command(
        "commands/_recurring_move_occurrence.sql",
        {
            "hub_id": hub, "appointment_id": appointment_id, "recurring_id": "r2",
            "start_datetime": "2026-08-24T12:00:00+02:00",
            "end_datetime": "2026-08-24T12:30:00+02:00",
            "duration_minutes": 30, "current_user_id": "u1", "now": NOW,
        },
    )


def moved(appointment_id: str) -> bool:
    return scalar(
        f"SELECT start_datetime FROM appointments_appointment WHERE id = {literal(appointment_id)}"
    ).startswith("2026-08-24T12:00")


def check_against_postgres() -> None:
    if failures:
        return
    if not docker_available():
        notes.append(f"SKIPPED Postgres layer: container {CONTAINER!r} is not running")
        return

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for rel in MANIFEST.get("migrations", {}).get("postgres", []):
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())

        seed_series("r1")

        # ── the split itself ────────────────────────────────────────────────────────────
        run_command(
            "commands/_recurring_close.sql",
            {"hub_id": HUB, "recurring_id": "r1", "end_date": "2026-08-23",
             "current_user_id": "u1", "now": NOW},
        )
        if scalar("SELECT end_date FROM appointments_recurring WHERE id = 'r1'") != "2026-08-23":
            fail("_recurring_close.sql: the UNTIL was not written")
        # The old half keeps its appointments: it is history, not rubbish.
        if scalar("SELECT is_active || '/' || is_deleted FROM appointments_recurring WHERE id = 'r1'") != "1/0":
            fail("_recurring_close.sql: it deactivated or deleted the old half — it must only stop looking forward")

        run_command(
            "commands/_recurring_split.sql",
            {"new_id": "r2", "hub_id": HUB, "customer_id": "c1", "customer_name": "Ada",
             "service_id": "s-corte", "service_name": "Corte", "staff_id": "s1",
             "staff_name": "Bea", "frequency": "weekly", "day_of_week": None, "time": "12:00",
             "duration_minutes": 30, "start_date": "2026-08-24", "end_date": None,
             "max_occurrences": None, "split_from_id": "r1", "current_user_id": "u1", "now": NOW},
        )
        if scalar("SELECT split_from_id FROM appointments_recurring WHERE id = 'r2'") != "r1":
            fail("_recurring_split.sql: the new half does not say where it came from (migration 007)")
        if scalar("SELECT time FROM appointments_recurring WHERE id = 'r2'") != "12:00":
            fail("_recurring_split.sql: the new half did not take the new time")

        # ── the door: what moves ────────────────────────────────────────────────────────
        # One per day: two occurrences of the same series cannot share an `occurrence_date`
        # (the unique index of migration 005 says so, and it is right — that IS the duplicate it
        # exists to stop). Writing the fixture the other way is how this test found that out.
        for day, status in (("2026-08-24", "pending"), ("2026-08-25", "confirmed")):
            seed_occurrence(f"o-{status}", HUB, "r1", day, status=status)
            move(f"o-{status}")
            if not moved(f"o-{status}"):
                fail(f"_recurring_move_occurrence.sql: a {status} occurrence did NOT move — the WHERE is too tight")
            if scalar(f"SELECT recurring_id FROM appointments_appointment WHERE id = 'o-{status}'") != "r2":
                fail(f"_recurring_move_occurrence.sql: the {status} occurrence stayed on the old half")

        # ── the door: what must NOT move ────────────────────────────────────────────────
        # Each one on its own: a WHERE that is too loose and one that is too tight fail in
        # opposite directions, and a single mixed case would hide either.
        blocked = [
            ("completed", dict(status="completed")),
            ("cancelled", dict(status="cancelled")),
            ("no_show", dict(status="no_show")),
            ("in_progress", dict(status="in_progress")),
            ("already a sale", dict(sale="sale-1")),
            ("soft-deleted", dict(deleted=1)),
        ]
        for label, kwargs in blocked:
            oid = f"o-blocked-{label.replace(' ', '-')}"
            seed_occurrence(oid, HUB, "r1", f"2026-09-{7 + blocked.index((label, kwargs)):02d}", **kwargs)
            move(oid)
            if moved(oid):
                fail(f"_recurring_move_occurrence.sql: it MOVED an occurrence that is {label} — the door is open")

        # …and never a neighbour's, whatever its state.
        seed_occurrence("o-neighbour", OTHER_HUB, "r1", "2026-08-24")  # same day, other hub
        move("o-neighbour")  # with OUR hub_id, which is how a tenancy leak would look
        if moved("o-neighbour"):
            fail("_recurring_move_occurrence.sql: it reached another hub's appointment")
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    check_manifest()
    check_against_postgres()
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {COMMAND} — manifest wiring + migration 007 + the move door against real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
