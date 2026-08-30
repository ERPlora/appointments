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
  4. OUTSIDE WORKING HOURS: with a Monday–Friday 09:00–18:00 schedule seeded, 08:00 is refused with
     `reason='outside_schedule'` while 12:00 of the same day is free.

Why against the runtime and not a scratch Postgres: `:hub_id` and `:now` are injected by the HOST,
the `erp_*` bridge functions are rendered by the real dialect, and the rows are written by the WASM
handler inside the runtime's transaction. The `*.postgres.test.py` batteries next door keep proving
the SQL's own edges (untyped binds, the wall-clock window, `max_advance_booking = 0`) far more
cheaply; this one proves the engine as the kernel runs it.

What this file does NOT cover, and it is not an oversight: `outside_schedule` is ADVISORY today —
it informs the screen, it does not close the door. `create`/`reschedule` do not refuse a booking
outside business hours because crossing WALL-CLOCK opening hours with a UTC instant needs the
business timezone in the handler (appointments#89, open). This battery asserts the engine's answer,
which is what exists; the door's refusal belongs to that issue and gets its own test there.

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
    # a hub that already had shifts seeded (§4 seeds them for every later run against this hub).
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

    # ── 4 · outside the working schedule ─────────────────────────────────────────────────
    print("§4 outside the working schedule")
    set_booking_policy(hub, allow_overlapping=False)
    schedule_id = hub.new_id(
        "appointments.schedules.create",
        {"name": f"Horario salón {day}", "is_default": True},
    )
    for day_of_week in range(0, 5):  # 0=Monday … 4=Friday
        hub.run(
            "appointments.timeslots.create",
            {
                "schedule_id": schedule_id,
                "day_of_week": day_of_week,
                "start_time": "09:00",
                "end_time": "18:00",
            },
        )

    # A professional with NO appointments of her own, so the only thing that can refuse here is
    # the schedule — otherwise §4 would be re-testing §1.
    free = seed_links(hub, "schedule", duration_minutes=DURATION)
    avail, reason = availability(hub, noon, DURATION, free.staff_id)
    hub.check("§4 12:00 on a weekday is inside the schedule", (avail, reason), (1, ""))

    avail, reason = availability(hub, instant(day, "08:00"), DURATION, free.staff_id)
    hub.check("§4 08:00 is before opening", avail, 0)
    hub.check("§4 …and the reason is the schedule", reason, "outside_schedule")

    return hub.finish(
        "the availability engine refuses the overlap per professional, keeps the other "
        "professional free, honours the `allow_overlapping` toggle at the engine AND at the door, "
        "and marks the hours outside the working schedule"
    )


if __name__ == "__main__":
    sys.exit(main())
