#!/usr/bin/env python3
"""`appointments.appointments.list_for_customer` — the visit history a customer sheet shows.

Why this file exists (appointments#46, decided in ERPlora/pm#9): «the stylist needs the last
formula and the allergy note at the chair, in two taps». The formula is a note OF THE VISIT
(`appointments_appointment.notes` / `internal_notes`, Phorest's split), so the customer sheet
needs the last N appointments of that customer with their notes and professional. `customers`
must NOT depend on `appointments` (a corner shop has customers and no agenda): the history is a
public query of THIS module and a `provides_slots` filler on the `customers.detail` host
(ADR-0043 §3bis).

The contract this file pins:

  1. MANIFEST. The query exists, is gated by `appointments.view_appointment`, is NOT a paginated
     `list` (the sheet asks for "the last N", not for pages), validates its params with a closed
     schema that requires `customer_id`, is exposed to the assistant, AND the module declares the
     `customers.detail` slot filler with the same permission.

  2. REAL POSTGRES. Against a scratch database built from this module's own migrations, the query
     returns the appointments of THAT customer in THIS hub, newest first, with notes,
     internal_notes, service and professional; not deleted; capped by `limit` (default 20 when
     omitted). Other customers and OTHER HUBS (a live neighbour) are out.

Usage: tests/list_for_customer.postgres.test.py   (exit 0 = green)
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

QUERY = "appointments.appointments.list_for_customer"
PERMISSION = "appointments.view_appointment"
SLOT = "customers.detail"
FILLER = "erp-appointments-customer-history"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_list_for_customer_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-08-19T09:00:00+02:00"

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
        fail(f"{QUERY}: must be a plain query (last N rows), not a paginated `list`")
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
        if "customer_id" not in schema.get("required", []):
            fail(f"{schema_rel}: `customer_id` must be required")
        if "limit" not in (schema.get("properties") or {}):
            fail(f"{schema_rel}: `limit` must be an accepted (optional) param")
        if schema.get("additionalProperties") is not False:
            fail(
                f"{schema_rel}: must be a closed contract (additionalProperties: false)"
            )
    if not (q.get("ai") or {}).get("description"):
        fail(
            f"{QUERY}.ai.description: missing (the assistant should be able to answer it)"
        )
    if q.get("expose_api") is not True:
        fail(
            f"{QUERY}.expose_api: must be true (public read for other modules / the API)"
        )

    fillers = [
        s
        for s in MANIFEST.get("provides_slots", [])
        if isinstance(s, dict) and s.get("slot") == SLOT
    ]
    if not fillers:
        fail(f"provides_slots: no filler for {SLOT!r} (ADR-0043 §3bis)")
    else:
        f = fillers[0]
        if f.get("component") != FILLER:
            fail(
                f"provides_slots[{SLOT}].component is {f.get('component')!r}, expected {FILLER!r}"
            )
        if f.get("permission") != PERMISSION:
            fail(
                f"provides_slots[{SLOT}].permission is {f.get('permission')!r}, expected {PERMISSION!r}"
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


def shim(sql: str) -> str:
    sql = re.sub(r"\berp_dt\(([^()]*)\)", r"((\1)::timestamptz)", sql)
    sql = re.sub(r"\berp_date\(([^()]*)\)", r"((\1)::date)", sql)
    return sql


def run_query(sql_rel: str, params: dict) -> list[dict]:
    body = shim(bind((MODULE_DIR / sql_rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def insert(
    id_: str,
    hub: str,
    customer: str,
    start: str,
    status: str,
    notes_: str = "",
    internal: str = "",
    deleted: int = 0,
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, customer_id, customer_name, service_id, "
            "service_name, service_price, staff_id, staff_name, start_datetime, end_datetime, "
            "duration_minutes, status, notes, internal_notes, is_deleted, created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(customer)}, 'Ada', 'svc-colour', 'Colour', 4500, "
            f"'st-bea', 'Bea', {literal(start)}, {literal(start)}, 60, {literal(status)}, "
            f"{literal(notes_)}, {literal(internal)}, {deleted}, '2026-08-01T00:00:00+02:00')",
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

        # Ada's visits, out of order on purpose (the query must sort newest first).
        insert(
            "v-old",
            HUB,
            "cus-ada",
            "2026-06-01T10:00:00+02:00",
            "completed",
            notes_="",
            internal="Formula 6.0 + 20 vol",
        )
        insert(
            "v-new",
            HUB,
            "cus-ada",
            "2026-08-10T10:00:00+02:00",
            "completed",
            notes_="Wants it shorter next time",
            internal="Formula 6.3 + 20 vol",
        )
        insert("v-mid", HUB, "cus-ada", "2026-07-05T10:00:00+02:00", "no_show")
        insert("v-upcoming", HUB, "cus-ada", "2026-09-01T10:00:00+02:00", "confirmed")
        # Out — each one is a way the history could lie.
        insert(
            "v-deleted",
            HUB,
            "cus-ada",
            "2026-08-11T10:00:00+02:00",
            "completed",
            deleted=1,
        )
        insert(
            "v-other-customer", HUB, "cus-bob", "2026-08-12T10:00:00+02:00", "completed"
        )
        insert(
            "v-other-hub",
            OTHER_HUB,
            "cus-ada",
            "2026-08-13T10:00:00+02:00",
            "completed",
        )

        base = {"hub_id": HUB, "current_user_id": "u-owner", "now": NOW}
        rows = run_query(q["sql"], {**base, "customer_id": "cus-ada", "limit": 20})
        ids = [r.get("id") for r in rows]
        if ids != ["v-upcoming", "v-new", "v-mid", "v-old"]:
            fail(f"{QUERY}: expected Ada's live visits newest first, got {ids!r}")
        if rows:
            newest = next((r for r in rows if r.get("id") == "v-new"), {})
            for col, want in (
                ("notes", "Wants it shorter next time"),
                ("internal_notes", "Formula 6.3 + 20 vol"),
                ("service_name", "Colour"),
                ("staff_name", "Bea"),
                ("status", "completed"),
            ):
                if newest.get(col) != want:
                    fail(
                        f"{QUERY}: row v-new.{col} is {newest.get(col)!r}, expected {want!r}"
                    )
            for col in (
                "appointment_number",
                "start_datetime",
                "end_datetime",
                "duration_minutes",
                "service_price",
                "staff_id",
                "service_id",
                "converted_sale_id",
            ):
                if col not in newest:
                    fail(f"{QUERY}: column {col!r} missing from the row")

        # `limit` caps the history (the sheet asks for the last N).
        rows = run_query(q["sql"], {**base, "customer_id": "cus-ada", "limit": 2})
        if [r.get("id") for r in rows] != ["v-upcoming", "v-new"]:
            fail(
                f"{QUERY}: limit=2 must keep the two newest, got {[r.get('id') for r in rows]!r}"
            )

        # Omitted `limit` (NULL bind) still answers, with the default cap.
        rows = run_query(q["sql"], {**base, "customer_id": "cus-ada", "limit": None})
        if len(rows) != 4:
            fail(
                f"{QUERY}: without limit expected the 4 visits (default cap), got {len(rows)}"
            )

        # A customer without visits answers no rows (the sheet shows its empty state).
        rows = run_query(q["sql"], {**base, "customer_id": "cus-nobody", "limit": 20})
        if rows:
            fail(
                f"{QUERY}: a customer with no visits must answer no rows, got {rows!r}"
            )

        # The neighbour hub sees ITS one, not ours (tenancy is not negotiable).
        rows = run_query(
            q["sql"],
            {**base, "hub_id": OTHER_HUB, "customer_id": "cus-ada", "limit": 20},
        )
        if [r.get("id") for r in rows] != ["v-other-hub"]:
            fail(
                f"{QUERY}: the neighbour hub must see only its own visit, got {[r.get('id') for r in rows]!r}"
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
    print(f"ok: {QUERY} — manifest wiring + slot filler + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
