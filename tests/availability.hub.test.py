#!/usr/bin/env python3
"""The availability ENGINE against a real kernel — «an agenda with no double booking per
professional» (ERPlora/hub#1264, slice `appointments`).

Replaces `crates/runtime/tests/appointments_availability_e2e.rs` of the hub, which asserted THIS
module's business rules from inside the kernel's own suite. Contract «El Hub se CIERRA como
KERNEL» §5: the kernel proves its contract with a fixture, the module proves its own behaviour.

The authoritative engine is `appointments.availability.check`: what `create`/`reschedule` consult
by `staff_id` BEFORE materialising, and what the screen, the assistant, a flow or an integration
call to know whether a slot can be sold. Since appointments#122 it is a HANDLER command and no
longer a Tier-0 query — the SQL half survives underneath as the read
`appointments.availability.own_rules` — because the opening hours belong to `schedules` and a
query of a module may only name its own module's tables. What this battery pins, section by
section:

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
     enforced. **And the engine says the same**: asked about 08:00 it answers
     `available=0 / outside_schedule`, the door's own word. It used to answer `available` there —
     the hole appointments#122 closed — because the verdict was computed from THIS module's own
     timetable, retired in appointments#118, and the SQL had no way to reach the authority's.

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

The PROFESSIONAL's own shift is enforced by `create` and answered by `appointments.availability.check`
(`outside_staff_hours`, appointments#98); the batch, the series and `reschedule` are appointments#229.
§6 pins the LIST cut to that shift through the real kernel (appointments#230): the read
`staff.availability.day_at` is keyed by the list's bare DATE, which only a real binding proves.

Usage: tests/availability.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub dev` (see tests/hub_harness.py). Without one it FAILS; a
  battery that excuses itself is a green that proves nothing.
"""

import datetime
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
    hub.check(
        "§4 the day is resolved by `schedules`", opening.get("source"), "schedules"
    )
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

    # 🔴 AND THE ENGINE SAYS THE SAME AS THE DOOR (appointments#122). This assertion used to
    # demand `(1, "")` here, and it documented the bug: asking «is 08:00 free?» answered YES about
    # an hour `create` had just refused two lines above, and the caller only found out by trying to
    # book. The screen hid it by filtering with `day_opening` on its own (appointments#105) — the
    # screen's patch, not the engine's answer, and the assistant, a flow and the public API had no
    # such patch. `check` now takes the SQL verdict as a read and adds the hours through
    # `schedule_refusal`, the very function the door just ran, so the two cannot drift.
    # `other_staff_id` on purpose: nothing of this module's own rules objects to that slot, so the
    # ONLY thing that can refuse it here is the schedule.
    avail, reason = availability(hub, shut_hour, DURATION, free.other_staff_id)
    hub.check(
        "§4 the engine answers the same hours the door enforces",
        (avail, reason),
        (0, "outside_schedule"),
    )
    # …and it does not refuse the whole day: 12:00, which the door just accepted, is free for it.
    open_avail, open_reason = availability(
        hub, open_hour, DURATION, free.other_staff_id
    )
    hub.check(
        "§4 …and 12:00, which the door accepts, stays available for the engine",
        (open_avail, open_reason),
        (1, ""),
    )

    # ── 5 · THE LIST, not just the single question (appointments#127) ────────────────────
    #
    # §4 pins the engine answering about ONE hour. This pins the other half of the same
    # contract — the LIST the booking screen paints — because the two had drifted: `check`
    # went through the handler in appointments#122 and started seeing the authority's hours,
    # while `slots` stayed a Tier-0 query that structurally cannot (a module's SQL may only
    # name its own tables), so it kept offering 08:00 on a day it had just refused at 08:00.
    # The raw generator still starts at `calendar_start_hour`, which defaults to 8, so an
    # unfiltered list WOULD contain 08:00 here: this section is only green if the handler
    # carved the hours out.
    print("§5 the LIST of free slots respects the same opening hours")
    page = hub.result(
        "appointments.availability.slots",
        {"date": day, "staff_id": free.other_staff_id, "duration_minutes": DURATION},
    )
    times = [r["start_time"] for r in page["rows"]]
    ends = [r["end_time"] for r in page["rows"]]
    hub.check_true(
        "§5 the list is not empty on an open day", bool(times), f"got {times!r}"
    )
    hub.check(
        "§5 nothing before 09:00 is offered (08:00 is what the generator would emit)",
        [t for t in times if t < "09:00"],
        [],
    )
    hub.check(
        "§5 …and nothing runs past 18:00, because the whole slot must fit",
        [e for e in ends if e > "18:00"],
        [],
    )
    hub.check_true(
        "§5 …while 12:00, the hour the door accepts, IS offered",
        "12:00" in times,
        f"got {times!r}",
    )
    # The envelope stays the one an unpaginated query answered, so every existing caller keeps
    # reading it the same way. `total` counting the FILTERED rows is the load-bearing half: a
    # `total` left over from the generator would tell a paginating caller there are more hours
    # than the business is open for, which is the same bug one level up.
    hub.check(
        "§5 the page still answers the four keys of an unpaginated query",
        sorted(page.keys()),
        ["limit", "offset", "rows", "total"],
    )
    hub.check(
        "§5 …and `total` counts what came back, not what the generator produced",
        (page["total"], page["offset"]),
        (len(times), 0),
    )

    # ── 6 · THE LIST cut to the PROFESSIONAL's shift (appointments#230) ───────────────────
    #
    # #98 closed the door on the hours a professional does not work; the list kept offering them,
    # so the assistant or a WhatsApp recipe picked one and `create` refused it one step later. The
    # list now reads `staff.availability.day_at` keyed by its bare DATE — the business opens
    # 09:00-18:00 (§4) and this professional works only 10:00-13:00 that weekday.
    print("§6 the LIST of free slots respects the professional's own shift")
    shift = seed_links(hub, "shift", duration_minutes=DURATION)
    hub.run(
        "staff.schedules.create",
        {
            "staff_id": shift.staff_id,
            "name": "Mornings",
            "is_default": 1,
            "working_hours": [
                {
                    "day_of_week": datetime.date.fromisoformat(day).weekday(),
                    "start_time": "10:00:00",
                    "end_time": "13:00:00",
                }
            ],
        },
    )
    page = hub.result(
        "appointments.availability.slots",
        {"date": day, "staff_id": shift.staff_id, "duration_minutes": DURATION},
    )
    times = [r["start_time"] for r in page["rows"]]
    ends = [r["end_time"] for r in page["rows"]]
    hub.check(
        "§6 the list opens and closes with her shift, not with the business",
        (times[:1], times[-1:]),
        (["10:00"], ["12:30"]),
    )
    hub.check(
        "§6 …and nothing runs past 13:00, the end of her shift",
        [e for e in ends if e > "13:00"],
        [],
    )
    hub.check(
        "§6 …and `total` counts what came back",
        page["total"],
        len(times),
    )
    # THE DOOR agrees at both edges: the first hour the list offers books, the hour it dropped is
    # refused with the professional's own word — not the business's.
    hub.refused(
        "§6 14:00 (business open, she is not) is refused by the door",
        "appointments.appointments.create",
        {
            "customer_id": shift.customer_id,
            "customer_name": "Cliente",
            "service_id": shift.service_id,
            "service_name": shift.service_name,
            "staff_id": shift.staff_id,
            "staff_name": "no-lo-decide-el-payload",
            "start_datetime": business_instant(hub, day, "14:00"),
            "duration_minutes": DURATION,
        },
        "appointments.outside_staff_hours",
    )
    first = book(hub, shift, shift.staff_id, business_instant(hub, day, "10:00"), DURATION)
    hub.check_true(
        "§6 …and 10:00, the first hour the list offers, books", bool(first), f"got id {first!r}"
    )
    # A professional with NO schedule has not set her hours up: the list stays the business's.
    other = hub.result(
        "appointments.availability.slots",
        {"date": day, "staff_id": shift.other_staff_id, "duration_minutes": DURATION},
    )
    hub.check(
        "§6 a professional with no schedule keeps the business's day (09:00 first)",
        [r["start_time"] for r in other["rows"]][:1],
        ["09:00"],
    )

    return hub.finish(
        "the availability engine refuses the overlap per professional, keeps the other "
        "professional free, honours the `allow_overlapping` toggle at the engine AND at the door, "
        "and the booking door enforces the opening hours `schedules` owns — the same ones "
        "`day_opening` hands the screen, the same ones `availability.check` now answers, and the "
        "same ones the LIST of free slots is cut to, together with the professional's own shift"
    )


if __name__ == "__main__":
    sys.exit(main())
