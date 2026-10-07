#!/usr/bin/env python3
"""pm#637 (appointments layer) — when a customer's personal data is erased, the agenda forgets her too.

`customers.anonymize` is the platform's GDPR erasure (art. 17, customers#11). It rewrites the sheet
and publishes `customer.anonymized` with `{customer_id, reason, hub_id}`. `appointments` COPIES the
customer into its own rows when she books — name, phone, email, the two free-text notes (the
internal one may carry an allergy: health data) and the cancellation reason — and the history keeps
the name of the booking and the reason of every cancellation. Unless this module listens, all of
that outlives the erasure (APPOINTMENTS-F24).

WHAT IS PROVEN HERE, against a REAL Postgres:

  1. The manifest listens to `customer.anonymized` with an internal, transactional command that
     emits nothing and has no `expect_rows` (erasing a customer who never booked is normal), gated
     by a permission the module declares; one statement per `sql[]` file.
  2. Appointments — live and soft-deleted, any status — lose name, phone, email, both notes and the
     cancellation reason; what the business keeps (number, customer id, service, price,
     professional, times, status, deletion flag) is untouched.
  3. Recurring series lose the customer's name and keep everything else (active flag included).
  4. History: the `created` line loses the customer's name and a `cancelled` line its reason, every
     other key of the JSON survives; a value that is not a JSON object is dropped (it could hold
     anything), and a line with nothing personal is not touched.
  5. IDEMPOTENCE, arm by arm — the outbox is at-least-once. A row that is already erased is not
     re-stamped, and a row that still holds ONE personal column (each one in turn) IS erased: every
     arm of the guard has a row that only it catches.
  6. Rows of other customers, rows without a customer, and an event with an empty id are no-ops.
  7. TENANCY — rows of the hub next door carrying the same opaque customer id are NOT touched, in
     the four tables.
  8. The RETIRED slot holds (appointments#314): `_deprecated_appointments_slot_hold` kept, as the
     `label` of every hold, the name or the phone of whoever asked for it — and no link to the
     sheet, so hers cannot be told from anyone else's. Every label of THIS hub is blanked (the
     holds expired 15 minutes after they were made; nothing reads them since appointments#184);
     the rest of the row stays, an already blank label is not re-stamped, and the hub next door
     keeps its own.

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
EVENT = "customer.anonymized"
LISTENER = "appointments._on_customer_anonymized"
HUB = "hub-test"
OTHER_HUB = "hub-other"
ERASED = "cust-ana"
SOMEONE = "cust-luis"
CREATED = "2026-08-01T00:00:00+00:00"
NOW = "2026-10-07T10:00:00+00:00"
LATER = "2026-10-07T11:00:00+00:00"
HOLDS = "_deprecated_appointments_slot_hold"  # set aside by migration 011 (appointments#187)
TABLES = ("appointments_appointment", "appointments_recurring", "appointments_history", HOLDS)

# The columns of an appointment that name or describe the customer, and the value each one takes
# when she is fully booked in the seed.
PERSONAL = {
    "customer_name": "Ana García",
    "customer_phone": "+34600000000",
    "customer_email": "ana@example.com",
    "notes": "prefers the window seat",
    "internal_notes": "allergic to PPD",
    "cancellation_reason": "she moved to Paris",
}
# What the business keeps on an erased appointment.
KEPT = (
    "appointment_number, customer_id, staff_id, staff_name, service_id, service_name, service_price, "
    "start_datetime, end_datetime, duration_minutes, status, is_deleted, created_at"
)

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


def erase(db, hub=HUB, customer=ERASED, now=NOW):
    """Deliver `customer.anonymized` the way the outbox relay does: the payload IS the emitter's
    params, and the runtime adds `hub_id`, `current_user_id` and `now`."""
    cmd = MANIFEST["commands"][LISTENER]
    params = {
        "customer_id": customer,
        "reason": "GDPR request",
        "hub_id": hub,
        "current_user_id": "user-eraser",
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


ERP_DATE = re.compile(r"\berp_date\(([^()]*)\)")  # bridge function (ADR-0007 §4a), Postgres form


def query_rows(db, rel, params) -> list:
    """Run one of the module's read queries with its binds the way the runtime fills them."""
    sql = strip_comments((MODULE_DIR / rel).read_text()).strip().rstrip(";")
    sql = ERP_DATE.sub(r"((\1)::date)", sql)
    sql = PARAM.sub(lambda m: literal(params.get(m.group(1))), sql)
    out = psql(db, f"SELECT COALESCE(json_agg(q), '[]') FROM ({sql}) q;")
    return json.loads(out.strip())


def appointment(db, aid, hub, customer, status="confirmed", deleted=0, **personal):
    values = {k: personal.get(k, v) for k, v in PERSONAL.items()}
    psql(
        db,
        "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, customer_name, "
        "customer_phone, customer_email, staff_id, staff_name, service_id, service_name, service_price, "
        "start_datetime, end_datetime, duration_minutes, status, notes, internal_notes, cancellation_reason, "
        f"is_deleted, created_at) VALUES ({literal(aid)}, {literal(hub)}, {literal('APT-' + aid)}, "
        f"{literal(customer)}, {literal(values['customer_name'])}, {literal(values['customer_phone'])}, "
        f"{literal(values['customer_email'])}, 'staff-1', 'Marta', 'svc-cut', 'Cut', 2500, "
        "'2026-10-01T10:00:00+02:00', '2026-10-01T10:30:00+02:00', 30, "
        f"{literal(status)}, {literal(values['notes'])}, {literal(values['internal_notes'])}, "
        f"{literal(values['cancellation_reason'])}, {deleted}, '{CREATED}')",
    )


def recurring(db, rid, hub, customer, name="Ana García", active=1, deleted=0):
    psql(
        db,
        "INSERT INTO appointments_recurring (id, hub_id, customer_id, customer_name, service_id, service_name, "
        "staff_id, staff_name, frequency, day_of_week, time, duration_minutes, start_date, is_active, "
        f"is_deleted, created_at) VALUES ({literal(rid)}, {literal(hub)}, {literal(customer)}, {literal(name)}, "
        "'svc-cut', 'Cut', 'staff-1', 'Marta', 'weekly', 2, '10:00', 30, '2026-10-01', "
        f"{active}, {deleted}, '{CREATED}')",
    )


def history(db, hid, hub, appointment_id, action, new_value, old_value=None):
    psql(
        db,
        "INSERT INTO appointments_history (id, hub_id, appointment_id, action, description, performed_by, "
        f"old_value, new_value, created_at) VALUES ({literal(hid)}, {literal(hub)}, {literal(appointment_id)}, "
        f"{literal(action)}, 'Appointment line', 'user-1', {literal(old_value)}, {literal(new_value)}, '{CREATED}')",
    )


def hold(db, hid, hub, label, status="expired"):
    """A slot hold as the retired WhatsApp tray left it: the label is what the agenda painted on
    the held slot — the customer's name, or her phone when the request had no name."""
    psql(
        db,
        f"INSERT INTO {HOLDS} (id, hub_id, staff_id, source, source_ref, start_datetime, end_datetime, "
        f"expires_at, label, status, created_at) VALUES ({literal(hid)}, {literal(hub)}, 'staff-1', "
        f"'whatsapp_inbox.request', {literal('req-' + hid)}, '2026-09-01T10:00:00+02:00', "
        "'2026-09-01T10:30:00+02:00', '2026-08-31T18:15:00+00:00', "
        f"{literal(label)}, {literal(status)}, '{CREATED}')",
    )


def row(db, table, rid, cols="*") -> dict:
    out = psql(
        db,
        f"SELECT row_to_json(r) FROM (SELECT {cols} FROM {table} WHERE id = '{rid}') r;",
    )
    return json.loads(out.strip()) if out.strip() else {}


def fingerprint(db, hub) -> str:
    """Every row of the three tables for one hub, personal columns and stamp included, in a
    byte-stable order (COLLATE "C", not the locale)."""
    parts = []
    for table in TABLES:
        parts.append(
            psql(
                db,
                "SELECT COALESCE(string_agg(x, '|' ORDER BY x COLLATE \"C\"), '') FROM ("
                f" SELECT row_to_json(t)::text AS x FROM {table} t WHERE hub_id = '{hub}') s;",
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
    check("it carries one SQL file per table", len(TABLES), len(cmd.get("sql") or []))
    for rel in cmd.get("sql") or []:
        statements = [
            x
            for x in split_statements(strip_comments((MODULE_DIR / rel).read_text()))
            if x.strip()
        ]
        check(
            f"{rel} holds a single statement (one prepared statement in Postgres)",
            1,
            len(statements),
        )
    check("it emits nothing", None, cmd.get("emit"))
    check("it has no schema (the payload is the neighbour's)", None, cmd.get("schema"))
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

    db = f"appointments_erase_{uuid.uuid4().hex[:8]}"
    subprocess.run(
        ["docker", "exec", CONTAINER, "createdb", "-U", "postgres", db], check=True
    )
    try:
        for rel, kind in migration_entries():
            psql(db, migration_sql(rel, kind))

        blank = {k: "" for k in PERSONAL}
        # This hub: the erased customer, every status, live and soft-deleted.
        appointment(db, "a-next", HUB, ERASED, status="confirmed")
        appointment(db, "a-done", HUB, ERASED, status="completed")
        appointment(db, "a-cancelled", HUB, ERASED, status="cancelled")
        appointment(db, "a-deleted", HUB, ERASED, status="cancelled", deleted=1)
        # Already erased before (a previous delivery), except ONE personal column each: the row
        # only that arm of the guard catches.
        for col in PERSONAL:
            appointment(
                db, f"a-only-{col}", HUB, ERASED, **{**blank, col: PERSONAL[col]}
            )
        appointment(db, "a-already", HUB, ERASED, **blank)
        # Everyone else in this hub.
        appointment(db, "a-someone", HUB, SOMEONE)
        appointment(db, "a-walk-in", HUB, None)
        appointment(db, "a-blank-id", HUB, "")
        recurring(db, "r-active", HUB, ERASED)
        recurring(db, "r-paused", HUB, ERASED, active=0)
        recurring(db, "r-deleted", HUB, ERASED, deleted=1)
        recurring(db, "r-already", HUB, ERASED, name="")
        recurring(db, "r-someone", HUB, SOMEONE)
        recurring(db, "r-blank-id", HUB, "")
        created = json.dumps(
            {
                "customer_name": "Ana García",
                "duration_minutes": 30,
                "service_name": "Cut",
                "start_datetime": "2026-10-01T10:00:00+02:00",
                "status": "pending",
            }
        )
        cancelled = json.dumps(
            {
                "channel": "customer",
                "reason": "she moved to Paris",
                "status": "cancelled",
            }
        )
        history(db, "h-created", HUB, "a-next", "created", created)
        history(db, "h-cancelled", HUB, "a-cancelled", "cancelled", cancelled)
        history(
            db,
            "h-confirmed",
            HUB,
            "a-next",
            "confirmed",
            '{"status":"confirmed"}',
            '{"status":"pending"}',
        )
        history(
            db,
            "h-reason-blank",
            HUB,
            "a-done",
            "cancelled",
            '{"reason":"","status":"cancelled"}',
        )
        history(
            db, "h-unreadable", HUB, "a-done", "cancelled", '{"reason":"broken \\"}'
        )
        history(db, "h-null", HUB, "a-done", "completed", None)
        history(db, "h-someone", HUB, "a-someone", "created", created)
        # The hub next door: the SAME opaque id names another person there.
        appointment(db, "n-erased", OTHER_HUB, ERASED)
        appointment(db, "n-erased-deleted", OTHER_HUB, ERASED, deleted=1)
        recurring(db, "nr-erased", OTHER_HUB, ERASED)
        history(db, "nh-created", OTHER_HUB, "n-erased", "created", created)
        # Lines that point at an appointment id the OTHER hub wrote: an id is only trusted in the
        # hub that wrote it, on both sides of the history's subselect.
        history(db, "nh-on-our-id", OTHER_HUB, "a-next", "created", created)
        history(db, "h-on-their-id", HUB, "n-erased", "created", created)
        # A walk-in's line (no sheet): only the blank-id event could reach it.
        history(db, "h-blank-id", HUB, "a-blank-id", "created", created)
        # The retired slot holds: hers by name and by phone, someone else's, one already blank.
        hold(db, "s-name", HUB, "Ana García")
        hold(db, "s-phone", HUB, "+34600000000", status="consumed")
        hold(db, "s-someone", HUB, "Luis Pérez", status="released")
        hold(db, "s-blank", HUB, "")
        hold(db, "ns-name", OTHER_HUB, "Ana García")
        neighbour_before = fingerprint(db, OTHER_HUB)
        check(
            "the neighbour really holds personal rows on the erased id in the four tables (control armed)",
            ("2", "1", "2", "1"),
            (
                psql(
                    db,
                    f"SELECT count(*) FROM appointments_appointment WHERE hub_id = '{OTHER_HUB}' "
                    f"AND customer_id = '{ERASED}' AND customer_phone <> '';",
                ).strip(),
                psql(
                    db,
                    f"SELECT count(*) FROM appointments_recurring WHERE hub_id = '{OTHER_HUB}' "
                    f"AND customer_id = '{ERASED}' AND customer_name <> '';",
                ).strip(),
                psql(
                    db,
                    f"SELECT count(*) FROM appointments_history WHERE hub_id = '{OTHER_HUB}' "
                    "AND new_value LIKE '%Ana%';",
                ).strip(),
                psql(
                    db,
                    f"SELECT count(*) FROM {HOLDS} WHERE hub_id = '{OTHER_HUB}' AND label <> '';",
                ).strip(),
            ),
        )
        kept_before = {
            a: row(db, "appointments_appointment", a, KEPT)
            for a in ("a-next", "a-deleted")
        }
        series_before = row(db, "appointments_recurring", "r-paused")
        untouched_before = {
            ("appointments_appointment", "a-already"): row(
                db, "appointments_appointment", "a-already"
            ),
            ("appointments_appointment", "a-someone"): row(
                db, "appointments_appointment", "a-someone"
            ),
            ("appointments_appointment", "a-walk-in"): row(
                db, "appointments_appointment", "a-walk-in"
            ),
            ("appointments_appointment", "a-blank-id"): row(
                db, "appointments_appointment", "a-blank-id"
            ),
            ("appointments_recurring", "r-already"): row(
                db, "appointments_recurring", "r-already"
            ),
            ("appointments_recurring", "r-someone"): row(
                db, "appointments_recurring", "r-someone"
            ),
            ("appointments_history", "h-confirmed"): row(
                db, "appointments_history", "h-confirmed"
            ),
            ("appointments_history", "h-reason-blank"): row(
                db, "appointments_history", "h-reason-blank"
            ),
            ("appointments_history", "h-null"): row(
                db, "appointments_history", "h-null"
            ),
            ("appointments_history", "h-someone"): row(
                db, "appointments_history", "h-someone"
            ),
            ("appointments_history", "h-on-their-id"): row(
                db, "appointments_history", "h-on-their-id"
            ),
            ("appointments_history", "h-blank-id"): row(
                db, "appointments_history", "h-blank-id"
            ),
            ("appointments_recurring", "r-blank-id"): row(
                db, "appointments_recurring", "r-blank-id"
            ),
            (HOLDS, "s-blank"): row(db, HOLDS, "s-blank"),
        }
        # What a hold keeps once its label is gone: everything but the label and its stamp.
        hold_kept = "id, hub_id, staff_id, source, source_ref, start_datetime, end_datetime, expires_at, status, is_deleted, deleted_at, created_by, created_at"
        holds_before = {s: row(db, HOLDS, s, hold_kept) for s in ("s-name", "s-phone", "s-someone")}

        print("\n== an event with an empty id erases nothing ==")
        before_blank = fingerprint(db, HUB)
        erase(db, customer="")
        check("the blank-id event is a no-op", before_blank, fingerprint(db, HUB))

        print("\n== the appointments forget who she was ==")
        erase(db)
        erased = ["a-next", "a-done", "a-cancelled", "a-deleted"] + [
            f"a-only-{c}" for c in PERSONAL
        ]
        for aid in erased:
            r = row(db, "appointments_appointment", aid)
            check(
                f"{aid}: every personal column is empty",
                blank,
                {k: r.get(k) for k in PERSONAL},
            )
            check(
                f"{aid}: stamped with the server clock and the actor",
                (NOW, "user-eraser"),
                (r.get("updated_at"), r.get("updated_by")),
            )
        for aid, old in kept_before.items():
            check(
                f"{aid}: what the business keeps is untouched",
                old,
                row(db, "appointments_appointment", aid, KEPT),
            )

        print("\n== the series forget her name ==")
        for rid in ("r-active", "r-paused", "r-deleted"):
            r = row(db, "appointments_recurring", rid)
            check(f"{rid}: the customer's name is empty", "", r.get("customer_name"))
            check(
                f"{rid}: stamped",
                (NOW, "user-eraser"),
                (r.get("updated_at"), r.get("updated_by")),
            )
        after = row(db, "appointments_recurring", "r-paused")
        check(
            "r-paused: nothing but the name (and its stamp) changed",
            {
                k: v
                for k, v in series_before.items()
                if k not in ("customer_name", "updated_by", "updated_at")
            },
            {
                k: v
                for k, v in after.items()
                if k not in ("customer_name", "updated_by", "updated_at")
            },
        )
        # The Periódicas screen paints «Deleted customer» for a blank name WITH a link: the list
        # query must hand the link over, or the series reads «—» like one with no customer.
        listed = {
            r["id"]: r
            for r in query_rows(db, "queries/recurring_list.sql", {"hub_id": HUB})
        }
        check(
            "the series list hands over the link and the blank name",
            (ERASED, ""),
            (
                listed.get("r-active", {}).get("customer_id"),
                listed.get("r-active", {}).get("customer_name"),
            ),
        )

        # The overlap question of the agenda reads the same-day list
        # (`appointments.appointments.conflicting`): the same rule applies — «Deleted customer» needs
        # the link — so that query hands `customer_id` over too, or the question would call her
        # just «Customer».
        same_day = {
            r["id"]: r
            for r in query_rows(
                db,
                "queries/appointments_conflicting.sql",
                {"hub_id": HUB, "staff_id": "", "start_datetime": "2026-10-01T10:00:00+02:00"},
            )
        }
        check(
            "the same-day list behind the overlap question hands over the link and the blank name",
            (ERASED, ""),
            (
                same_day.get("a-next", {}).get("customer_id"),
                same_day.get("a-next", {}).get("customer_name"),
            ),
        )

        print("\n== the history forgets her name and her reasons ==")
        h = row(db, "appointments_history", "h-created")
        check(
            "the `created` line loses the name and keeps the rest",
            {**json.loads(created), "customer_name": ""},
            json.loads(h.get("new_value") or "null"),
        )
        check(
            "h-created stamped",
            (NOW, "user-eraser"),
            (h.get("updated_at"), h.get("updated_by")),
        )
        h = row(db, "appointments_history", "h-cancelled")
        check(
            "the `cancelled` line loses the reason and keeps the rest",
            {**json.loads(cancelled), "reason": ""},
            json.loads(h.get("new_value") or "null"),
        )
        h = row(db, "appointments_history", "h-unreadable")
        check("a value that is not a JSON object is dropped", None, h.get("new_value"))
        check("h-unreadable stamped", NOW, h.get("updated_at"))
        print("\n== the retired slot holds forget every label of this hub ==")
        for sid, old in holds_before.items():
            r = row(db, HOLDS, sid)
            check(f"{sid}: the label is empty", "", r.get("label"))
            check(
                f"{sid}: stamped",
                (NOW, "user-eraser"),
                (r.get("updated_at"), r.get("updated_by")),
            )
            check(f"{sid}: the rest of the hold is untouched", old, row(db, HOLDS, sid, hold_kept))
        check(
            "no label is left in this hub's retired slot holds",
            "0",
            psql(db, f"SELECT count(*) FROM {HOLDS} WHERE hub_id = '{HUB}' AND label <> '';").strip(),
        )

        for (table, rid), old in untouched_before.items():
            check(f"{table}/{rid} is untouched", old, row(db, table, rid))

        print("\n== tenancy: the hub next door is not touched ==")
        check(
            "hub B rows on the same id keep everything",
            neighbour_before,
            fingerprint(db, OTHER_HUB),
        )

        print("\n== idempotent: a redelivery changes nothing ==")
        after_first = fingerprint(db, HUB)
        erase(db, now=LATER)
        check(
            "a second delivery erases nothing more and stamps nothing",
            after_first,
            fingerprint(db, HUB),
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
        "PASS — an erased customer leaves no name, contact, note or reason in the agenda (pm#637, appointments#314)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
