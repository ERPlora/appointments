#!/usr/bin/env python3
"""The bell counter «Appointments to confirm» (appointments#169, contract: hub#1678).

Why this file exists: with «I review them first» switched on (`auto_confirm_online = 0`), a booking
the customer made herself (online or through WhatsApp) is born `pending` and waits for the salon.
The hub's bell shows whatever a module declares in its `bell` block, but only if the module
declares it — without it the owner only finds out by opening the Agenda.

The contract this file pins:

  1. MANIFEST. `bell["appointments.to_confirm"]` exists with an English label, points at a query of
     THIS module, leads to a real `navigation` tab and is gated by a permission the module owns.
     The Spanish label lives at `bell.appointments.to_confirm.label` in `locales/es.json`.

  2. REAL POSTGRES. The query answers ONE row with a numeric `count` of the appointments waiting
     for the business: `pending` AND `booked_online = 1` (the customer booked it; `status` is born
     `pending` for counter bookings too, so `pending` alone would count the salon's own
     appointments), not deleted, starting at or after `:now`, this hub only. Zero is a row with 0,
     never no row.

Usage: tests/bell_to_confirm.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  scratch database and DROPS it at the end. Without the container the Postgres layer is SKIPPED,
  never passed.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
LOCALE_ES = json.loads((MODULE_DIR / "locales" / "es.json").read_text())

BELL_ID = "appointments.to_confirm"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_bell_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-08-18T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest wiring ─────────────────────────────────────────────────────────────


def check_manifest() -> dict | None:
    entry = (MANIFEST.get("bell") or {}).get(BELL_ID)
    if not isinstance(entry, dict):
        fail(f"bell.{BELL_ID}: not declared in module.json")
        return None
    if not entry.get("label"):
        fail(f"bell.{BELL_ID}.label: missing (canonical English)")
    tabs = {t.get("id") for t in MANIFEST.get("navigation", [])}
    if entry.get("nav") not in tabs:
        fail(f"bell.{BELL_ID}.nav: {entry.get('nav')!r} is not a navigation tab {sorted(tabs)}")
    if entry.get("permission") not in MANIFEST.get("permissions", []):
        fail(f"bell.{BELL_ID}.permission: {entry.get('permission')!r} is not a permission of this module")
    es = ((LOCALE_ES.get("bell") or {}).get(BELL_ID) or {}).get("label")
    if not es:
        fail(f"locales/es.json: bell.{BELL_ID}.label missing (every visible string is en + es)")

    query_id = entry.get("query") or ""
    if not query_id.startswith("appointments."):
        fail(f"bell.{BELL_ID}.query: {query_id!r} is not a query of this module")
        return None
    q = MANIFEST.get("queries", {}).get(query_id)
    if not isinstance(q, dict):
        fail(f"bell.{BELL_ID}.query: {query_id!r} is not declared in `queries`")
        return None
    if q.get("permission") != entry.get("permission"):
        fail(f"{query_id}.permission {q.get('permission')!r} differs from the bell's {entry.get('permission')!r}")
    if "list" in q:
        fail(f"{query_id}: must be a plain query (one row), not a paginated `list`")
    sql_rel = q.get("sql")
    if not sql_rel or not (MODULE_DIR / sql_rel).exists():
        fail(f"{query_id}.sql: {sql_rel!r} is not in the package")
        return None
    schema_rel = q.get("schema")
    if not schema_rel or not (MODULE_DIR / schema_rel).exists():
        fail(f"{query_id}.schema: {schema_rel!r} is not in the package")
    elif json.loads((MODULE_DIR / schema_rel).read_text()).get("additionalProperties") is not False:
        fail(f"{schema_rel}: must be a closed contract (additionalProperties: false)")
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
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


# Bridge functions this query may use (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs`.
def shim(sql: str) -> str:
    sql = re.sub(r"\berp_dt\(([^()]*)\)", r"((\1)::timestamptz)", sql)
    sql = re.sub(r"\berp_date\(([^()]*)\)", r"((\1)::date)", sql)
    return sql


def run_query(sql_rel: str, params: dict) -> list[dict]:
    body = shim(bind((MODULE_DIR / sql_rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def insert(id_: str, hub: str, start: str, status: str, online: int, deleted: int = 0) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, customer_name, service_name, "
            "start_datetime, end_datetime, duration_minutes, status, booked_online, is_deleted, "
            "created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, 'Ada', 'Cut', {literal(start)}, {literal(start)}, "
            f"30, {literal(status)}, {online}, {deleted}, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def count(q: dict, hub: str) -> list[dict]:
    return run_query(q["sql"], {"hub_id": hub, "current_user_id": "u-owner", "now": NOW})


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

        # Empty hub: one row with 0, never no row.
        rows = count(q, HUB)
        if len(rows) != 1 or rows[0].get("count") != 0:
            fail(f"empty hub must answer one row with count 0, got {rows!r}")

        # Counted: booked by the customer, still waiting, upcoming.
        insert("a-online-1", HUB, "2026-08-18T09:00:00+02:00", "pending", online=1)
        insert("a-online-2", HUB, "2026-09-01T10:00:00+02:00", "pending", online=1)
        # Not counted — each one is a way the count could lie.
        insert("a-counter", HUB, "2026-08-20T10:00:00+02:00", "pending", online=0)
        insert("a-confirmed", HUB, "2026-08-20T11:00:00+02:00", "confirmed", online=1)
        insert("a-cancelled", HUB, "2026-08-20T12:00:00+02:00", "cancelled", online=1)
        insert("a-past", HUB, "2026-08-18T08:59:00+02:00", "pending", online=1)
        insert("a-deleted", HUB, "2026-08-20T13:00:00+02:00", "pending", online=1, deleted=1)
        insert("a-other-hub", OTHER_HUB, "2026-08-20T14:00:00+02:00", "pending", online=1)

        rows = count(q, HUB)
        if len(rows) != 1:
            fail(f"expected exactly one row, got {len(rows)}: {rows!r}")
        elif not isinstance(rows[0].get("count"), int) or rows[0]["count"] != 2:
            fail(
                f"count is {rows[0].get('count')!r}, expected numeric 2 "
                "(pending + booked online, upcoming, not deleted, this hub)"
            )

        rows = count(q, OTHER_HUB)
        if len(rows) != 1 or rows[0].get("count") != 1:
            fail(f"the neighbour hub must count only its own appointment, got {rows!r}")
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
    print(f"ok: bell.{BELL_ID} — manifest wiring + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
