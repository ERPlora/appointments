#!/usr/bin/env python3
"""A series at its LARGEST is still editable — appointments#251, against the kernel.

«This and following» treats every occurrence from the cut in one transaction (Google Calendar,
Outlook). The largest series there is: a DAILY one booked to `materialize`'s 400-day horizon, in a
salon and for a professional who work every day — ~400 occurrences — while the same professional
has a full agenda of other bookings ahead (1500 here) and a weekly break blocked.

The handler runs inside the kernel's WASM instruction budget (hub `DEFAULT_WASM_FUEL`, 200 M). On
29/09 this very edit ran out of it (`exceeded its instruction budget`) with 278 occurrences and 40
other bookings: every occurrence re-walked the professional's 400 days, every blocked period and
every booking of hers. Only the runtime counts that fuel, so only a battery against the runtime
can pin it: the unit tests in `handler/` run natively, where there is no budget at all.

Usage: tests/series_edit_at_horizon.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub` (see tests/hub_harness.py). Without one it FAILS.
"""

import datetime
import sys
import zoneinfo

from hub_harness import Hub, business_instant, seed_links, set_booking_policy

# The professional's OTHER live bookings ahead of the edit — a busy chair, five a day.
OTHER_BOOKINGS = 1500
EVERY_DAY = range(0, 7)  # 0=Monday … 6=Sunday


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
    hub = Hub("series_edit_at_horizon.hub")
    # No advance limit (0 = none): the series reaches 400 days ahead, past the default 90.
    set_booking_policy(hub, allow_overlapping=False, max_advance_booking=0)
    found = weekly_hours(hub)
    try:
        return run(hub)
    finally:
        for day in found.values():
            hub.run("schedules.business_hours.set", day)


def run(hub: Hub) -> int:
    for dow in EVERY_DAY:
        hub.run(
            "schedules.business_hours.set",
            {
                "day_of_week": dow,
                "intervals": [{"open_time": "08:00", "close_time": "21:00"}],
            },
        )
    links = seed_links(hub, "series251")
    other_customer = hub.new_id("customers.create", {"name": "Cliente agenda 251"})
    # Her own week, every day: each of her 400 days is a GOVERNED day the edit has to judge.
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
    today = datetime.date.today()
    horizon = [today + datetime.timedelta(days=k) for k in range(1, 401)]
    for day in horizon:
        if day.weekday() == 6:
            hub.run(
                "appointments.blocked_times.create",
                {
                    "title": "Descanso",
                    "block_type": "break",
                    "staff_id": links.staff_id,
                    "start_datetime": business_instant(hub, day.isoformat(), "14:00"),
                    "end_datetime": business_instant(hub, day.isoformat(), "15:00"),
                },
            )

    print("§1 a daily series booked to the horizon")
    start = horizon[0].isoformat()
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
            "start_date": start,
        },
    )
    for _ in range(12):
        report = hub.result(
            "appointments.recurring.materialize",
            {
                "recurring_id": recurring_id,
                "customer_id": links.customer_id,
                "service_id": links.service_id,
                "staff_id": links.staff_id,
                "from": start,
                "to": (today + datetime.timedelta(days=500)).isoformat(),
            },
        )
        if not report.get("booked"):
            break
    cut = horizon[1].isoformat()

    def live_from_cut(series_id: str) -> list:
        return [
            row
            for row in hub.query(
                "appointments.recurring.occurrences", {"recurring_id": series_id}
            )
            if row["occurrence_date"] >= cut
            and row["status"] in ("pending", "confirmed")
        ]

    booked = len(live_from_cut(recurring_id))
    hub.check_true(
        "§1 the series reaches the horizon (>= 395 bookings from the cut)",
        booked >= 395,
        f"booked from the cut: {booked}",
    )

    print(f"§2 her agenda is full: {OTHER_BOOKINGS} other bookings ahead, five a day")
    made = 0
    for day in horizon:
        for hhmm in ("15:00", "16:00", "17:00", "18:00", "19:00"):
            if made == OTHER_BOOKINGS:
                break
            hub.run(
                "appointments.appointments.create",
                {
                    "customer_id": other_customer,
                    "service_id": links.service_id,
                    "staff_id": links.staff_id,
                    "start_datetime": business_instant(hub, day.isoformat(), hhmm),
                },
            )
            made += 1
    hub.check("§2 other bookings made", made, OTHER_BOOKINGS)

    print("§3 the whole series moves from the cut, in one edit")
    status, body = hub.command(
        "appointments.recurring.update",
        {
            "recurring_id": recurring_id,
            "scope": "this_and_following",
            "from_occurrence_date": cut,
            "time": "12:00",
            "staff_id": links.staff_id,
        },
    )
    hub.check(
        "§3 the edit fits in the kernel's budget (no `wasm` error)",
        (status, (body or {}).get("ok"), ((body or {}).get("error") or {}).get("code")),
        (200, True, None),
    )
    result = ((body or {}).get("data") or {}).get("result") or {}
    new_series = result.get("recurring_id")
    hub.check("§3 every booking from the cut moved", result.get("moved"), booked)
    hub.check("§3 none skipped", len(result.get("skipped") or []), 0)
    hub.check("§3 none left on the closed half", len(live_from_cut(recurring_id)), 0)
    if new_series:
        moved = live_from_cut(new_series)
        zone = zoneinfo.ZoneInfo(hub.timezone)
        hub.check("§3 all of them on the new half", len(moved), booked)
        hub.check(
            "§3 all of them at the new time, on the business clock",
            {
                datetime.datetime.fromisoformat(r["start_datetime"])
                .astimezone(zone)
                .strftime("%H:%M")
                for r in moved
            },
            {"12:00"},
        )

    return hub.finish("a daily series at the horizon is editable with a full agenda")


if __name__ == "__main__":
    sys.exit(main())
