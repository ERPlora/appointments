#!/usr/bin/env python3
"""Erasing a customer's personal data empties her copies in the agenda — pm#637 (appointments
layer, APPOINTMENTS-F24), against the REAL kernel.

The gesture is the one a salon makes: **Clientes → Borrar datos personales**. `customers.anonymize`
rewrites the sheet and publishes `customer.anonymized`; the runtime's outbox relay hands it to every
module that listens, inside its own transaction, with `:hub_id` and `:now` injected by the host.
Before pm#637 `appointments` did not listen: the customer's name, phone, email, both notes (the
internal one with an allergy) and the reason she gave to cancel stayed in the agenda, the series and
the history for as long as the hub lived.

The Postgres battery next door (`customer_erasure.postgres.test.py`) pins every column, every arm of
the idempotence guard and the tenancy with two hubs. This one proves what only the runtime can: that
the event the REAL `customers` emits reaches this module's listener and the agenda the salon opens
afterwards no longer names her.

Usage: tests/customer_erasure.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`schedules`+`services`+`staff`+`appointments`
  installed (see tests/hub_harness.py). Without one it FAILS.
"""

import json
import sys
import time
import uuid

from hub_harness import Hub, book, instant, next_weekday, seed_links, set_booking_policy

DURATION = 30
# The relay delivers on its own tick, after the erasure committed: wait for it, never sleep blind.
RELAY_DEADLINE_SECONDS = 60


def appointment(hub: Hub, appointment_id: str) -> dict:
    rows = hub.query(
        "appointments.appointments.get", {"appointment_id": appointment_id}
    )
    return rows[0] if rows else {}


def series(hub: Hub, recurring_id: str) -> dict:
    rows = hub.query("appointments.recurring.get", {"recurring_id": recurring_id})
    return rows[0] if rows else {}


def trail(hub: Hub, appointment_id: str) -> list[dict]:
    return hub.query(
        "appointments.appointments.history", {"appointment_id": appointment_id}
    )


def new_value(row: dict) -> dict:
    try:
        return json.loads(row.get("new_value") or "{}")
    except json.JSONDecodeError:
        return {}


def main() -> int:
    hub = Hub("customer_erasure.hub")

    set_booking_policy(hub, allow_overlapping=False)
    links = seed_links(hub, "erase", duration_minutes=DURATION)
    mark = uuid.uuid4().hex[:6]
    name = f"Ana Erase {mark}"
    phone = f"+3460{int(mark, 16) % 10_000_000:07d}"
    email = f"ana-{mark}@example.com"
    # A real sheet with a name, a phone and an email: `create` copies them from HERE, not from
    # the payload, so this is what the agenda would keep.
    customer_id = hub.new_id(
        "customers.create", {"name": name, "phone": phone, "email": email}
    )
    links.customer_id = customer_id
    # A TUESDAY: the sibling batteries book on Wednesday, Thursday and Friday of the same shared hub.
    day = next_weekday(weekday=1)

    print("§0 she books twice, leaves notes and cancels one with a reason")
    kept = book(hub, links, links.staff_id, instant(day, "10:00"), DURATION)
    hub.run(
        "appointments.appointments.update",
        {
            "appointment_id": kept,
            "start_datetime": instant(day, "10:00"),
            "notes": "prefers the window seat",
            "internal_notes": "allergic to PPD",
        },
    )
    cancelled = book(hub, links, links.staff_id, instant(day, "12:00"), DURATION)
    hub.run(
        "appointments.appointments.cancel",
        {"appointment_id": cancelled, "reason": f"moving to Paris {mark}"},
    )
    recurring_id = hub.new_id(
        "appointments.recurring.create",
        {
            "customer_id": customer_id,
            "customer_name": name,
            "service_id": links.service_id,
            "service_name": links.service_name,
            "staff_id": links.other_staff_id,
            "frequency": "weekly",
            "day_of_week": 1,
            "time": "16:00",
            "duration_minutes": DURATION,
            "start_date": day,
        },
    )
    # Someone else's appointment on the same day: the erasure must not reach it.
    other_customer = hub.new_id(
        "customers.create", {"name": f"Luis {mark}", "phone": "+34611111111"}
    )
    links.customer_id = other_customer
    someone = book(hub, links, links.other_staff_id, instant(day, "10:00"), DURATION)
    links.customer_id = customer_id

    before = appointment(hub, kept)
    hub.check_true(
        "§0 control armed: the agenda holds her name, phone, email and notes",
        (
            before.get("customer_name"),
            before.get("customer_phone"),
            before.get("customer_email"),
            before.get("internal_notes"),
        )
        == (name, phone, email, "allergic to PPD"),
        f"appointment: {before}",
    )
    hub.check(
        "§0 control armed: the series holds her name",
        series(hub, recurring_id).get("customer_name"),
        name,
    )
    hub.check(
        "§0 control armed: the history holds her cancellation reason",
        [
            new_value(r).get("reason")
            for r in trail(hub, cancelled)
            if r.get("action") == "cancelled"
        ],
        [f"moving to Paris {mark}"],
    )

    print("§1 Clientes → Borrar datos personales")
    hub.run(
        "customers.anonymize", {"customer_id": customer_id, "reason": "GDPR request"}
    )
    deadline = time.monotonic() + RELAY_DEADLINE_SECONDS
    erased = appointment(hub, kept)
    while erased.get("customer_phone") and time.monotonic() < deadline:
        time.sleep(1)
        erased = appointment(hub, kept)

    print("§2 the agenda no longer names her")
    for label, appointment_id in (
        ("the kept appointment", kept),
        ("the cancelled one", cancelled),
    ):
        row = appointment(hub, appointment_id)
        hub.check(
            f"§2 {label}: name, phone, email, notes and reason are empty",
            {
                k: row.get(k)
                for k in (
                    "customer_name",
                    "customer_phone",
                    "customer_email",
                    "notes",
                    "internal_notes",
                    "cancellation_reason",
                )
            },
            {
                k: ""
                for k in (
                    "customer_name",
                    "customer_phone",
                    "customer_email",
                    "notes",
                    "internal_notes",
                    "cancellation_reason",
                )
            },
        )
    hub.check(
        "§2 the business keeps the slot: same time, professional, service and status",
        {
            k: erased.get(k)
            for k in (
                "start_datetime",
                "staff_id",
                "service_id",
                "status",
                "customer_id",
            )
        },
        {
            k: before.get(k)
            for k in (
                "start_datetime",
                "staff_id",
                "service_id",
                "status",
                "customer_id",
            )
        },
    )
    hub.check(
        "§2 the series no longer names her",
        series(hub, recurring_id).get("customer_name"),
        "",
    )
    # What the «Repeating» list reads: it paints «Deleted customer» only for a row that still
    # links a sheet and has no name, so the list must hand over the link, not just the blank
    # name (without it the cell fell back to a dash, as if the series never had a customer).
    listed = [
        {k: r.get(k) for k in ("customer_id", "customer_name")}
        for r in hub.query(
            "appointments.recurring.list", {"search": links.service_name}
        )
        if r.get("id") == recurring_id
    ]
    hub.check(
        "§2 the series list hands over the link and the blank name",
        listed,
        [{"customer_id": customer_id, "customer_name": ""}],
    )
    created = [new_value(r) for r in trail(hub, kept) if r.get("action") == "created"]
    hub.check(
        "§2 the «created» line no longer names her",
        [c.get("customer_name") for c in created],
        [""],
    )
    hub.check(
        "§2 the «cancelled» line no longer carries her reason",
        [
            new_value(r).get("reason")
            for r in trail(hub, cancelled)
            if r.get("action") == "cancelled"
        ],
        [""],
    )

    print("§3 someone else's appointment is untouched")
    other = appointment(hub, someone)
    hub.check(
        "§3 the other customer keeps her name and phone",
        (other.get("customer_name"), other.get("customer_phone")),
        (f"Luis {mark}", "+34611111111"),
    )

    return hub.finish(
        "erasing a customer from Clientes empties her name, contact, notes and reasons in the "
        "appointments, the series and the history, keeps the slot, and leaves everyone else alone"
    )


if __name__ == "__main__":
    sys.exit(main())
