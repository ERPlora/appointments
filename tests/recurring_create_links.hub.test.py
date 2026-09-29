#!/usr/bin/env python3
"""A series can only be CREATED with what it can be BOOKED with — appointments#246, against the kernel.

`appointments.recurring.create` accepted a series without a professional (the assistant and the
API could send one; the screen never did), and the series then sat in the list, active, with
«Book appointments» failing on `recurring.materialize`'s own schema. Reproduced on the
`hub:stable` bench on 29/09: `create` without `staff_id` → `ok`, `materialize` → 422.

`tests/recurring_create_booking_ids.contract.test.py` pins the schema itself. This battery proves
the thing that only the runtime can: that the kernel APPLIES that schema at the door, so the
refusal reaches the caller as `invalid_payload` (naming the field in `fields` when it came empty
or null) — and that a complete series still goes all the way to booked appointments, so the door
did not just close for everyone.

Usage: tests/recurring_create_links.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`services`+`staff`+`appointments` installed:
  `erplora test <dir> --against-hub` (see tests/hub_harness.py). Without one it FAILS.
"""

import datetime
import sys

from hub_harness import Hub, seed_links, set_booking_policy


def main() -> int:
    hub = Hub("recurring_create_links.hub")
    set_booking_policy(hub, allow_overlapping=False)
    links = seed_links(hub, "series246")
    complete = {
        "customer_id": links.customer_id,
        "customer_name": "Cliente",
        "service_id": links.service_id,
        "service_name": links.service_name,
        "staff_id": links.staff_id,
        "staff_name": links.staff_name,
        "frequency": "weekly",
        "time": "12:00",
        "duration_minutes": 30,
        "start_date": (datetime.date.today() + datetime.timedelta(days=7)).isoformat(),
        "max_occurrences": 2,
    }

    print(
        "§1 a series without one of its links is refused at the door, naming the field"
    )
    for field in ("staff_id", "customer_id", "service_id"):
        for label, payload in (
            ("absent", {k: v for k, v in complete.items() if k != field}),
            ("empty", {**complete, field: ""}),
            ("null", {**complete, field: None}),
        ):
            status, body = hub.command("appointments.recurring.create", payload)
            error = (body or {}).get("error") or {} if isinstance(body, dict) else {}
            hub.check(
                f"§1 `{field}` {label} → refused as invalid_payload",
                (status != 200, error.get("code")),
                (True, "invalid_payload"),
            )
            # A key that is ABSENT is a violation of the object itself: the kernel names no
            # field for it on purpose (hub#1094, `invalid_payload_fields`). An empty or null
            # value is a violation OF the field, and that one is named.
            if label != "absent":
                hub.check_true(
                    f"§1 …and the refusal names `{field}`",
                    field in (error.get("fields") or []),
                    f"error={error}",
                )

    print(
        "§2 the complete series is created AND booked (the door is not closed for everyone)"
    )
    recurring_id = hub.new_id("appointments.recurring.create", complete)
    report = hub.result(
        "appointments.recurring.materialize",
        {
            "recurring_id": recurring_id,
            "customer_id": links.customer_id,
            "service_id": links.service_id,
            "staff_id": links.staff_id,
        },
    )
    rows = hub.query(
        "appointments.recurring.occurrences", {"recurring_id": recurring_id}
    )
    hub.check_true(
        "§2 the series has booked appointments",
        bool(rows)
        and (report.get("booked") or 0)
        + (report.get("already_booked") or 0)
        + len(report.get("skipped") or [])
        == 2,
        f"report={report} occurrences={[r.get('occurrence_date') for r in rows]}",
    )

    return hub.finish("recurring.create requires what materialize books with")


if __name__ == "__main__":
    sys.exit(main())
