#!/usr/bin/env python3
"""A professional with a FULL agenda can still take a batch and a series — appointments#265.

`bulk_create` (a five-session pass, up to 50 slots) and `recurring.materialize` (a series, 50
occurrences per run) judge every slot against the professional's whole agenda: her 400 days of
hours, every blocked period and every live booking of hers ahead. On 29/09, with ~1 550 live
bookings of hers, both ran out of the kernel's WASM instruction budget (hub `DEFAULT_WASM_FUEL`,
200 M, `exceeded its instruction budget`) and the whole call was undone: nothing booked, a generic
error on screen. Every slot re-walked the whole agenda.

Only the runtime counts that fuel, so only a battery against the runtime can pin it: the unit
tests in `handler/` run natively, where there is no budget at all. The sizes are the busiest chair
this hub is built for: a salon and a professional open every day, a weekly break blocked to the
400-day horizon and her agenda carrying 3 200 other live bookings ahead (eight a day, every day to
the horizon). Measured against the handler of v1.1.129: the series already runs out at 1 500 of
her bookings, the batch still fits at 2 000 and runs out at this size — so both doors are pinned.

appointments#267: past ~4 300 bookings of hers the SERIES ran out again — not judging, just reading
her whole agenda ahead (≈40 k instructions a row). The series now reads it one page at a time
(`upcoming_for_staff_from`, 2 000 rows from `from`) and, when a page ends before its window does,
says where the next run starts (`next_from`). §3 grows her agenda to 14 a day — 5 600 bookings
ahead, past the size that failed on the handler of v1.1.140 — and follows `next_from` to the
horizon.

Usage: tests/busy_agenda_booking.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub` (see tests/hub_harness.py). Without one it FAILS.
"""

import datetime
import sys

from hub_harness import Hub, business_instant, seed_links, set_booking_policy

# The professional's OTHER live bookings ahead — a busy chair, eight a day.
OTHER_BOOKINGS = 3200
EIGHT_A_DAY = ("11:00", "12:00", "13:00", "15:00", "16:00", "17:00", "18:00", "19:00")
# appointments#267: what the series is booked against — six more a day, 5 600 ahead in all. Clear
# of 09:00 (the batch) and of 14:00 (the series, which a 13:30 booking only touches).
SIX_MORE_A_DAY = ("08:00", "08:30", "10:00", "10:30", "11:30", "12:30")
SERIES_AGENDA = OTHER_BOOKINGS + 400 * len(SIX_MORE_A_DAY)
EVERY_DAY = range(0, 7)  # 0=Monday … 6=Sunday
BATCH = 50  # the largest batch `bulk_create` takes


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
    hub = Hub("busy_agenda_booking.hub")
    # No advance limit (0 = none): the series reaches 400 days ahead, past the default 90.
    set_booking_policy(hub, allow_overlapping=False, max_advance_booking=0)
    found = weekly_hours(hub)
    try:
        return run(hub)
    finally:
        for day in found.values():
            hub.run("schedules.business_hours.set", day)


def code_of(body) -> str | None:
    return (
        ((body or {}).get("error") or {}).get("code")
        if isinstance(body, dict)
        else None
    )


def run(hub: Hub) -> int:
    for dow in EVERY_DAY:
        hub.run(
            "schedules.business_hours.set",
            {
                "day_of_week": dow,
                "intervals": [{"open_time": "08:00", "close_time": "21:00"}],
            },
        )
    links = seed_links(hub, "busy265")
    other_customer = hub.new_id("customers.create", {"name": "Cliente agenda 265"})
    # Her own week, every day: each of her 400 days is a GOVERNED day every slot is judged on.
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
    sundays = {day for day in horizon if day.weekday() == 6}
    for day in sorted(sundays):
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

    print(f"§0 her agenda is full: {OTHER_BOOKINGS} other bookings ahead, eight a day")
    def book_her(hours: tuple[str, ...], up_to: int) -> int:
        made = 0
        for day in horizon:
            for hhmm in hours:
                if made == up_to:
                    return made
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
        return made

    hub.check("§0 other bookings made", book_her(EIGHT_A_DAY, OTHER_BOOKINGS), OTHER_BOOKINGS)

    def live_of_customer() -> list:
        return [
            row
            for row in hub.query(
                "appointments.appointments.list_for_customer",
                {"customer_id": links.customer_id, "limit": 100},
            )
            if row["status"] in ("pending", "confirmed")
        ]

    batch_days = horizon[:BATCH]
    batch = {
        "customer_id": links.customer_id,
        "service_id": links.service_id,
        "staff_id": links.staff_id,
    }

    print("§1 a batch with ONE slot on top of a booking of hers is refused whole")
    clash = [
        {"start_datetime": business_instant(hub, day.isoformat(), "09:00")}
        for day in batch_days[:-1]
    ] + [{"start_datetime": business_instant(hub, batch_days[-1].isoformat(), "15:00")}]
    status, body = hub.command(
        "appointments.appointments.bulk_create", {**batch, "appointments": clash}
    )
    hub.check(
        "§1 refused with the overlap code, not a `wasm` error",
        (status == 200, code_of(body)),
        (False, "appointments.overlapping_appointment"),
    )
    hub.check("§1 nothing of the batch was booked", len(live_of_customer()), 0)

    print(f"§2 a batch of {BATCH} free slots books whole")
    slots = [
        {"start_datetime": business_instant(hub, day.isoformat(), "09:00")}
        for day in batch_days
    ]
    status, body = hub.command(
        "appointments.appointments.bulk_create", {**batch, "appointments": slots}
    )
    hub.check(
        "§2 the batch fits in the kernel's budget (no `wasm` error)",
        (status, (body or {}).get("ok"), code_of(body)),
        (200, True, None),
    )
    hub.check("§2 every slot of the batch booked", len(live_of_customer()), BATCH)

    print(f"§3 with {SERIES_AGENDA} bookings of hers ahead, a daily series books to the horizon")
    more = SERIES_AGENDA - OTHER_BOOKINGS
    hub.check("§3 her agenda grew", book_her(SIX_MORE_A_DAY, more), more)
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
            # 14:00: on every Sunday her break is blocked — those dates are skipped and REPORTED.
            "time": "14:00",
            "duration_minutes": 30,
            "start_date": horizon[0].isoformat(),
        },
    )
    materialize = {
        "recurring_id": recurring_id,
        "customer_id": links.customer_id,
        "service_id": links.service_id,
        "staff_id": links.staff_id,
        "from": horizon[0].isoformat(),
        "to": horizon[-1].isoformat(),
    }
    booked, skipped, failures, pages = 0, [], [], 0
    # 50 a run, and a run also stops where its page of her agenda ends: 400 days take ~12 runs.
    for _ in range(24):
        status, body = hub.command("appointments.recurring.materialize", materialize)
        if status != 200 or not (body or {}).get("ok"):
            failures.append((status, code_of(body)))
            break
        report = (body.get("data") or {}).get("result") or {}
        booked += report.get("booked") or 0
        skipped += [s for s in report.get("skipped") or [] if s not in skipped]
        if report.get("next_from"):
            # The page ended before the window: go on from there, to the SAME window end.
            pages += 1
            hub.check("§3 a page goes on to the same window end", report.get("to"), materialize["to"])
            if report["next_from"] <= materialize["from"]:
                failures.append(("next_from does not move", report["next_from"]))
                break
            materialize["from"] = report["next_from"]
        elif not report.get("booked"):
            break
    hub.check(
        "§3 every run fits in the kernel's budget (no `wasm` error)", failures, []
    )
    hub.check("§3 her agenda took more than one page", pages > 0, True)
    # Her days are read 400 days ahead COUNTING today (`staff.availability.days_ahead`, days=400):
    # the last date of the window is past what can be judged, so it is left for a later run —
    # neither booked unjudged nor reported as refused.
    judged = [day for day in horizon if day < today + datetime.timedelta(days=400)]
    hub.check("§3 the window reaches one day past her read hours", len(horizon) - len(judged), 1)
    hub.check(
        "§3 every judged day but her blocked Sundays booked",
        booked,
        len([day for day in judged if day not in sundays]),
    )
    hub.check(
        "§3 her blocked Sundays are reported, each with the `blocked` code",
        sorted((s["occurrence_date"], s["code"]) for s in skipped),
        sorted((day.isoformat(), "appointments.blocked") for day in sundays if day in judged),
    )
    occurrences = [
        row
        for row in hub.query(
            "appointments.recurring.occurrences", {"recurring_id": recurring_id}
        )
        if row["status"] in ("pending", "confirmed")
    ]
    hub.check("§3 the series is on the agenda", len(occurrences), booked)

    return hub.finish("a full agenda still takes a batch and a series to the horizon")


if __name__ == "__main__":
    sys.exit(main())
