#!/usr/bin/env python3
"""`appointments.recurring.occurrences` + the unique index of migration 005 — what makes
materializing a series IDEMPOTENT and TRACEABLE (appointments#15).

Why this file exists: a materialized appointment used to keep NO link to the template it came from.
Re-running `appointments.recurring.materialize` therefore DUPLICATED the appointments — and
materializing is precisely what gets retried, because the window moves forward every week. And
without that link a cancelled occurrence could not be an EXCEPTION of the series: the next retry
brought it back.

The handler side is covered by `cargo test` (the skip, the cancelled occurrence, «nothing left to
book» succeeding). This file covers the two halves `cargo test` CANNOT see:

  1. MANIFEST + MIGRATION. The query exists, `materialize` declares it `required` and filtered by
     `payload.recurring_id`, and migration 005 is in the shipped list.
  2. REAL POSTGRES. Against a scratch database built from this module's own migrations:
     - the read returns this series' occurrences, cancelled ones INCLUDED (they are the exception),
       deleted ones excluded, and never another series' or another hub's;
     - the unique index actually REFUSES a second live row for the same (hub, series, day) — the
       last line of defence if two materializations race — while the same day of another hub, of
       another series, or after a soft-delete stays free.

Point 2 is the one that matters: a guard nobody proved rejects anything is a guard that opens, and
the Rust tests would stay green all the way down (appointments#16).

Usage: tests/recurring_idempotency.postgres.test.py   (exit 0 = green)
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

QUERY = "appointments.recurring.occurrences"
COMMAND = "appointments.recurring.materialize"
MIGRATION = "migrations/postgres/005_recurring_occurrence.sql"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_recurring_idempotency_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest + migration ────────────────────────────────────────────────────────


def check_manifest() -> dict | None:
    if MIGRATION not in MANIFEST.get("migrations", {}).get("postgres", []):
        fail(
            f"migrations.postgres: {MIGRATION!r} is not shipped — the columns would not exist"
        )

    q = MANIFEST.get("queries", {}).get(QUERY)
    if not isinstance(q, dict):
        fail(f"{QUERY}: not declared in module.json")
        return None
    if "list" in q:
        fail(f"{QUERY}: must be a plain query — the handler reads the rows, not a page")
    if not q.get("sql") or not (MODULE_DIR / q["sql"]).exists():
        fail(f"{QUERY}.sql: {q.get('sql')!r} is not in the package")
        return None

    reads = {
        r.get("query"): r
        for r in (MANIFEST.get("commands", {}).get(COMMAND) or {}).get("reads", [])
        if isinstance(r, dict)
    }
    # «Cancelar o reagendar una ocurrencia sin perder la relación» (appointments#15): ninguna de
    # las escrituras del ciclo de vida puede tocar las dos columnas. Reagendar conserva además la
    # fecha ORIGINAL de la ocurrencia — es la clave de la serie, no el hueco donde acabó la cita.
    for rel in (
        "commands/appointment_cancel.sql",
        "commands/appointment_reschedule.sql",
        "commands/appointment_update.sql",
    ):
        sql = (MODULE_DIR / rel).read_text()
        for column in ("recurring_id", "occurrence_date"):
            if re.search(rf"\b{column}\s*=", sql):
                fail(
                    f"{rel}: writes {column} — cancelling or moving an occurrence would lose its series"
                )

    read = reads.get(QUERY)
    if read is None:
        fail(
            f"{COMMAND}.reads: missing {QUERY!r} — materializing twice would duplicate again"
        )
    else:
        if read.get("required") is not True:
            fail(
                f"{COMMAND}.reads[{QUERY}]: must be `required` — booking again without knowing what "
                "is already booked is exactly the duplication this closes"
            )
        if (read.get("params") or {}).get("recurring_id") != "payload.recurring_id":
            fail(
                f"{COMMAND}.reads[{QUERY}].params.recurring_id: must bind payload.recurring_id"
            )
    return q


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


def run_query(sql_rel: str, params: dict) -> list[dict]:
    body = bind((MODULE_DIR / sql_rel).read_text(), params).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def occurrence(
    id_: str,
    hub: str,
    series: str | None,
    day: str | None,
    status: str = "confirmed",
    deleted: int = 0,
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, "
            "recurring_id, occurrence_date, is_deleted, created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', '', '', 's1', '', "
            f"'s-corte', 'Corte', 2000, '{day or '2026-09-01'}T11:00:00+02:00', "
            f"'{day or '2026-09-01'}T11:30:00+02:00', 30, {literal(status)}, '', '', 0, 0, '', "
            f"{literal(series)}, {literal(day)}, {deleted}, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def refuses(fn) -> bool:
    """True when Postgres refused the write (that is the point of a unique index)."""
    try:
        fn()
    except RuntimeError:
        return True
    return False


def check_against_postgres(q: dict) -> None:
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

        # The read: this series, cancelled included, deleted out, neighbours invisible.
        occurrence("o-booked", HUB, "r1", "2026-09-07")
        occurrence("o-cancelled", HUB, "r1", "2026-09-14", status="cancelled")
        occurrence("o-deleted", HUB, "r1", "2026-09-21", deleted=1)
        occurrence("o-other-series", HUB, "r2", "2026-09-07")
        occurrence("o-other-hub", OTHER_HUB, "r1", "2026-09-07")
        occurrence("o-standalone", HUB, None, None)

        got = {
            r["occurrence_date"]
            for r in run_query(q["sql"], {"hub_id": HUB, "recurring_id": "r1"})
        }
        want = {"2026-09-07", "2026-09-14"}
        if got != want:
            missing, extra = sorted(want - got), sorted(got - want)
            fail(
                f"{QUERY} returned {sorted(got)}; missing {missing}, unexpected {extra}"
            )

        # The index: a second LIVE row for the same (hub, series, day) is refused.
        if not refuses(lambda: occurrence("o-dup", HUB, "r1", "2026-09-07")):
            fail(
                "uq_appointments_occurrence: a second live appointment of the same series on the "
                "same day was ACCEPTED — the last line of defence against a double materialization "
                "does not exist"
            )
        # …and the same day is still free for another hub, another series, and after a soft-delete.
        for label, args in (
            ("another hub", ("o-free-hub", OTHER_HUB, "r1", "2026-09-14")),
            ("another series", ("o-free-series", HUB, "r3", "2026-09-07")),
            ("a deleted day", ("o-free-deleted", HUB, "r1", "2026-09-21")),
        ):
            if refuses(lambda a=args: occurrence(*a)):
                fail(
                    f"uq_appointments_occurrence: it also blocks {label}, which must stay free"
                )
        # Two standalone appointments (no series) never collide: the index is partial.
        if refuses(lambda: occurrence("o-standalone-2", HUB, None, None)):
            fail(
                "uq_appointments_occurrence: it blocks ordinary appointments — it must be partial"
            )
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    q = check_manifest()
    if q is not None:
        check_against_postgres(q)
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {QUERY} + uq_appointments_occurrence — manifest wiring + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
