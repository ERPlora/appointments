#!/usr/bin/env python3
"""customers#86 (appointments layer) — when two customer sheets are merged, the agenda follows the survivor.

`customers.merge` retires the absorbed sheet (soft delete) and publishes `customer.merged` with
`{surviving_id, absorbed_id, hub_id}` (customers#87). `appointments` stores the customer as an
OPAQUE id (no cross-module foreign key) in two tables: `appointments_appointment` (every visit) and
`appointments_recurring` (the series template that materialises future visits). Unless this module
re-points both, the survivor's visit history misses every appointment booked under the duplicate
sheet, and a recurring series keeps producing visits for a sheet that no longer exists.

WHAT IS PROVEN HERE, against a REAL Postgres:

  1. The manifest listens to `customer.merged` with an internal, transactional command that emits
     nothing and has no `expect_rows` (merging a customer who never booked is normal), gated by a
     permission the module declares.
  2. Appointments — live and soft-deleted, any status — and recurring series — active, inactive and
     soft-deleted — move to the survivor; nothing else on the row (number, names, service, staff,
     times, status, notes) changes.
  3. It does not require the absorbed sheet to exist: no `customers` table in this database.
  4. Rows of other customers, and rows without a customer, are untouched.
  5. IDEMPOTENCE — the outbox is at-least-once; a redelivery changes nothing (not even updated_at).
  6. A degenerate event (`surviving_id = absorbed_id`) is a no-op.
  7. TENANCY — rows of the hub next door carrying the absorbed id (or the survivor's) are NOT
     re-pointed, in BOTH tables: the same opaque string may name someone else there.

Runs the SQL the way the runtime does (`:name` bound). Uses `erplora-test-pg-5433` (override:
ERPLORA_TEST_PG_CONTAINER); scratch DB dropped at the end. Missing Docker = SKIPPED, never PASS.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from module_migrations import (  # noqa: E402
    migration_entries,
    migration_sql,
    split_statements,
    strip_comments,
)

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
EVENT = "customer.merged"
LISTENER = "appointments._on_customer_merged"
HUB = "hub-test"
OTHER_HUB = "hub-other"
SURVIVOR = "cust-ana"
ABSORBED = "cust-ana-dup"
CREATED = "2026-08-01T00:00:00+00:00"
NOW = "2026-09-26T10:00:00+00:00"
LATER = "2026-09-26T11:00:00+00:00"
TABLES = ("appointments_appointment", "appointments_recurring")

failures: list[str] = []


def check(label, expected, actual):
    if expected != actual:
        failures.append(f"{label} — expected [{expected}], got [{actual}]")
        print(f"  FAIL: {label} — expected [{expected}], got [{actual}]")
    else:
        print(f"  ok: {label} = {expected}")


def psql(db, sql):
    r = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-U",
            "postgres",
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-X",
            "-tA",
        ],
        input=sql,
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip())
    return r.stdout


def literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


PARAM = re.compile(r"(?<!:):([a-z_][a-z0-9_]*)")  # `::` is a cast, never a bind


def merge(db, hub=HUB, surviving=SURVIVOR, absorbed=ABSORBED, now=NOW):
    """Deliver `customer.merged` the way the outbox relay does: the payload IS the emitter's params."""
    cmd = MANIFEST["commands"][LISTENER]
    params = {
        "surviving_id": surviving,
        "absorbed_id": absorbed,
        "hub_id": hub,
        "current_user_id": "user-merger",
        "now": now,
    }
    script = ["BEGIN;"]
    for rel in cmd["sql"]:
        script.append(
            PARAM.sub(
                lambda m: literal(params.get(m.group(1))),
                (MODULE_DIR / rel).read_text(),
            )
        )
    script.append("COMMIT;")
    psql(db, "\n".join(script))


def appointment(db, aid, hub, customer, status="confirmed", deleted=0):
    psql(
        db,
        "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, customer_name, "
        "customer_phone, staff_id, staff_name, service_id, service_name, service_price, start_datetime, "
        "end_datetime, duration_minutes, status, notes, internal_notes, is_deleted, created_at) VALUES ("
        f"{literal(aid)}, {literal(hub)}, {literal('APT-' + aid)}, {literal(customer)}, 'ana garcia', "
        "'600000000', 'staff-1', 'Marta', 'svc-cut', 'Cut', 2500, '2026-10-01T10:00:00+02:00', "
        f"'2026-10-01T10:30:00+02:00', 30, {literal(status)}, 'formula 6.1', 'allergic to PPD', "
        f"{deleted}, '{CREATED}')",
    )


def recurring(db, rid, hub, customer, active=1, deleted=0):
    psql(
        db,
        "INSERT INTO appointments_recurring (id, hub_id, customer_id, customer_name, service_id, service_name, "
        "staff_id, staff_name, frequency, day_of_week, time, duration_minutes, start_date, is_active, "
        f"is_deleted, created_at) VALUES ({literal(rid)}, {literal(hub)}, {literal(customer)}, 'ana garcia', "
        "'svc-cut', 'Cut', 'staff-1', 'Marta', 'weekly', 2, '10:00', 30, '2026-10-01', "
        f"{active}, {deleted}, '{CREATED}')",
    )


APPOINTMENT_COLS = (
    "customer_id, appointment_number, customer_name, customer_phone, staff_id, service_id, service_price, "
    "start_datetime, end_datetime, status, notes, internal_notes, is_deleted, updated_by, updated_at"
)
RECURRING_COLS = (
    "customer_id, customer_name, service_id, staff_id, frequency, day_of_week, time, start_date, is_active, "
    "is_deleted, updated_by, updated_at"
)


def row(db, table, rid) -> dict:
    cols = APPOINTMENT_COLS if table == "appointments_appointment" else RECURRING_COLS
    out = psql(
        db,
        f"SELECT row_to_json(r) FROM (SELECT {cols} FROM {table} WHERE id = '{rid}') r;",
    )
    return json.loads(out.strip()) if out.strip() else {}


def fingerprint(db, hub) -> str:
    """Every row of both tables for one hub, in a byte-stable order (COLLATE "C", not the locale)."""
    parts = []
    for table in TABLES:
        parts.append(
            psql(
                db,
                "SELECT COALESCE(string_agg(x, '|' ORDER BY x COLLATE \"C\"), '') FROM ("
                f" SELECT '{table}:' || id || ':' || COALESCE(customer_id, '-') || ':'"
                " || COALESCE(updated_by, '-') || ':' || COALESCE(updated_at, '-') AS x"
                f"   FROM {table} WHERE hub_id = '{hub}') t;",
            ).strip()
        )
    return "#".join(parts)


def manifest_half():
    print("== the manifest declares the ear ==")
    listen = (MANIFEST.get("events") or {}).get("listen", {})
    check(
        f"`{EVENT}` is listened to", LISTENER, (listen.get(EVENT) or {}).get("command")
    )
    cmd = MANIFEST["commands"].get(LISTENER)
    check(f"`{LISTENER}` exists", True, cmd is not None)
    if cmd is None:
        return False
    check(
        "it is internal (leading `_`)", True, LISTENER.rsplit(".", 1)[1].startswith("_")
    )
    check("it is transactional", True, cmd.get("transaction"))
    check("it carries SQL", True, bool(cmd.get("sql")))
    # Postgres runs each `sql[]` file as ONE prepared statement and rejects a second command in it.
    for rel in cmd.get("sql") or []:
        statements = [
            x for x in split_statements(strip_comments((MODULE_DIR / rel).read_text())) if x.strip()
        ]
        check(f"{rel} holds a single statement (one prepared statement in Postgres)", 1, len(statements))
    check("it emits nothing", None, cmd.get("emit"))
    check(
        "it has no expect_rows (a customer who never booked is normal)",
        None,
        cmd.get("expect_rows"),
    )
    declared = {
        p if isinstance(p, str) else p.get("codename")
        for p in MANIFEST.get("permissions", [])
    }
    check(
        "its permission is declared by the module",
        True,
        cmd.get("permission") in declared,
    )
    return True


def main() -> int:
    wired = manifest_half()
    ready = subprocess.run(
        ["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"],
        capture_output=True,
        text=True,
    )
    if ready.returncode != 0:
        print(
            f"SKIPPED: no Postgres in container {CONTAINER} (the SQL half was not verified)"
        )
        return 1 if failures else 0
    if not wired:
        print(f"\nFAILED — {len(failures)} assertion(s)")
        return 1

    db = f"appointments_merge_{uuid.uuid4().hex[:8]}"
    subprocess.run(
        ["docker", "exec", CONTAINER, "createdb", "-U", "postgres", db], check=True
    )
    try:
        for rel, kind in migration_entries():
            psql(db, migration_sql(rel, kind))

        # This hub: the survivor booked once; the duplicate sheet booked under the other spelling.
        appointment(db, "a-surv", HUB, SURVIVOR)
        appointment(db, "a-abs-next", HUB, ABSORBED, status="confirmed")
        appointment(db, "a-abs-done", HUB, ABSORBED, status="completed")
        appointment(db, "a-abs-noshow", HUB, ABSORBED, status="no_show")
        appointment(db, "a-abs-deleted", HUB, ABSORBED, status="cancelled", deleted=1)
        appointment(db, "a-someone", HUB, "cust-luis")
        appointment(db, "a-walk-in", HUB, None)
        recurring(db, "r-abs-active", HUB, ABSORBED)
        recurring(db, "r-abs-paused", HUB, ABSORBED, active=0)
        recurring(db, "r-abs-deleted", HUB, ABSORBED, deleted=1)
        recurring(db, "r-someone", HUB, "cust-luis")
        # The hub next door: the SAME opaque ids name other people there.
        appointment(db, "n-abs", OTHER_HUB, ABSORBED)
        appointment(db, "n-abs-deleted", OTHER_HUB, ABSORBED, deleted=1)
        appointment(db, "n-surv", OTHER_HUB, SURVIVOR)
        recurring(db, "nr-abs", OTHER_HUB, ABSORBED)
        recurring(db, "nr-abs-deleted", OTHER_HUB, ABSORBED, deleted=1)
        neighbour_before = fingerprint(db, OTHER_HUB)
        check(
            "no `customers` table here: the listener cannot depend on the absorbed sheet",
            "",
            psql(db, "SELECT to_regclass('customers_customer');").strip(),
        )
        check(
            "the neighbour really holds rows on the absorbed id in BOTH tables (the control is armed)",
            ("2", "2"),
            tuple(
                psql(
                    db,
                    f"SELECT count(*) FROM {t} WHERE hub_id = '{OTHER_HUB}' AND customer_id = '{ABSORBED}';",
                ).strip()
                for t in TABLES
            ),
        )
        before = {
            ("appointments_appointment", "a-abs-next"): row(
                db, "appointments_appointment", "a-abs-next"
            ),
            ("appointments_recurring", "r-abs-active"): row(
                db, "appointments_recurring", "r-abs-active"
            ),
        }

        print("\n== the appointments and the series follow the survivor ==")
        merge(db)
        moved = [
            ("appointments_appointment", a)
            for a in ("a-abs-next", "a-abs-done", "a-abs-noshow", "a-abs-deleted")
        ]
        moved += [
            ("appointments_recurring", r)
            for r in ("r-abs-active", "r-abs-paused", "r-abs-deleted")
        ]
        for table, rid in moved:
            r = row(db, table, rid)
            check(
                f"{table}/{rid} now belongs to the survivor",
                SURVIVOR,
                r.get("customer_id"),
            )
            check(
                f"{table}/{rid} stamps updated_at with the server clock",
                NOW,
                r.get("updated_at"),
            )
            check(
                f"{table}/{rid} stamps who did it", "user-merger", r.get("updated_by")
            )
        for (table, rid), old in before.items():
            new = row(db, table, rid)
            untouched = {
                k: v
                for k, v in old.items()
                if k not in ("customer_id", "updated_by", "updated_at")
            }
            check(
                f"{table}/{rid}: nothing but the customer (and its stamp) changed",
                untouched,
                {k: new.get(k) for k in untouched},
            )
        check(
            "the survivor's own appointment is untouched",
            (SURVIVOR, None),
            tuple(
                row(db, "appointments_appointment", "a-surv").get(k)
                for k in ("customer_id", "updated_at")
            ),
        )
        for table, rid in (
            ("appointments_appointment", "a-someone"),
            ("appointments_recurring", "r-someone"),
        ):
            check(
                f"another customer's row is untouched ({table})",
                ("cust-luis", None),
                tuple(
                    row(db, table, rid).get(k) for k in ("customer_id", "updated_at")
                ),
            )
        check(
            "a walk-in appointment stays without customer",
            (None, None),
            tuple(
                row(db, "appointments_appointment", "a-walk-in").get(k)
                for k in ("customer_id", "updated_at")
            ),
        )
        for t in TABLES:
            check(
                f"nothing is left on the absorbed id in this hub ({t})",
                "0",
                psql(
                    db,
                    f"SELECT count(*) FROM {t} WHERE hub_id = '{HUB}' AND customer_id = '{ABSORBED}';",
                ).strip(),
            )

        print("\n== tenancy: the hub next door is not touched ==")
        check(
            "hub B rows pointing at the absorbed id are NOT re-pointed",
            neighbour_before,
            fingerprint(db, OTHER_HUB),
        )

        print("\n== idempotent: a redelivery changes nothing ==")
        after_first = fingerprint(db, HUB)
        merge(db, now=LATER)
        check(
            "a second delivery moves nothing and stamps nothing",
            after_first,
            fingerprint(db, HUB),
        )

        print("\n== a degenerate event (surviving = absorbed) is a no-op ==")
        merge(db, surviving=SURVIVOR, absorbed=SURVIVOR, now=LATER)
        check(
            "the survivor's rows are not re-stamped", after_first, fingerprint(db, HUB)
        )
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", db]
        )

    print()
    if failures:
        print(f"FAILED — {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "PASS — a merged customer keeps every appointment and recurring series (customers#86)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
