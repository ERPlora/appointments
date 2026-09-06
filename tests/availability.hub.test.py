#!/usr/bin/env python3
"""The availability ENGINE against a real kernel — «an agenda with no double booking per
professional» (ERPlora/hub#1264, slice `appointments`).

Replaces `crates/runtime/tests/appointments_availability_e2e.rs` of the hub, which asserted THIS
module's business rules from inside the kernel's own suite. Contract «El Hub se CIERRA como
KERNEL» §5: the kernel proves its contract with a fixture, the module proves its own behaviour.

The authoritative engine is the Tier-0 query `appointments.availability.check` (declarative SQL):
it is what `create`/`reschedule` consult by `staff_id` BEFORE materialising, and what the screen
calls to grey a slot out (the WASM handler cannot pre-load reads of its own — ADR-0021). What this
battery pins, section by section:

  1. OVERLAP PER PROFESSIONAL, respecting the service duration: with `allow_overlapping=false`, a
     second appointment for the SAME professional inside [start, start+duration) is refused with
     `reason='overlap'`, the exact same start included; at the closing edge (start+duration) she is
     free again — the window is half-open, and an engine that closed it inclusively would lose the
     back-to-back booking every salon does all day.
  2. CAPACITY = NUMBER OF PROFESSIONALS: the same slot for ANOTHER professional is accepted. This
     is the half that makes the rule a business rule instead of a global lock.
  3. THE `allow_overlapping` TOGGLE: with it on, the double booking is allowed — and the `create`
     door follows the same policy, which is what makes the toggle worth having (the engine saying
     yes while the door says no would be a setting that does nothing).
  4. OUTSIDE WORKING HOURS: with a Monday–Friday 09:00–18:00 week seeded IN `schedules` — the
     authority that owns the opening hours (ADR-0392, appointments#102/#117) — `create` refuses
     08:00 with `appointments.outside_schedule` and books 12:00 of the same day, and
     `appointments.availability.day_opening` hands the screen the same 09:00–18:00 the door just
     enforced. The engine is asked too, and says `available` at 08:00: it used to compute
     `outside_schedule` from THIS module's own timetable, retired in appointments#118, so the
     hours are the door's business alone and the screen filters by `day_opening`
     (appointments#105) instead of trusting the query.

Why against the runtime and not a scratch Postgres: `:hub_id` and `:now` are injected by the HOST,
the `erp_*` bridge functions are rendered by the real dialect, and the rows are written by the WASM
handler inside the runtime's transaction. The `*.postgres.test.py` batteries next door keep proving
the SQL's own edges (untyped binds, the wall-clock window, `max_advance_booking = 0`) far more
cheaply; this one proves the engine as the kernel runs it.

What this file covers, and what it deliberately leaves next door: here the ENGINE's answer — the
`reason` the availability query computes for the screen. The DOOR's refusal (the handler turning
that same reason into `appointments.outside_schedule` and rolling the command back) landed with
appointments#89 and is pinned by the Rust cases in `handler/src/lib.rs`, DST included. Both must
keep saying the same thing: a screen that greys out an hour the door would accept — or the other
way round — is the bug this pair exists to make impossible.

What is still ADVISORY: whether that particular PROFESSIONAL works that hour. The business being
open is enforced; the person's own shift is appointments#98, blocked on `reads.params`.

Usage: tests/availability.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub dev` (see tests/hub_harness.py). Without one it FAILS; a
  battery that excuses itself is a green that proves nothing.
"""

import sys

from hub_harness import (
    Hub,
    availability,
    book,
    business_instant,
    instant,
    next_weekday,
    seed_links,
    set_booking_policy,
)

DURATION = 30  # the wash-and-blow-dry of the requirement


def main() -> int:
    hub = Hub("availability.hub")

    # ── 1+2 · overlap per professional, and capacity = number of professionals ────────────
    print("§1 overlap for the SAME professional, free for another one")
    set_booking_policy(hub, allow_overlapping=False)
    links = seed_links(hub, "overlap", duration_minutes=DURATION)
    day = next_weekday()
    # 12:00 on purpose: inside any plausible working schedule, so this section stays true even on
    # a hub that already had its week seeded (§4 seeds one in `schedules` for every later run
    # against this shared hub).
    noon = instant(day, "12:00")

    book(hub, links, links.staff_id, noon, DURATION)

    avail, reason = availability(hub, instant(day, "12:15"), DURATION, links.staff_id)
    hub.check("§1 second booking of P1 at 12:15 is refused", avail, 0)
    hub.check("§1 …and the reason is the overlap", reason, "overlap")

    avail, reason = availability(hub, noon, DURATION, links.staff_id)
    hub.check("§1 the exact same start overlaps too", (avail, reason), (0, "overlap"))

    avail, reason = availability(hub, instant(day, "12:30"), DURATION, links.staff_id)
    hub.check(
        "§1 at 12:30 P1 is free again (the window [12:00,12:30) is half-open)",
        (avail, reason),
        (1, ""),
    )

    print("§2 the same slot for ANOTHER professional")
    avail, reason = availability(hub, noon, DURATION, links.other_staff_id)
    hub.check("§2 P2 at 12:00 is available", (avail, reason), (1, ""))

    # ── 3 · the toggle ───────────────────────────────────────────────────────────────────
    print("§3 `allow_overlapping` on: the double booking is allowed")
    toggle = seed_links(hub, "toggle", duration_minutes=DURATION)
    set_booking_policy(hub, allow_overlapping=True)
    book(hub, toggle, toggle.staff_id, noon, DURATION)

    avail, reason = availability(hub, noon, DURATION, toggle.staff_id)
    hub.check("§3 the engine allows the double booking", (avail, reason), (1, ""))

    # The setting is only worth having if the DOOR follows it too: the handler reads
    # `appointments.settings.get` (`reads`, required) and skips its own overlap gate.
    second = book(hub, toggle, toggle.staff_id, noon, DURATION)
    hub.check_true(
        "§3 …and `create` books it for real", bool(second), f"got id {second!r}"
    )

    # ── 4 · outside the working hours, which `schedules` owns ────────────────────────────
    print("§4 outside the working hours (`schedules` is the authority)")
    set_booking_policy(hub, allow_overlapping=False)
    # The hours are written where they LIVE (appointments#102/#117): this module has no command
    # that writes a timetable any more, and seeding one through a back door would prove the gate
    # against a surface no owner can reach.
    for day_of_week in range(0, 5):  # 0=Monday … 4=Friday
        hub.run(
            "schedules.business_hours.set",
            {
                "day_of_week": day_of_week,
                "intervals": [{"open_time": "09:00", "close_time": "18:00"}],
            },
        )
    # WALL time, not UTC: the door crosses the booking against the business clock, so 08:00 has to
    # be 08:00 in the shop or this section is about the offset of whoever ran it.
    open_hour = business_instant(hub, day, "12:00")
    shut_hour = business_instant(hub, day, "08:00")

    # THE SCREEN. `day_opening` is what the booking form draws the day from, and it runs the very
    # function the door decides with — no second implementation of ADR-0392's precedence to drift.
    opening = hub.result("appointments.availability.day_opening", {"date": day})
    hub.check("§4 the day is resolved by `schedules`", opening.get("source"), "schedules")
    hub.check(
        "§4 …and the open stretch is 09:00-18:00 in minutes from midnight",
        opening.get("spans"),
        [{"start_minute": 540, "end_minute": 1080}],
    )

    # THE DOOR. A professional with NO appointments of her own, so the only thing that can refuse
    # here is the schedule — otherwise §4 would be re-testing §1.
    free = seed_links(hub, "schedule", duration_minutes=DURATION)
    hub.refused(
        "§4 08:00 is before opening",
        "appointments.appointments.create",
        {
            "customer_id": free.customer_id,
            "customer_name": "Cliente",
            "service_id": free.service_id,
            "service_name": free.service_name,
            "staff_id": free.staff_id,
            "staff_name": "no-lo-decide-el-payload",
            "start_datetime": shut_hour,
            "duration_minutes": DURATION,
        },
        "appointments.outside_schedule",
    )
    booked = book(hub, free, free.staff_id, open_hour, DURATION)
    hub.check_true(
        "§4 …and 12:00 of the same day books", bool(booked), f"got id {booked!r}"
    )

    # AND THE REFUSAL CAME FROM THE DOOR, not from a leftover verdict of the engine.
    # appointments#118 retired this module's own timetable and the `outside_schedule` verdict
    # `availability.check` computed from it, so the engine has nothing to say about the hours and
    # answers `available` at 08:00. That silence is precisely why the screen filters by
    # `day_opening` (appointments#105) instead of trusting the engine, and asserting it here is
    # what keeps §4 from passing by accident.
    avail, reason = availability(hub, shut_hour, DURATION, free.other_staff_id)
    hub.check(
        "§4 the engine alone does not know the hours any more",
        (avail, reason),
        (1, ""),
    )

    return hub.finish(
        "the availability engine refuses the overlap per professional, keeps the other "
        "professional free, honours the `allow_overlapping` toggle at the engine AND at the door, "
        "and the booking door enforces the opening hours `schedules` owns — the same ones "
        "`day_opening` hands the screen"
    )


if __name__ == "__main__":
    sys.exit(main())
