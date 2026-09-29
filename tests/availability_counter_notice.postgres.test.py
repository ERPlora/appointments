#!/usr/bin/env python3
"""The counter's list of free hours reaches INSIDE the minimum notice (appointments#234).

`min_booking_notice` is the customer's window (online, WhatsApp): since appointments#157 the
counter may book inside it, but `appointments.availability.own_slots` dropped those hours always,
so the create form never offered the walk-in who wants an hour «now» a button for it.

The contract fixed here (against a real Postgres, session in UTC like the runtime):

  1. Without the counter's declaration the list is what it always was: the first hour offered
     honours the notice, and no row is flagged `within_min_notice`.
  2. With `allow_short_notice` the floor drops to NOW (still in the salon's clock): the hours
     inside the notice come back FLAGGED `within_min_notice = 1`, the ones beyond it with 0, and
     an hour already gone is still out. The handler, not this SQL, decides who may keep the
     flagged rows (the same person-only door `create` applies).
  3. The maximum advance does not move with the declaration.

Usage: tests/availability_counter_notice.postgres.test.py   (exit 0 = green)
  Uses the container `erplora-test-pg-5433` (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  throw-away database and DROPS it at the end, pass or fail. Without a container it is SKIPPED —
  never taken as green.
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

SLOTS = "appointments.availability.own_slots"
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_counter_notice_{uuid.uuid4().hex[:8]}"
HUB = "hub-under-test"
DAY = "2026-08-28"

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
        "docker",
        "exec",
        "-i",
        # The runtime's Postgres session runs in UTC. Reproduced here so the test cannot pass by
        # the accident of a session that happens to sit on the business zone.
        "-e",
        "PGOPTIONS=-c timezone=UTC",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        DB,
        "-q",
        "-X",
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


def seed_settings(notice_min: int) -> None:
    psql("DELETE FROM appointments_settings WHERE hub_id = " + literal(HUB))
    psql(
        "INSERT INTO appointments_settings (id, hub_id, default_duration, min_booking_notice, "
        "max_advance_booking, allow_overlapping, calendar_start_hour, calendar_end_hour, "
        f"slot_interval, is_deleted, created_at) VALUES ('st-1', {literal(HUB)}, 30, {notice_min}, "
        "0, 0, 8, 20, 15, 0, '2026-08-01T00:00:00+00:00')"
    )


def slots_rows(now: str, counter: bool, date: str = DAY) -> list[dict]:
    params = {
        "date": date,
        "staff_id": "s1",
        "duration_minutes": 30,
        "hub_id": HUB,
        "now": now,
        "timezone": "Europe/Madrid",
    }
    if counter:
        # The runtime binds a JSON boolean as the integer 1 (hub crates/db).
        params["allow_short_notice"] = 1
    return run_query(SLOTS, params)


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

        seed_settings(60)
        madrid_now = "2026-08-28T09:00:00+00:00"  # 11:00 on the salon's wall clock

        # ── 1 · no declaration: the customer's list, untouched ───────────────────────────────
        plain = slots_rows(madrid_now, counter=False)
        if [r["start_time"] for r in plain][:1] != ["12:00"]:
            fail(f"without the declaration the first hour is 12:00, not {plain[:1]}")
        flagged = [r["start_time"] for r in plain if r.get("within_min_notice") != 0]
        if flagged:
            fail(f"without the declaration no row may be inside the notice, got {flagged}")

        # ── 2 · the counter: from NOW, the notice hours flagged ──────────────────────────────
        counter = slots_rows(madrid_now, counter=True)
        times = [r["start_time"] for r in counter]
        if times[:5] != ["11:00", "11:15", "11:30", "11:45", "12:00"]:
            fail(f"the counter's list starts NOW (11:00, inclusive), got {times[:5]}")
        if "10:45" in times:
            fail("10:45 is already gone: the declaration does not reopen the past")
        by_time = {r["start_time"]: r.get("within_min_notice") for r in counter}
        for inside in ("11:00", "11:15", "11:30", "11:45"):
            if by_time.get(inside) != 1:
                fail(f"{inside} is inside the 60 minute notice and must be flagged 1, got {by_time.get(inside)}")
        for beyond in ("12:00", "15:00"):
            if by_time.get(beyond) != 0:
                fail(f"{beyond} meets the notice and must be flagged 0, got {by_time.get(beyond)}")
        if times[4:] != [r["start_time"] for r in plain]:
            fail("beyond the notice the counter's list must be exactly the customer's list")

        # ── 3 · the maximum advance does not move ────────────────────────────────────────────
        psql(
            "UPDATE appointments_settings SET max_advance_booking = 7 WHERE hub_id = "
            + literal(HUB)
        )
        far = slots_rows(madrid_now, counter=True, date="2026-09-30")
        if far:
            fail(f"a date past the maximum advance stays shut for the counter, got {len(far)} rows")

        if failures:
            print(f"FAIL ({len(failures)}):")
            for f in failures:
                print(f"  - {f}")
            return 1
        print(
            "OK: with the counter's declaration own_slots reaches inside the minimum notice, "
            "flags those hours, and still refuses the past and the maximum advance"
        )
        return 0
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", DB]
        )


if __name__ == "__main__":
    sys.exit(main())
