#!/usr/bin/env python3
"""A series with more dates than one run books is booked WHOLE — appointments#299, against the kernel.

One run of `appointments.recurring.materialize` books at most 50 occurrences: each one is judged
against the professional's agenda, inside the kernel's WASM instruction budget. Until #299 the cap
broke out of the run WITHOUT saying where to go on, so «Book appointments» — which follows the
handler's `next_from` since appointments#267 — stopped after the first 50 and read «50 booked»: a
daily series on the default 90-day window lost its last weeks, and the customer was missing from
the agenda from then on.

This battery is the screen's tap, run against the real runtime: the first run carries no window
(the hub closes it at its own `max_advance_booking`), and every run that answers `next_from` is
followed with it and the `to` it answered. A daily series of 80 dates must end with its 80
appointments on the agenda, and a second tap must find them all there and book none twice.

§3 is the window's LAST day (appointments#289): the hub closes the window at the instant
`now + max_advance_booking`, so a later hour on that day is left for a later run — it used to come
back in the report as refused (`too_far`), a date the series had picked itself.

Usage: tests/series_past_fifty.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub` (see tests/hub_harness.py). Without one it FAILS.
"""

import datetime
import sys
import zoneinfo

from hub_harness import Hub, seed_links, set_booking_policy

EVERY_DAY = range(0, 7)  # 0=Monday … 6=Sunday
PER_RUN = 50  # what one run books at most
# More than one run books, and clear of the default 90-day window's edge (appointments#276).
DATES = 80


def weekly_hours(hub: Hub) -> dict[int, dict]:
    """The business week as `schedules` holds it now, in the shape `business_hours.set` takes, so
    the battery can hand the SHARED hub back exactly as it found it."""
    week: dict[int, dict] = {}
    for row in hub.query("schedules.business_hours.list"):
        dow = int(row["day_of_week"])
        day = week.setdefault(dow, {"day_of_week": dow, "intervals": []})
        if row.get("is_closed"):
            day["is_closed"] = True
        else:
            day["intervals"].append(
                {"open_time": row["open_time"][:5], "close_time": row["close_time"][:5]}
            )
    for dow in EVERY_DAY:
        week.setdefault(dow, {"day_of_week": dow, "is_closed": True})
    for day in week.values():
        if day.get("is_closed") or not day["intervals"]:
            day.pop("intervals", None)
            day["is_closed"] = True
    return week


def main() -> int:
    hub = Hub("series_past_fifty.hub")
    # The default window of a hub: 90 days ahead.
    set_booking_policy(hub, allow_overlapping=False, max_advance_booking=90)
    found = weekly_hours(hub)
    try:
        return run(hub)
    finally:
        for day in found.values():
            hub.run("schedules.business_hours.set", day)


def book_like_the_screen(hub: Hub, selector: dict) -> tuple[list[dict], list]:
    """«Book appointments»: one run, then one more from each `next_from` to the `to` it answered."""
    reports, failures, window = [], [], {}
    for _ in range(20):
        status, body = hub.command(
            "appointments.recurring.materialize", {**selector, **window}
        )
        if status != 200 or not (body or {}).get("ok"):
            failures.append((status, ((body or {}).get("error") or {}).get("code")))
            break
        report = (body.get("data") or {}).get("result") or {}
        reports.append(report)
        if not report.get("next_from"):
            break
        if report["next_from"] <= window.get("from", ""):
            failures.append(("next_from does not move", report["next_from"]))
            break
        window = {"from": report["next_from"], "to": report.get("to")}
    return reports, failures


def run(hub: Hub) -> int:
    for dow in EVERY_DAY:
        hub.run(
            "schedules.business_hours.set",
            {
                "day_of_week": dow,
                "intervals": [{"open_time": "08:00", "close_time": "21:00"}],
            },
        )
    links = seed_links(hub, "series299")
    hub.run(
        "staff.schedules.create",
        {
            "staff_id": links.staff_id,
            "working_hours": [
                {"day_of_week": dow, "start_time": "08:00:00", "end_time": "21:00:00"}
                for dow in EVERY_DAY
            ],
        },
    )
    today = datetime.datetime.now(zoneinfo.ZoneInfo(hub.timezone)).date()
    start = today + datetime.timedelta(days=1)
    dates = [(start + datetime.timedelta(days=k)).isoformat() for k in range(DATES)]

    print(f"§1 a daily series of {DATES} dates, booked with one tap")
    recurring_id = hub.new_id(
        "appointments.recurring.create",
        {
            "customer_id": links.customer_id,
            "customer_name": "Cliente",
            "service_id": links.service_id,
            "service_name": links.service_name,
            "staff_id": links.staff_id,
            "staff_name": links.staff_name,
            "frequency": "daily",
            "time": "10:00",
            "duration_minutes": 30,
            "start_date": start.isoformat(),
            "max_occurrences": DATES,
        },
    )
    selector = {
        "recurring_id": recurring_id,
        "customer_id": links.customer_id,
        "service_id": links.service_id,
        "staff_id": links.staff_id,
    }
    reports, failures = book_like_the_screen(hub, selector)
    hub.check("§1 every run answered (no refusal, no `wasm` error)", failures, [])
    first = reports[0] if reports else {}
    hub.check("§1 the first run books its 50", first.get("booked"), PER_RUN)
    hub.check(
        "§1 and says the next run starts at the first date it did not book",
        first.get("next_from"),
        dates[PER_RUN],
    )
    hub.check(
        "§1 to the window the hub closed itself (today + 90 days)",
        first.get("to"),
        (today + datetime.timedelta(days=90)).isoformat(),
    )
    hub.check("§1 two runs book the whole series", len(reports), 2)
    hub.check(
        "§1 the runs together book every date",
        sum(r.get("booked") or 0 for r in reports),
        DATES,
    )
    hub.check(
        "§1 none skipped", [s for r in reports for s in r.get("skipped") or []], []
    )
    hub.check(
        "§1 the last run has nothing left", (reports or [{}])[-1].get("next_from"), None
    )

    def on_the_agenda() -> list[str]:
        return sorted(
            row["occurrence_date"]
            for row in hub.query(
                "appointments.recurring.occurrences", {"recurring_id": recurring_id}
            )
            if row["status"] in ("pending", "confirmed")
        )

    hub.check("§1 every date of the series is on the agenda", on_the_agenda(), dates)

    print("§2 tapping again books nothing twice")
    again, failures = book_like_the_screen(hub, selector)
    hub.check("§2 the retry answered", failures, [])
    hub.check(
        "§2 it finds every date already booked, in one run",
        [(r.get("booked"), r.get("already_booked"), r.get("next_from")) for r in again],
        [(0, DATES, None)],
    )
    hub.check("§2 the agenda is unchanged", on_the_agenda(), dates)

    last_day_of_the_window(hub)

    return hub.finish("a series with more dates than one run books is booked whole")


# The window's last day is the gate's: a time past `now + 90 days` waits for a later run.
LATE = "23:40"


def last_day_of_the_window(hub: Hub) -> None:
    """§3 — appointments#289. With no `to`, the run books up to today + `max_advance_booking`
    (90 here), last day included, but the gate judges the INSTANT `now + 90 days`: on that last
    day, an hour later than the runtime's clock was listed as refused («too far»), a date the
    series had picked itself. The last date must be booked if its instant is within the gate and
    left for a later run otherwise — never reported as skipped.

    The hour is chosen against the clock so the battery proves the symptom at any hour it runs:
    23:40 on the last day lies past the gate unless the battery runs within 10 minutes of 23:40 on
    the business clock; then it books 12:00, which lies within it. Open 24 h and a professional
    with no shift, so nothing but the gate can refuse."""
    print(
        "§3 the window's last day books what the gate takes and reports nothing as too far"
    )
    for dow in EVERY_DAY:
        hub.run(
            "schedules.business_hours.set",
            {
                "day_of_week": dow,
                "intervals": [{"open_time": "00:00", "close_time": "00:00"}],
            },
        )
    zone = zoneinfo.ZoneInfo(hub.timezone)
    links = seed_links(hub, "series289", duration_minutes=15)
    # In UTC: the gate adds 90 × 24 h to an instant, and Python adds and compares two datetimes of
    # the SAME zone on the wall clock — an hour off when the clocks change in between.
    utc = datetime.timezone.utc
    gate = datetime.datetime.now(utc) + datetime.timedelta(days=90)
    last = datetime.datetime.now(zone).date() + datetime.timedelta(days=90)
    dates = [last - datetime.timedelta(days=k) for k in (2, 1, 0)]

    def at(day: datetime.date, hhmm: str) -> datetime.datetime:
        hour, minute = (int(part) for part in hhmm.split(":"))
        return datetime.datetime.combine(
            day, datetime.time(hour, minute), zone
        ).astimezone(utc)

    margin = datetime.timedelta(minutes=10)
    time = LATE if at(last, LATE) > gate + margin else "12:00"
    expected = [d.isoformat() for d in dates if at(d, time) <= gate]

    recurring_id = hub.new_id(
        "appointments.recurring.create",
        {
            "customer_id": links.customer_id,
            "customer_name": "Cliente",
            "service_id": links.service_id,
            "service_name": links.service_name,
            "staff_id": links.staff_id,
            "staff_name": links.staff_name,
            "frequency": "daily",
            "time": time,
            "duration_minutes": 15,
            "start_date": dates[0].isoformat(),
            "max_occurrences": len(dates),
        },
    )
    reports, failures = book_like_the_screen(
        hub,
        {
            "recurring_id": recurring_id,
            "customer_id": links.customer_id,
            "service_id": links.service_id,
            "staff_id": links.staff_id,
        },
    )
    hub.check("§3 the run answered", failures, [])
    hub.check(
        f"§3 a {time} series books the window's dates within the gate",
        [(r.get("booked"), r.get("next_from")) for r in reports],
        [(len(expected), None)],
    )
    hub.check(
        "§3 and lists none of its own dates as refused (no `too_far`)",
        [s for r in reports for s in r.get("skipped") or []],
        [],
    )
    hub.check(
        "§3 the agenda holds exactly those dates",
        sorted(
            row["occurrence_date"]
            for row in hub.query(
                "appointments.recurring.occurrences", {"recurring_id": recurring_id}
            )
        ),
        expected,
    )


if __name__ == "__main__":
    sys.exit(main())
