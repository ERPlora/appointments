#!/usr/bin/env python3
"""A battery against a live hub never hands the runtime TODAY's date — regression of
ERPlora/appointments#266.

§7 of `availability.hub.test.py` started a weekly series on `datetime.date.today()` at 14:00. The
runtime judges every occurrence against its real clock, so once 14:00 had passed on the series'
weekday, today's date came back `appointments.invalid_start` (in the past) instead of
`appointments.outside_staff_hours`, and the battery went red in the afternoon on a module that was
fine. The CI runs at whatever hour it runs: a battery like that is green or red by the clock.

A date the runtime will compare with `now` has to be far from it — `next_weekday()` (a week or more
ahead) or `today + timedelta(days=N)`. So the rule held here, for every `*.hub.test.py`: the bare
`date.today().isoformat()` (today, formatted for a payload) does not appear. This catches the bug
at any hour, which the battery itself only does after 14:00 on a Wednesday.

Usage: tests/hub_batteries_clock_free.contract.test.py   (exit 0 = green)
"""

import pathlib
import re
import sys

TESTS_DIR = pathlib.Path(__file__).resolve().parent

# `date.today().isoformat()` — today's date, ready to go into a payload. An offset first
# (`(date.today() + timedelta(days=7)).isoformat()`) does not match.
TODAY_AS_PAYLOAD = re.compile(r"\bdate\.today\(\)\s*\.isoformat\(\)")

batteries = sorted(TESTS_DIR.glob("*.hub.test.py"))
failures: list[str] = []
for battery in batteries:
    for number, line in enumerate(battery.read_text().splitlines(), start=1):
        if TODAY_AS_PAYLOAD.search(line):
            failures.append(f"{battery.name}:{number}: {line.strip()}")

if not batteries:
    print(
        "hub_batteries_clock_free: no *.hub.test.py found — the guard would prove nothing"
    )
    sys.exit(1)

if failures:
    print(
        "✗ hub_batteries_clock_free: a live-hub battery hands the runtime TODAY's date, so its "
        "verdict depends on the hour it runs (appointments#266). Use next_weekday() or "
        "today + timedelta(days=N):"
    )
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print(
    f"✓ hub_batteries_clock_free: {len(batteries)} live-hub batteries, none sends today's date"
)
