#!/usr/bin/env python3
"""The screen stops filtering by OUR timetable the moment the authority answers (appointments#105).

Why this file exists: `queries/availability_slots.sql` and `queries/availability_check.sql` have
filtered by `appointments_schedule_timeslot` — the module's OWN tables — since the beginning.
appointments#102 moved the opening-hours authority to `schedules` for every command that WRITES a
slot, and its precedence is STRICT: the moment `schedules` carries a rule that reaches the date,
our own timeslots are not consulted at all. SQL cannot follow that, because a query of this module
may only name this module's tables; `schedules_*` is out of reach by contract.

So the screen and the door drifted apart in BOTH directions, and this pins the crossing that
closes it — the optional `:schedules_answers` bind:

  * absent (the value every existing caller sends, and what an unbound parameter arrives as) → the
    engine behaves exactly as it did: our own timeslots filter the day. That is the hub configured
    before #102, whose gate still runs on them;
  * `1` → the caller has already asked `appointments.availability.day_opening` and the authority
    resolved the date, so our tables are skipped here for the same reason the gate skips them, and
    the caller filters by the stretches the gate itself returned.

Both directions are checked on the SAME fixture: a salon with hours ONLY in its own tables. If the
bind were ignored the second half would still see the filtered day, which is why case A asserts
the fixture really does hide 08:00 before case B claims it stops hiding it.

Usage: ERPLORA_TEST_PG_CONTAINER=erplora-test-pg-5433 tests/availability_schedules_answers.postgres.test.py
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

SLOTS = "appointments.availability.slots"
CHECK = "appointments.availability.check"
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_schedules_answers_{uuid.uuid4().hex[:8]}"
HUB = "hub-under-test"
# The runtime's :now is UTC and the hub's Postgres session runs in UTC — both reproduced here.
NOW = "2026-08-26T09:00:00+00:00"
DAY = "2026-08-28"  # Friday → day_of_week 4 (Monday = 0)
DAY_OF_WEEK = 4
TZ = "Europe/Madrid"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


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


def psql(stdin: str, args=None) -> str:
    cmd = [
        "docker", "exec", "-i", "-e", "PGOPTIONS=-c timezone=UTC", CONTAINER,
        "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB, "-q", "-X",
    ]
    cmd += args or []
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


def _call_args(sql: str, open_paren: int) -> tuple[list[str], int]:
    depth, start, args = 0, open_paren + 1, []
    i = open_paren
    while i < len(sql):
        ch = sql[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                args.append(sql[start:i])
                return [a.strip() for a in args], i + 1
        elif ch == "," and depth == 1:
            args.append(sql[start:i])
            start = i + 1
        i += 1
    raise ValueError("unbalanced parentheses")


def shim(sql: str) -> str:
    """Funciones-puente (ADR-0007 §4a) — espejo de `hub/crates/db/src/lib.rs`."""
    forms = {
        "erp_dt": lambda a: f"(({a[0]})::timestamptz)",
        "erp_date": lambda a: f"(({a[0]})::date)",
        "erp_dateadd": lambda a: (
            f"(({a[0]})::timestamptz + (({a[1]}) || ' ' || {a[2]})::interval)"
        ),
        "erp_dow_mon0": lambda a: (
            f"((EXTRACT(ISODOW FROM ({a[0]})::timestamptz)::int) - 1)"
        ),
        "erp_extract": lambda a: (
            f"(EXTRACT({a[0]} FROM ({a[1]})::timestamptz)::bigint)"
        ),
        "erp_timefmt": lambda a: (
            f"(lpad(({a[0]})::text, 2, '0') || ':' || lpad(({a[1]})::text, 2, '0'))"
        ),
    }
    for name, render in forms.items():
        while True:
            m = re.search(rf"\b{name}\(", sql)
            if not m:
                break
            args, end = _call_args(sql, m.end() - 1)
            sql = sql[: m.start()] + render(args) + sql[end:]
    return sql


def run_query(name: str, params: dict) -> list[dict]:
    rel = MANIFEST["queries"][name]["sql"]
    body = shim(bind((MODULE_DIR / rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(f"SELECT row_to_json(r) FROM ({body}) r", ["-t", "-A"])
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def seed() -> None:
    psql(
        "INSERT INTO appointments_settings (id, hub_id, default_duration, min_booking_notice, "
        "max_advance_booking, allow_overlapping, calendar_start_hour, calendar_end_hour, "
        f"slot_interval, is_deleted, created_at) VALUES ('st-1', {literal(HUB)}, 30, 0, "
        "365, 0, 8, 20, 15, 0, '2026-08-01T00:00:00+00:00')"
    )
    # The salon keeps its hours HERE and nowhere else: 10:00–14:00 on the day under test.
    psql(
        "INSERT INTO appointments_schedule (id, hub_id, name, is_default, is_active, is_deleted, "
        f"created_at) VALUES ('sch-1', {literal(HUB)}, 'Horario salon', 1, 1, 0, "
        "'2026-08-01T00:00:00+00:00')"
    )
    psql(
        "INSERT INTO appointments_schedule_timeslot (id, hub_id, schedule_id, day_of_week, "
        "start_time, end_time, is_active, is_deleted, created_at) VALUES "
        f"('ts-1', {literal(HUB)}, 'sch-1', {DAY_OF_WEEK}, '10:00', '14:00', 1, 0, "
        "'2026-08-01T00:00:00+00:00')"
    )


def slots_of(schedules_answers) -> list[str]:
    rows = run_query(
        SLOTS,
        {
            "date": DAY,
            "staff_id": None,
            "duration_minutes": 30,
            "exclude_hold_ref": None,
            "schedules_answers": schedules_answers,
            "hub_id": HUB,
            "now": NOW,
            "timezone": TZ,
        },
    )
    return [r["start_time"] for r in rows]


def check_at(start: str, schedules_answers) -> dict:
    rows = run_query(
        CHECK,
        {
            "start_datetime": start,
            "staff_id": None,
            "duration_minutes": 30,
            "exclude_appointment_id": None,
            "exclude_hold_ref": None,
            "schedules_answers": schedules_answers,
            "hub_id": HUB,
            "now": NOW,
            "timezone": TZ,
        },
    )
    return rows[0] if rows else {"available": None, "reason": "no-row"}


def main() -> int:
    if not docker_available():
        print(f"SKIPPED: no Postgres in container {CONTAINER} (nothing was verified)")
        return 0

    subprocess.run(
        ["docker", "exec", CONTAINER, "createdb", "-U", "postgres", DB], check=True
    )
    try:
        for entry in MANIFEST["migrations"]["postgres"]:
            rel = entry if isinstance(entry, str) else entry["file"]
            psql((MODULE_DIR / rel).read_text())
        seed()

        # ── A · bind absent: the legacy hub keeps EXACTLY the engine it has today ────────────
        legacy = slots_of(None)
        if "08:00" in legacy:
            fail("with no :schedules_answers our own 10:00-14:00 timeslots must still filter")
        if "10:00" not in legacy or "13:30" not in legacy:
            fail(f"the fixture must offer its own 10:00-14:00 window, got {legacy}")
        shut = check_at(f"{DAY}T08:00:00+02:00", None)
        if shut.get("available") != 0 or shut.get("reason") != "outside_schedule":
            fail(f"check must refuse 08:00 as outside_schedule while ours answer, got {shut}")

        # ── B · bind = 1: the authority answered, so our tables are skipped here too ─────────
        authority = slots_of(1)
        if "08:00" not in authority:
            fail(
                "with :schedules_answers = 1 our own timeslots must not filter: 08:00 is a "
                f"calendar hour and the caller filters by the gate's own stretches, got {authority}"
            )
        if "13:30" not in authority:
            fail("skipping our filter must not drop the hours it used to allow")
        open_now = check_at(f"{DAY}T08:00:00+02:00", 1)
        if open_now.get("available") != 1:
            fail(f"check must stop answering outside_schedule from our tables, got {open_now}")

        if failures:
            print(f"FAIL ({len(failures)}):")
            for f in failures:
                print(f"  - {f}")
            return 1
        print(
            "OK: :schedules_answers skips the module's own timetable in both availability "
            "queries, and its absence leaves the legacy hub untouched"
        )
        return 0
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", DB]
        )


if __name__ == "__main__":
    sys.exit(main())
