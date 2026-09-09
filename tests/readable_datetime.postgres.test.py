#!/usr/bin/env python3
"""Reading one appointment gives back the day and the hour ALREADY READABLE (appointments#151).

Why this exists. An automation that confirms a booking has to be able to write «confirmada: el
martes a las 10:30 con Ana». Until now `appointments.appointments.get` only handed out
`start_datetime` as ISO text (`2026-09-15T10:30:00+02:00`), and the flow mapping language has no
clock and no formatter — `{{steps.x.y}}` prints the value exactly as it comes. So the only thing a
recipe could do was not name the hour, which is what
`whatsapp_inbox/flows/appointment-confirmed-to-whatsapp` does today.

The answer is two more columns on the SAME read — `start_date_label` and `start_time_label` — and
NOT a formatter in every consumer. They are computed from the two things the runtime already binds
into every query (`system_params`, hub#1022 / hub#1098): `:timezone`, the business IANA zone the
core resolved, and `:caller_lang`, the effective language with the shell's own precedence. The
module keeps NO clock and NO language of its own; a second copy is a second answer waiting to rot
(docs/concepts.md, «The clock is the business's»).

Kept apart on purpose: the two labels are separate fields, not one sentence. Joining them («… a
las …», «… at …») is PROSE, and prose belongs to whoever writes the message, in its own catalogue
— never hardcoded in SQL (ADR-0055).

What this file pins, and why each control is here:

  1. MANIFEST. `appointments.appointments.get` is still a plain SQL query (not a `list`) and still
     carries NO `ai` block. It projects `customer_phone`/`customer_email`, so it is the COUNTER
     door of appointments#146: adding readable columns must not turn it into a model tool.
  2. THE LANGUAGE CATALOGUE IS ONE. Every `locales/*.json` the module publishes has its own
     branch in the label's name tables, so a new language cannot land on the screens and leave
     the confirmed appointment speaking English.
  3. REAL POSTGRES, against a scratch database built from this module's own migrations:
     · the labels come out in the business language and the business ZONE;
     · the zone wins over whatever offset the stored text happens to carry — a row at rest in UTC
       `Z` still reads 10:30 in Madrid, and a row that crosses midnight is filed on the LOCAL day,
       not the UTC one;
     · a legacy row with NO zone designator is read as the salon's wall clock, not shifted;
     · an unknown language falls back to English (ADR-0055), a regional tag (`es-ES`) resolves to
       its base language, and an absent zone degrades to UTC — never to NULL, which would make the
       label silently disappear (the `AT TIME ZONE NULL` trap availability_slots.sql documents);
     · the row still belongs to its hub and is still soft-delete aware;
     · and NO column that the read used to return has been lost on the way.

Usage: tests/readable_datetime.postgres.test.py   (exit 0 = green)
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

GET = "appointments.appointments.get"
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_readable_datetime_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-09-01T09:00:00+02:00"

# Every column the read answered with BEFORE the two labels landed. A rewrite that reshapes the
# projection must not drop one on the way out: each of these is somebody's screen or somebody's
# guard (`reschedule`/`cancel` read this row, and the counter needs the contact details).
COLUMNS_BEFORE = (
    "id", "appointment_number", "customer_id", "customer_name", "customer_phone",
    "customer_email", "staff_id", "staff_name", "service_id", "service_name", "service_price",
    "start_datetime", "end_datetime", "duration_minutes", "status", "notes", "internal_notes",
    "booked_online", "recurring_id", "occurrence_date", "converted_sale_id", "cancelled_at",
    "cancellation_reason",
)

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest wiring ─────────────────────────────────────────────────────────────


def check_manifest() -> str | None:
    q = MANIFEST.get("queries", {}).get(GET)
    if not isinstance(q, dict):
        fail(f"{GET}: not declared in module.json")
        return None
    if "list" in q:
        fail(f"{GET}: must stay a plain query — the counter opens ONE appointment, not a page")
    if "ai" in q:
        fail(
            f"{GET}: must keep NO `ai` block — it projects customer_phone/customer_email and is "
            "the counter door of appointments#146; readable labels must not turn it into a tool"
        )
    rel = q.get("sql")
    if not rel or not (MODULE_DIR / rel).exists():
        fail(f"{GET}.sql: {rel!r} is not in the package")
        return None
    return rel


# ── Layer 1b: the SQL language table and locales/ are ONE catalogue ──────────────────────


def check_language_catalogue(sql_rel: str) -> None:
    """Every language this module publishes has to be a branch of the label (ADR-0055).

    The day and month names are an ARRAY table inside the SQL, because `to_char(..., 'TMDay')`
    resolves against `lc_time` — a SESSION setting of the server — and is not portable anyway.
    That leaves the module carrying TWO catalogues: `locales/*.json` for its screens, and that
    table for the sentence a CUSTOMER reads. Nothing links them, so dropping a `locales/fr.json`
    in would paint the agenda in French and keep confirming appointments «Tuesday, 15 September»
    — half a translation, in the half nobody thinks to look at. This is the link.

    English needs no branch: it is the SOURCE language and it is the `ELSE`.
    """
    sql = (MODULE_DIR / sql_rel).read_text()
    published = sorted(path.stem for path in (MODULE_DIR / "locales").glob("*.json"))
    if "en" not in published:
        fail("locales/: the module must publish `en`, the source language (ADR-0055)")
    for lang in published:
        if lang == "en" or f"WHEN '{lang}'" in sql:
            continue
        fail(
            f"{sql_rel}: locales/{lang}.json is published but the readable label has no "
            f"`WHEN '{lang}'` branch — a hub in {lang} would read its agenda translated and "
            "get its appointments confirmed in English"
        )


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
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


# Bridge functions (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs`.
def shim(sql: str) -> str:
    sql = re.sub(r"\berp_dt\(([^()]*)\)", r"((\1)::timestamptz)", sql)
    sql = re.sub(r"\berp_date\(([^()]*)\)", r"((\1)::date)", sql)
    return sql


def run_query(sql_rel: str, params: dict) -> list[dict]:
    body = shim(bind((MODULE_DIR / sql_rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def appointment(id_: str, hub: str, start: str, end: str, deleted: int = 0) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, is_deleted, "
            "created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, 'APT-1', 'c1', 'Ada', '600100200', 'a@b.c', "
            f"'st-ana', 'Ana', 's-corte', 'Corte', 2000, {literal(start)}, {literal(end)}, "
            f"45, 'confirmed', '', '', 0, 0, '', {deleted}, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def read(sql_rel: str, appointment_id: str, timezone: str | None, lang: str | None) -> dict | None:
    rows = run_query(
        sql_rel,
        {
            "hub_id": HUB,
            "current_user_id": "u-owner",
            "now": NOW,
            "appointment_id": appointment_id,
            "timezone": timezone,
            "caller_lang": lang,
        },
    )
    return rows[0] if rows else None


def expect(sql_rel: str, case: str, appointment_id: str, timezone, lang, date_label, time_label):
    row = read(sql_rel, appointment_id, timezone, lang)
    if row is None:
        fail(f"{case}: the read returned NO row")
        return
    if row.get("start_date_label") != date_label:
        fail(
            f"{case}: start_date_label is {row.get('start_date_label')!r}, expected {date_label!r}"
        )
    if row.get("start_time_label") != time_label:
        fail(
            f"{case}: start_time_label is {row.get('start_time_label')!r}, expected {time_label!r}"
        )


def check_against_postgres(sql_rel: str) -> None:
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

        # A Tuesday, on the salon's clock, written the way this module writes it (appointments#76).
        appointment("a-tue", HUB, "2026-09-15T10:30:00+02:00", "2026-09-15T11:15:00+02:00")
        # The SAME instant at rest in UTC `Z` — what appointments#88 will normalise rows to.
        appointment("a-utc", HUB, "2026-09-15T08:30:00Z", "2026-09-15T09:15:00Z")
        # An instant whose UTC day is NOT the salon's day: 23:30 UTC is 01:30 on the 16th in Madrid.
        appointment("a-midnight", HUB, "2026-09-15T23:30:00Z", "2026-09-16T00:15:00Z")
        # Winter, so the label cannot be a hardcoded +02:00.
        appointment("a-winter", HUB, "2026-01-13T10:30:00+01:00", "2026-01-13T11:15:00+01:00")
        # A single-digit day: Spanish writes «5 de septiembre», never «05 de septiembre».
        appointment("a-short", HUB, "2026-09-05T09:00:00+02:00", "2026-09-05T09:45:00+02:00")
        # An AFTERNOON hour: without one, a 12-hour format would read identically to a 24-hour
        # one on every other row in this file and the control would prove nothing.
        appointment("a-pm", HUB, "2026-09-15T16:45:00+02:00", "2026-09-15T17:30:00+02:00")
        # A SUNDAY. Postgres numbers weekdays two ways and they agree on every day of the week
        # EXCEPT this one (`DOW` 0=Sunday, `ISODOW` 7=Sunday), so without a Sunday in here the
        # wrong one of the two would read perfectly.
        appointment("a-sun", HUB, "2026-09-20T12:00:00+02:00", "2026-09-20T12:45:00+02:00")
        # A legacy row with NO zone designator: its 19 characters ARE the salon's wall clock.
        appointment("a-naive", HUB, "2026-09-15T10:30:00", "2026-09-15T11:15:00")
        # The neighbour hub (`id` is the table's primary key, so its row carries its own), and
        # a soft-deleted row of ours.
        appointment("a-neighbour", OTHER_HUB, "2026-09-15T10:30:00+02:00",
                    "2026-09-15T11:15:00+02:00")
        appointment("a-gone", HUB, "2026-09-15T10:30:00+02:00", "2026-09-15T11:15:00+02:00", 1)

        MAD = "Europe/Madrid"

        # 1. The business language and the business zone.
        expect(sql_rel, "es/Madrid", "a-tue", MAD, "es", "martes, 15 de septiembre de 2026", "10:30")
        expect(sql_rel, "en/Madrid", "a-tue", MAD, "en", "Tuesday, 15 September 2026", "10:30")

        # 2. The ZONE decides, not the offset the text happens to carry.
        expect(sql_rel, "row at rest in UTC", "a-utc", MAD, "es",
               "martes, 15 de septiembre de 2026", "10:30")

        # 2b. The afternoon reads 24-hour, the same hourCycle the module's own screens pin.
        expect(sql_rel, "afternoon", "a-pm", MAD, "es",
               "martes, 15 de septiembre de 2026", "16:45")
        expect(sql_rel, "afternoon/en", "a-pm", MAD, "en", "Tuesday, 15 September 2026", "16:45")

        # 2c. Sunday, the only day the two weekday numberings disagree about.
        expect(sql_rel, "sunday", "a-sun", MAD, "es",
               "domingo, 20 de septiembre de 2026", "12:00")
        expect(sql_rel, "sunday/en", "a-sun", MAD, "en", "Sunday, 20 September 2026", "12:00")

        # 3. The LOCAL day, not the UTC one.
        expect(sql_rel, "crossing midnight", "a-midnight", MAD, "es",
               "miércoles, 16 de septiembre de 2026", "01:30")

        # 4. Winter: the offset is read from the zone, never assumed.
        expect(sql_rel, "winter", "a-winter", MAD, "es", "martes, 13 de enero de 2026", "10:30")

        # 5. Another zone reads the same instant differently — the salon's clock is the only one.
        expect(sql_rel, "New York", "a-tue", "America/New_York", "en",
               "Tuesday, 15 September 2026", "04:30")

        # 6. Single-digit day, both languages.
        expect(sql_rel, "es/short day", "a-short", MAD, "es",
               "sábado, 5 de septiembre de 2026", "09:00")
        expect(sql_rel, "en/short day", "a-short", MAD, "en",
               "Saturday, 5 September 2026", "09:00")

        # 7. A language we do not translate falls back to ENGLISH, the source language (ADR-0055).
        expect(sql_rel, "unknown language", "a-tue", MAD, "fr",
               "Tuesday, 15 September 2026", "10:30")

        # 7b. An EMPTY language falls back to the same place. The runtime swears it never sends
        #     one (`system_params_timezone_and_caller_lang_never_arrive_empty`), so this is the
        #     defensive half — and it must land on ENGLISH, the source language, not on a NULL
        #     label nor on `es`, which is the core default for the SETTING and something
        #     `:caller_lang` has already applied by the time it gets here.
        expect(sql_rel, "empty language", "a-tue", MAD, "",
               "Tuesday, 15 September 2026", "10:30")

        # 8. A regional tag resolves to its base language instead of silently going English.
        expect(sql_rel, "es-ES", "a-tue", MAD, "es-ES", "martes, 15 de septiembre de 2026", "10:30")

        # 9. A legacy row with no zone designator is the salon's wall clock, not a UTC reading.
        expect(sql_rel, "naive row", "a-naive", MAD, "es",
               "martes, 15 de septiembre de 2026", "10:30")

        # 10. No zone at all degrades to UTC — and NEVER to NULL, which would make the label vanish
        #     while the read still looks perfectly healthy (`AT TIME ZONE NULL` returns NULL).
        for label, tz in (("empty zone", ""), ("null zone", None)):
            row = read(sql_rel, "a-tue", tz, "es")
            if row is None:
                fail(f"{label}: the read returned NO row")
                continue
            for column in ("start_date_label", "start_time_label"):
                if not row.get(column):
                    fail(f"{label}: {column} came back {row.get(column)!r} — a mute label")
            if row.get("start_time_label") != "08:30":
                fail(
                    f"{label}: start_time_label is {row.get('start_time_label')!r}, expected "
                    "'08:30' — with no zone the runtime degrades to UTC, same as timezone_name()"
                )

        # 11. Tenancy and soft delete still hold after the rewrite. Asked in BOTH directions:
        #     a hub that asks for a NEIGHBOUR's appointment by id gets nothing back, and its
        #     own row still comes out whole — a `WHERE hub_id` dropped in the rewrite would
        #     leak a stranger's phone number through the very read the counter uses.
        if read(sql_rel, "a-neighbour", MAD, "es") is not None:
            fail("tenancy: our hub read the NEIGHBOUR's appointment by id")
        neighbour = run_query(
            sql_rel,
            {
                "hub_id": OTHER_HUB, "current_user_id": "u-owner", "now": NOW,
                "appointment_id": "a-neighbour", "timezone": MAD, "caller_lang": "es",
            },
        )
        if len(neighbour) != 1:
            fail(f"tenancy: the neighbour hub must read exactly its own row, got {len(neighbour)}")
        ours = read(sql_rel, "a-tue", MAD, "es")
        if ours is None or ours.get("customer_phone") != "600100200":
            fail("tenancy: our hub must still read its own row whole")
        if read(sql_rel, "a-gone", MAD, "es") is not None:
            fail("soft delete: a deleted appointment must not come back")

        # 12. Nothing that the read used to answer with has been lost.
        row = read(sql_rel, "a-tue", MAD, "es") or {}
        missing = [c for c in COLUMNS_BEFORE if c not in row]
        if missing:
            fail(f"the read dropped columns it used to return: {missing}")
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    sql_rel = check_manifest()
    if sql_rel:
        check_language_catalogue(sql_rel)
        check_against_postgres(sql_rel)
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {GET} — readable day and hour, in the business language and the business zone")
    return 0


if __name__ == "__main__":
    sys.exit(main())
