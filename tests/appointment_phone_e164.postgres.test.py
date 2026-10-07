#!/usr/bin/env python3
"""The appointments already booked get their phone in E.164 — the read and the write of the
scheduled task `phones_to_e164` (ERPlora/appointments#313).

The «appointment confirmed» WhatsApp finds the conversation by the appointment's phone, by the
exact international number (WHATSAPP_INBOX-F23). An appointment booked before Customers saved cards
in E.164, or whose phone was corrected by hand, kept the phone as typed («600 111 222») and the
notice reached nobody. Every write of the handler goes through the hub's one reading now
(`erplora_guest_sdk::phone`, HUB-F36); the ones already saved are rewritten by the internal command
`appointments._phones_to_e164`, run per hub by a scheduled task. A migration cannot do it: it gets
no `:hub_id`, so it cannot read the hub's country (the same reason as customers#121).

What this battery holds, against the module's own migrations:

  0. the manifest declares the read, the write, the internal command and its scheduled task;
  1. the read hands over the upcoming pending or confirmed appointments of ITS hub whose phone is
     not E.164 yet, each with the hub's country (`hub_settings.country_code`; none → empty, which
     the handler reads as Spain);
  2. it leaves out a past appointment, a cancelled or completed one, a deleted one, an empty phone,
     a phone already in E.164 and another hub's appointment;
  3. the write saves the new phone only while the appointment still carries the old text (a phone
     edited between the read and the write is not overwritten), stamps `updated_at`, and never
     reaches another hub's appointment nor a deleted one.

Usage: tests/appointment_phone_e164.postgres.test.py   (exit 0 = green)
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
DB = f"appointments_phone_e164_test_{os.getpid()}"
HUB = "hub-under-test"
HUB_GB = "hub-gb"
OTHER_HUB = "hub-neighbour"
READ = "appointments.appointments.phones_to_e164"
SWEEP = "appointments._phones_to_e164"
WRITE = "appointments._set_phone"
NOW = "2026-09-20T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def check_manifest() -> None:
    queries = MANIFEST.get("queries", {})
    commands = MANIFEST.get("commands", {})
    read = queries.get(READ) or {}
    if read.get("sql") != "queries/appointments_phones_to_e164.sql":
        fail(f"{READ}: not declared with its sql ({read!r})")
    sweep = commands.get(SWEEP) or {}
    if not sweep.get("internal"):
        fail(f"{SWEEP}: it must be internal (only the scheduler runs it): {sweep!r}")
    if (sweep.get("handler") or {}).get("function") != "phones_to_e164":
        fail(f"{SWEEP}: it does not run the handler `phones_to_e164`: {sweep!r}")
    if [r.get("query") for r in sweep.get("reads") or []] != [READ]:
        fail(f"{SWEEP}: its read is not {READ}: {sweep.get('reads')!r}")
    if (commands.get(WRITE) or {}).get("sql") != ["commands/_set_phone.sql"]:
        fail(
            f"{WRITE}: not declared with commands/_set_phone.sql ({commands.get(WRITE)!r})"
        )
    tasks = [
        t
        for t in MANIFEST.get("scheduled_tasks") or []
        if t.get("name") == "phones_to_e164"
    ]
    if not tasks or tasks[0].get("command") != SWEEP:
        fail(f"the scheduled task phones_to_e164 does not run {SWEEP}: {tasks!r}")


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


def shim(sql: str) -> str:
    """Bridge function `erp_dt` (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs`."""
    while True:
        m = re.search(r"\berp_dt\(", sql)
        if not m:
            return sql
        depth, i = 0, m.end() - 1
        while True:
            depth += {"(": 1, ")": -1}.get(sql[i], 0)
            if depth == 0:
                break
            i += 1
        sql = sql[: m.start()] + f"(({sql[m.end() : i]})::timestamptz)" + sql[i + 1 :]


def rows(sql: str) -> list[dict]:
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({sql}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def read(hub: str) -> list[dict]:
    sql = (MODULE_DIR / "queries/appointments_phones_to_e164.sql").read_text()
    body = shim(bind(sql, {"hub_id": hub, "now": NOW})).strip().rstrip(";")
    # Prose after the statement (the house rule puts it at the end) is comments only.
    return rows(re.sub(r"--[^\n]*", "", body).strip().rstrip(";"))


def write(appointment_id: str, new: str, old: str, hub: str = HUB) -> None:
    sql = (MODULE_DIR / "commands/_set_phone.sql").read_text()
    params = {
        "appointment_id": appointment_id,
        "customer_phone": new,
        "old_phone": old,
        "hub_id": hub,
        "now": "2026-09-20T09:15:00+02:00",
        "current_user_id": "",
    }
    psql([], db=DB, stdin=f"BEGIN;\n{shim(bind(sql, params))}\nCOMMIT;\n")


def phone_of(appointment_id: str, hub: str = HUB) -> dict:
    found = rows(
        "SELECT customer_phone, updated_at FROM appointments_appointment "
        f"WHERE id = {literal(appointment_id)} AND hub_id = {literal(hub)}"
    )
    return found[0] if found else {}


def seed(
    id_: str,
    phone: str,
    hub: str = HUB,
    start: str = "2026-09-25T11:00:00+02:00",
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
            "is_deleted, created_at, updated_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', {literal(phone)}, '', "
            f"'s1', 'Bea', 's-corte', 'Corte', 2000, {literal(start)}, {literal(start)}, 30, "
            f"{literal(status)}, '', '', 0, 0, '', {deleted}, "
            "'2026-09-01T00:00:00+02:00', '2026-09-01T00:00:00+02:00')",
        ],
        db=DB,
    )


# The core table the country is read from (`crates/runtime/src/system_migrations.rs` v4).
CORE_TABLES = """
CREATE TABLE hub_settings (
  hub_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (hub_id, key));
INSERT INTO hub_settings (hub_id, key, value, updated_at) VALUES
  ('hub-gb', 'country_code', 'GB', 'now'),
  ('hub-gb', 'language', 'fr', 'now'),
  ('hub-neighbour', 'country_code', 'FR', 'now');
"""


def check_read() -> None:
    seed("typed", "600 111 222")
    seed("typed-pending", "0034 600 111 333", status="pending")
    seed("unreadable", "ask at reception")
    seed("e164", "+34600111222")
    seed("empty", "")
    seed("past", "600 111 444", start="2026-09-19T11:00:00+02:00")
    seed("cancelled", "600 111 555", status="cancelled")
    seed("completed", "600 111 666", status="completed")
    seed("deleted", "600 111 777", deleted=1)
    seed("neighbour", "06 12 34 56 78", hub=OTHER_HUB)
    seed("uk", "07700 900123", hub=HUB_GB)

    got = {r["id"]: r for r in read(HUB)}
    want = {"typed", "typed-pending", "unreadable"}
    if set(got) != want:
        fail(f"{READ}: it handed over {sorted(got)}, expected {sorted(want)}")
    if got.get("typed", {}).get("customer_phone") != "600 111 222":
        fail(f"{READ}: the phone is not handed over as saved ({got.get('typed')!r})")
    if (got.get("typed", {}).get("country_code") or "") != "":
        fail(
            f"{READ}: a hub with no country must hand over none ({got.get('typed')!r})"
        )

    uk = read(HUB_GB)
    if [(r["id"], r.get("country_code")) for r in uk] != [("uk", "GB")]:
        fail(f"{READ}: the hub's country is not handed over with its row ({uk!r})")


def check_write() -> None:
    seed("w-typed", "600 111 222")
    write("w-typed", "+34600111222", "600 111 222")
    got = phone_of("w-typed")
    if got.get("customer_phone") != "+34600111222":
        fail(f"{WRITE}: the new phone was not saved ({got!r})")
    if not str(got.get("updated_at", "")).startswith("2026-09-20T09:15"):
        fail(f"{WRITE}: it does not stamp updated_at ({got!r})")

    # Edited between the read and the write: the old text no longer matches, nothing is written.
    seed("w-edited", "+34611222333")
    write("w-edited", "+34600111222", "600 111 222")
    if phone_of("w-edited").get("customer_phone") != "+34611222333":
        fail(
            f"{WRITE}: it overwrote a phone edited after the read ({phone_of('w-edited')!r})"
        )

    seed("w-deleted", "600 111 222", deleted=1)
    write("w-deleted", "+34600111222", "600 111 222")
    if phone_of("w-deleted").get("customer_phone") != "600 111 222":
        fail(f"{WRITE}: it wrote a deleted appointment")

    # The neighbour hub runs the write with THIS hub's appointment id: nothing may be written.
    seed("w-mine", "600 111 222")
    write("w-mine", "+34600111222", "600 111 222", hub=OTHER_HUB)
    if phone_of("w-mine").get("customer_phone") != "600 111 222":
        fail(f"{WRITE}: it reached another hub's appointment ({phone_of('w-mine')!r})")


def check_against_postgres() -> None:
    if failures:
        return
    if not docker_available():
        notes.append(f"SKIPPED Postgres layer: container {CONTAINER!r} is not running")
        return
    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        psql([], db=DB, stdin=CORE_TABLES)
        for entry in MANIFEST.get("migrations", {}).get("postgres", []):
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
        check_read()
        check_write()
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
    print(
        "ok: the sweep reads the upcoming appointments whose phone is not E.164 yet, with the hub's "
        "country, and rewrites each only while it still carries the old text, in its own hub"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
