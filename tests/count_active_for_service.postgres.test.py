#!/usr/bin/env python3
"""`appointments.appointments.count_active_for_service` — the public read `services` archives with.

Why this file exists (services#2): archiving a service must WARN about the upcoming appointments it
still has (Fresha/Square/Vagaro archive and warn, they never break booked slots). `services` cannot
count them itself — the table is private to this module — so this module publishes the count as a
public query, the only cross-module door the contract allows (`architecture/hub/module-system.md`).

The contract this file pins:

  1. MANIFEST. The query exists, is gated by `appointments.view_appointment`, is NOT a paginated
     `list` (it returns one row: a count), validates its params with a closed schema that requires
     `service_id`, and is exposed to the assistant.

  2. REAL POSTGRES. Against a scratch database built from this module's own migrations, the query
     counts ONLY the appointments that archiving would touch: this hub, this service, not deleted,
     `pending`/`confirmed`, starting at or after `:now`. Past ones, completed/cancelled/no-show
     ones, other services and OTHER HUBS (a live neighbour, so the scoping proves something) are
     out. And it answers with a row (`active_count = 0`) when there is nothing, not with no row —
     the caller must never confuse "no appointments" with "query unavailable".

Usage: tests/count_active_for_service.postgres.test.py   (exit 0 = green)
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

QUERY = "appointments.appointments.count_active_for_service"
PERMISSION = "appointments.view_appointment"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_count_active_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-08-18T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest wiring ─────────────────────────────────────────────────────────────


def check_manifest() -> dict | None:
    q = MANIFEST.get("queries", {}).get(QUERY)
    if not isinstance(q, dict):
        fail(f"{QUERY}: not declared in module.json")
        return None
    if q.get("permission") != PERMISSION:
        fail(f"{QUERY}.permission is {q.get('permission')!r}, expected {PERMISSION!r}")
    if "list" in q:
        fail(f"{QUERY}: must be a plain query (one row), not a paginated `list`")
    sql_rel = q.get("sql")
    if not sql_rel or not (MODULE_DIR / sql_rel).exists():
        fail(f"{QUERY}.sql: {sql_rel!r} is not in the package")
    schema_rel = q.get("schema")
    if not schema_rel or not (MODULE_DIR / schema_rel).exists():
        fail(
            f"{QUERY}.schema: {schema_rel!r} is not in the package (params must be validated)"
        )
    else:
        schema = json.loads((MODULE_DIR / schema_rel).read_text())
        if "service_id" not in schema.get("required", []):
            fail(f"{schema_rel}: `service_id` must be required")
        if schema.get("additionalProperties") is not False:
            fail(
                f"{schema_rel}: must be a closed contract (additionalProperties: false)"
            )
    if not (q.get("ai") or {}).get("description"):
        fail(
            f"{QUERY}.ai.description: missing (the assistant should be able to answer it)"
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


def insert(
    id_: str, hub: str, service: str | None, start: str, status: str, deleted: int = 0
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, service_id, customer_name, service_name, "
            "start_datetime, end_datetime, duration_minutes, status, is_deleted, created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(service)}, 'Ada', 'Cut', {literal(start)}, "
            f"{literal(start)}, 30, {literal(status)}, {deleted}, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


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

        # Counted: upcoming, live, this hub, this service.
        insert("a-pending", HUB, "svc-cut", "2026-08-20T10:00:00+02:00", "pending")
        insert("a-confirmed", HUB, "svc-cut", "2026-09-01T10:00:00+02:00", "confirmed")
        # Not counted — each one is a way the count could lie.
        insert("a-past", HUB, "svc-cut", "2026-08-01T10:00:00+02:00", "confirmed")
        insert("a-completed", HUB, "svc-cut", "2026-08-20T11:00:00+02:00", "completed")
        insert("a-cancelled", HUB, "svc-cut", "2026-08-20T12:00:00+02:00", "cancelled")
        insert("a-no-show", HUB, "svc-cut", "2026-08-20T13:00:00+02:00", "no_show")
        insert(
            "a-deleted",
            HUB,
            "svc-cut",
            "2026-08-20T14:00:00+02:00",
            "confirmed",
            deleted=1,
        )
        insert(
            "a-other-service",
            HUB,
            "svc-colour",
            "2026-08-20T15:00:00+02:00",
            "confirmed",
        )
        insert(
            "a-other-hub",
            OTHER_HUB,
            "svc-cut",
            "2026-08-20T16:00:00+02:00",
            "confirmed",
        )

        base = {"hub_id": HUB, "current_user_id": "u-owner", "now": NOW}
        rows = run_query(q["sql"], {**base, "service_id": "svc-cut"})
        if len(rows) != 1:
            fail(f"{QUERY}: expected exactly one row, got {len(rows)}: {rows!r}")
        else:
            row = rows[0]
            if int(row.get("active_count", -1)) != 2:
                fail(
                    f"{QUERY}: active_count is {row.get('active_count')!r}, expected 2 "
                    "(pending + confirmed, upcoming, this hub, this service)"
                )
            nxt = str(row.get("next_start_datetime") or "")
            if not nxt.startswith("2026-08-20T10:00"):
                fail(
                    f"{QUERY}: next_start_datetime is {nxt!r}, expected the earliest upcoming one"
                )

        # A service without appointments answers a ROW with 0 — never "no row".
        rows = run_query(q["sql"], {**base, "service_id": "svc-nobody"})
        if len(rows) != 1 or int(rows[0].get("active_count", -1)) != 0:
            fail(
                f"{QUERY}: a service with no appointments must answer one row with 0, got {rows!r}"
            )

        # The neighbour hub sees ITS one, not ours (tenancy is not negotiable).
        rows = run_query(
            q["sql"], {**base, "hub_id": OTHER_HUB, "service_id": "svc-cut"}
        )
        if len(rows) != 1 or int(rows[0].get("active_count", -1)) != 1:
            fail(
                f"{QUERY}: the neighbour hub must count only its own appointment, got {rows!r}"
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
    print(f"ok: {QUERY} — manifest wiring + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
