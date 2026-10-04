#!/usr/bin/env python3
"""A series is only CREATED with someone who performs its service — appointments#283, against the kernel.

`appointments.recurring.create` was a bare INSERT: the assistant or the API (which do not go
through the screen's filtered list, appointments#281) could save a series with a professional who
does not perform its service. The series sat in the list, active, and every «Book appointments»
answered `staff_not_eligible` from `recurring.materialize`. Reproduced on the `hub:stable` bench
on 01/10: «Tinte» assigned to Eva and Carla only, `recurring.create` with Marta → 200 `new_ids`,
`materialize` → 409 `appointments.staff_not_eligible`.

What this battery proves through the public API, with real rows of `staff` and `services`:

  §1 the series with a professional who does not perform the service is REFUSED at the door with
     `appointments.staff_not_eligible`, and nothing is saved;
  §2 the same series with the professional who performs it is created AND booked — the door did
     not close for everyone, and `new_ids[0]` is the series `materialize` books;
  §3 a service nobody has been assigned to is performed by the whole team: the series is created.

Usage: tests/recurring_create_eligibility.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub` (see tests/hub_harness.py). Without one it FAILS.
"""

import sys

from hub_harness import Hub, next_weekday, seed_links, set_booking_policy


def series(
    links, staff_id: str, staff_name: str, service_id=None, service_name=None
) -> dict:
    return {
        "customer_id": links.customer_id,
        "customer_name": "Cliente",
        "service_id": service_id or links.service_id,
        "service_name": service_name or links.service_name,
        "staff_id": staff_id,
        "staff_name": staff_name,
        "frequency": "weekly",
        "time": "12:00",
        "duration_minutes": 30,
        # A Wednesday well inside the booking window: a weekend date would be refused by the
        # opening hours and §2 would read that as «the series does not book».
        "start_date": next_weekday(2),
        "max_occurrences": 2,
    }


def series_of(hub: Hub, links) -> list:
    """The series saved with this section's service. The hub is SHARED with every other battery
    and the list carries no ids of the links, so the rows are told apart by the service name,
    which `seed_links` tags per section and the list returns as saved."""
    return [
        r
        for r in hub.query(
            "appointments.recurring.list",
            {"search": links.service_name, "limit": 100},
        )
        if r.get("service_name") == links.service_name
    ]


def main() -> int:
    hub = Hub("recurring_create_eligibility.hub")
    set_booking_policy(hub, allow_overlapping=False)
    links = seed_links(hub, "series283")
    # The service is performed by the OTHER professional only.
    hub.run(
        "staff.services.assign",
        {
            "staff_id": links.other_staff_id,
            "service_id": links.service_id,
            "service_name": links.service_name,
        },
    )

    print("§1 a series with a professional who does not perform the service is refused")
    hub.refused(
        "§1 recurring.create with the professional outside the service",
        "appointments.recurring.create",
        series(links, links.staff_id, links.staff_name),
        "appointments.staff_not_eligible",
    )
    hub.check(
        "§1 …and no series was saved for that customer",
        len(series_of(hub, links)),
        0,
    )

    print(
        "§2 the same series with the professional who performs it is created AND booked"
    )
    recurring_id = hub.new_id(
        "appointments.recurring.create",
        series(links, links.other_staff_id, links.other_staff_name),
    )
    saved = series_of(hub, links)
    hub.check(
        "§2 the saved series is the one the answer named, with her",
        [(r.get("id"), r.get("staff_name")) for r in saved],
        [(recurring_id, links.other_staff_name)],
    )
    report = hub.result(
        "appointments.recurring.materialize",
        {
            "recurring_id": recurring_id,
            "customer_id": links.customer_id,
            "service_id": links.service_id,
            "staff_id": links.other_staff_id,
        },
    )
    hub.check_true(
        "§2 the series books (no `staff_not_eligible` on any date)",
        not any(
            s.get("code") == "appointments.staff_not_eligible"
            for s in report.get("skipped") or []
        )
        and (report.get("booked") or 0) + (report.get("already_booked") or 0) >= 1,
        f"report={report}",
    )

    print("§3 a service nobody has been assigned to is performed by the whole team")
    open_links = seed_links(hub, "series283-open")
    hub.new_id(
        "appointments.recurring.create",
        series(open_links, open_links.staff_id, open_links.staff_name),
    )
    hub.check(
        "§3 the series was saved",
        len(series_of(hub, open_links)),
        1,
    )

    return hub.finish(
        "recurring.create refuses a professional who does not perform the service"
    )


if __name__ == "__main__":
    sys.exit(main())
