#!/usr/bin/env python3
"""The `create` DOOR refuses the overlap, and the agenda still lists right after — regression of
ERPlora/hub#110 (P0), ported from the hub (ERPlora/hub#1264, slice `appointments`).

Replaces `create_rejects_overlap_and_list_works_after_creation` of
`crates/runtime/tests/appointments_availability_e2e.rs`. Contract «El Hub se CIERRA como KERNEL»
§5: this is `appointments`' own behaviour, so its guard lives here.

hub#110 was TWO bugs in the same minute of use, and both are pinned below:

  (a) `appointments.appointments.create` ACCEPTED a second appointment overlapping the same
      professional with `allow_overlapping=false`. `availability.check` saw it — the screen greyed
      the slot out — but the door did not: the handler never received the existing appointments
      because the command declared no `reads`. Any caller that is not the screen (the assistant, a
      flow, `whatsapp_inbox`, the API) walked straight through. The manifest now declares
      `appointments.appointments.conflicting` as a REQUIRED read and the handler refuses.
  (b) `appointments.appointments.list` blew up immediately after creating an appointment when the
      optional filters were omitted — the runtime binds an absent optional as NULL and the filter
      compared `NULL = ''`. So the till booked and then could not show the agenda it had just
      written to.

The refusal is asserted by its stable CODE, never by the sentence: the message is business prose
AND translated (ADR-0055), and the hub's own e2e went red the day this module rewrote it in human
language (appointments#70/#71) — it was sniffing the `overlap:` prefix. `hub_harness.refused` only
ever looks at `error.code`.

Why against the runtime: (a) is about the DISPATCHER pre-loading a `reads` block before the WASM
handler runs, and (b) is about how the runtime binds an absent optional parameter. Neither exists
in a scratch Postgres that binds its own parameters — this is exactly the class of assertion that
has to face the real kernel.

Usage: tests/create_overlap.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub dev` (see tests/hub_harness.py). Without one it FAILS.
"""

import sys

from hub_harness import Hub, book, instant, next_weekday, seed_links, set_booking_policy

DURATION = 30


def main() -> int:
    hub = Hub("create_overlap.hub")

    set_booking_policy(hub, allow_overlapping=False)
    links = seed_links(hub, "door", duration_minutes=DURATION)
    # A THURSDAY, and not the Wednesday the sibling battery books on: this hub is shared by every
    # battery of the run (and by every earlier run against a long-lived hub), and §2 below reads the
    # whole day back.
    day = next_weekday(weekday=3)
    start = instant(day, "12:00")

    print("§1 the first appointment of the day is created")
    created = book(hub, links, links.staff_id, start, DURATION)
    hub.check_true("§1 `create` minted an appointment", bool(created), f"id {created!r}")

    print("§2 the agenda lists right after creating (hub#110 b)")
    # The filters `status`/`staff_id` are OMITTED on purpose — that absence is the bug: the runtime
    # binds them as NULL and the query used to compare `NULL = ''`.
    rows = hub.query(
        "appointments.appointments.list",
        {
            "day_start": instant(day, "00:00"),
            "day_end": instant(day, "23:59"),
            "limit": 100,
        },
    )
    mine = [r for r in rows if r.get("staff_id") == links.staff_id]
    hub.check("§2 the agenda shows the appointment just created", len(mine), 1)
    # The snapshot carries the name the CATALOGUE holds, not the one `book()` sent
    # (appointments#11/#21): the payload proposes, the hub disposes.
    hub.check(
        "§2 …with the professional's name frozen from the catalogue",
        mine[0]["staff_name"] if mine else None,
        links.staff_name,
    )

    print("§3 a SECOND overlapping appointment for the same professional is refused (hub#110 a)")
    hub.refused(
        "§3 `create` at 12:15, same professional",
        "appointments.appointments.create",
        {
            # Real links on purpose: with invented ids the refusal would arrive as
            # `customer_not_found` and this battery would call the overlap proven without ever
            # having reached the gate.
            "customer_id": links.customer_id,
            "customer_name": "Cliente 2",
            "service_id": links.service_id,
            "service_name": links.service_name,
            "staff_id": links.staff_id,
            "staff_name": links.staff_name,
            "start_datetime": instant(day, "12:15"),
            "duration_minutes": DURATION,
        },
        "appointments.overlapping_appointment",
    )

    print("§4 the refused appointment materialised nothing")
    rows_after = hub.query(
        "appointments.appointments.list",
        {
            "day_start": instant(day, "00:00"),
            "day_end": instant(day, "23:59"),
            "limit": 100,
        },
    )
    still_mine = [r for r in rows_after if r.get("staff_id") == links.staff_id]
    hub.check("§4 the agenda still holds exactly one", len(still_mine), 1)
    hub.check(
        "§4 …and it is the one that was accepted",
        still_mine[0]["id"] if still_mine else None,
        created,
    )

    return hub.finish(
        "the `create` door refuses the overlapping booking by its domain code and writes nothing, "
        "and the agenda lists correctly with the optional filters absent"
    )


if __name__ == "__main__":
    sys.exit(main())
