#!/usr/bin/env python3
"""A move and a cancellation leave their line in the appointment's history — regression of
ERPlora/appointments#196, against the REAL kernel. It also holds the general edit (`update`): judged
like the agenda (#271) and writing only the fields it is sent (#274).

What broke: `reschedule` and `cancel` are WASM commands. The handler returns its writes as separate
operations, and the runtime binds the system params — `:now` among them — once PER OPERATION
(`crates/runtime/src/commands.rs`, WASM path: `system_params` inside the loop over
`output.operations`). The history lines were separate operations that pinned themselves to the row
the UPDATE had just written with `a.updated_at = :now`; with a `:now` minted a few microseconds
later that pin matched nothing, the INSERT wrote zero rows and the command still answered OK. The
trail kept «created» and «confirmed» and silently lost every move and every cancellation — and with
them WHO asked for it (appointments#145), which is what the receptionist opens the history for.

The Postgres batteries next door did not see it because they bind ONE `:now` for the whole chain,
which is what the declarative path does and exactly what the WASM path does not. Only the runtime
can say how it binds, so this battery asks the runtime.

Usage: tests/history_trail.hub.test.py   (exit 0 = green)
  Needs a live runtime with `taxes`+`customers`+`schedules`+`services`+`staff`+`appointments`
  installed (see tests/hub_harness.py). Without one it FAILS.
"""

import json
import sys

from hub_harness import Hub, book, instant, next_weekday, seed_links, set_booking_policy

DURATION = 30


def trail(hub: Hub, appointment_id: str) -> list[dict]:
    return hub.query(
        "appointments.appointments.history", {"appointment_id": appointment_id}
    )


def line(rows: list[dict], action: str) -> dict | None:
    return next((r for r in rows if r.get("action") == action), None)


def new_value(row: dict | None) -> dict:
    if not row or not row.get("new_value"):
        return {}
    try:
        return json.loads(row["new_value"])
    except json.JSONDecodeError:
        return {}


def main() -> int:
    hub = Hub("history_trail.hub")

    set_booking_policy(hub, allow_overlapping=False)
    links = seed_links(hub, "trail", duration_minutes=DURATION)
    # A FRIDAY: the sibling batteries book on Wednesday and Thursday of the same shared hub.
    day = next_weekday(weekday=4)

    print("§1 a move from the counter leaves a «rescheduled» line, stamped `staff`")
    moved = book(hub, links, links.staff_id, instant(day, "10:00"), DURATION)
    hub.run(
        "appointments.appointments.reschedule",
        {"appointment_id": moved, "start_datetime": instant(day, "15:00")},
    )
    rows = trail(hub, moved)
    rescheduled = line(rows, "rescheduled")
    hub.check_true(
        "§1 the history holds a «rescheduled» line",
        rescheduled is not None,
        f"actions: {[r.get('action') for r in rows]}",
    )
    stamp = new_value(rescheduled)
    hub.check("§1 …that says who asked for it", stamp.get("channel"), "staff")
    hub.check_true(
        "§1 …and where the appointment landed",
        str(stamp.get("start_datetime", "")).startswith(f"{day}T15:00"),
        f"new_value: {stamp}",
    )

    print("§2 a cancellation leaves a «cancelled» line with its reason")
    cancelled = book(hub, links, links.staff_id, instant(day, "12:00"), DURATION)
    hub.run(
        "appointments.appointments.cancel",
        {"appointment_id": cancelled, "reason": "client called"},
    )
    rows = trail(hub, cancelled)
    cancel_line = line(rows, "cancelled")
    hub.check_true(
        "§2 the history holds a «cancelled» line",
        cancel_line is not None,
        f"actions: {[r.get('action') for r in rows]}",
    )
    stamp = new_value(cancel_line)
    hub.check("§2 …that says who cancelled", stamp.get("channel"), "staff")
    hub.check("§2 …and why", stamp.get("reason"), "client called")

    print("§3 a refused move leaves NO line (the pin still means «only what happened»)")
    hub.refused(
        "§3 moving the cancelled appointment",
        "appointments.appointments.reschedule",
        {"appointment_id": cancelled, "start_datetime": instant(day, "16:00")},
        "appointments.cannot_reschedule",
    )
    rows = trail(hub, cancelled)
    hub.check(
        "§3 the cancelled appointment still has no «rescheduled» line",
        [r.get("action") for r in rows if r.get("action") == "rescheduled"],
        [],
    )

    print(
        "§4 editing ONE appointment to another professional leaves «staff_changed» (#260)"
    )
    edited = book(hub, links, links.staff_id, instant(day, "11:00"), DURATION)
    edit = {
        "appointment_id": edited,
        "customer_name": "Cliente",
        "service_id": links.service_id,
        "service_name": links.service_name,
        "staff_id": links.other_staff_id,
        "staff_name": links.other_staff_name,
        "start_datetime": instant(day, "11:00"),
        "end_datetime": instant(day, "11:30"),
        "duration_minutes": DURATION,
    }
    hub.run("appointments.appointments.update", edit)
    rows = trail(hub, edited)
    handed = line(rows, "staff_changed")
    hub.check_true(
        "§4 the history holds a «staff_changed» line",
        handed is not None,
        f"actions: {[r.get('action') for r in rows]}",
    )
    had = new_value({"new_value": (handed or {}).get("old_value")})
    has = new_value(handed)
    hub.check("§4 …that says who had it", had.get("staff_name"), links.staff_name)
    hub.check("§4 …and who has it now", has.get("staff_name"), links.other_staff_name)
    hub.check("§4 …stamped from the counter", has.get("channel"), "staff")

    print(
        "§5 editing only the notes, the slot re-sent in another offset, leaves NO line"
    )
    before = len(trail(hub, edited))
    hub.run(
        "appointments.appointments.update",
        {
            **edit,
            "start_datetime": f"{day}T12:00:00+01:00",
            "end_datetime": f"{day}T12:30:00+01:00",
            "notes": "prefers the window seat",
        },
    )
    hub.check("§5 the trail did not grow", len(trail(hub, edited)), before)

    judged_like_the_agenda(hub, links, day)
    partial_edit_keeps_what_it_does_not_name(hub, links, day)

    return hub.finish(
        "a move, a cancellation and an edit each leave exactly the history line that says what "
        "happened and who asked, a refused move or a notes-only edit leaves none, an edit "
        "that hands an appointment over is judged like the agenda's, and a partial edit keeps "
        "the contact and the notes it does not name"
    )


def appointment(hub: Hub, appointment_id: str) -> dict:
    rows = hub.query(
        "appointments.appointments.get", {"appointment_id": appointment_id}
    )
    return rows[0] if rows else {}


def judged_like_the_agenda(hub: Hub, links, day: str) -> None:
    """appointments#271: the general edit (`update`, the one the assistant, flows and API keys
    call) wrote the professional, the service and their names exactly as the caller sent them. It
    now takes the agenda's road (`reschedule`, appointments#263): the professional and the service
    are resolved against the hub's records, the price comes from the catalogue, and the slot is
    judged on whoever will do it."""
    colour_name = f"Tinte {links.service_name}"
    tax_key = next(
        (c["key"] for c in hub.query("taxes.categories.list") if c.get("key")), None
    )
    colour_id = hub.new_id(
        "services.services.create",
        {
            "name": colour_name,
            "tax_category_key": tax_key,
            "duration_minutes": DURATION,
            "price": 4500,
            "is_bookable": 1,
        },
    )
    subject = book(hub, links, links.staff_id, instant(day, "13:00"), DURATION)
    edit = {
        "appointment_id": subject,
        "customer_name": "Cliente",
        "service_id": links.service_id,
        "service_name": links.service_name,
        "staff_id": links.staff_id,
        "staff_name": links.staff_name,
        "start_datetime": instant(day, "13:00"),
        "end_datetime": instant(day, "13:30"),
        "duration_minutes": DURATION,
    }

    print("§6 an edit to a professional the hub does not have is refused (#271)")
    hub.refused(
        "§6 handing the appointment to an invented professional",
        "appointments.appointments.update",
        {**edit, "staff_id": "staff-that-does-not-exist", "staff_name": "Nadie"},
        "appointments.staff_not_found",
    )
    hub.check(
        "§6 …and the appointment keeps its professional",
        appointment(hub, subject).get("staff_id"),
        links.staff_id,
    )

    print("§7 an edit to a service the hub does not have is refused (#271)")
    hub.refused(
        "§7 changing to an invented service",
        "appointments.appointments.update",
        {**edit, "service_id": "service-that-does-not-exist", "service_name": "Nada"},
        "appointments.service_not_found",
    )

    print("§8 an edit onto the new professional's blocked time is refused (#271)")
    hub.run(
        "appointments.blocked_times.create",
        {
            "title": "Formación",
            "staff_id": links.other_staff_id,
            "start_datetime": instant(day, "12:30"),
            "end_datetime": instant(day, "14:30"),
        },
    )
    hub.refused(
        "§8 handing the appointment to a professional who is in training",
        "appointments.appointments.update",
        {
            **edit,
            "staff_id": links.other_staff_id,
            "staff_name": links.other_staff_name,
        },
        "appointments.blocked",
    )
    hub.check(
        "§8 …and the appointment stays with its professional",
        appointment(hub, subject).get("staff_id"),
        links.staff_id,
    )

    print(
        "§9 a new service brings its catalogue name and price, not the caller's (#271)"
    )
    hub.run(
        "appointments.appointments.update",
        {**edit, "service_id": colour_id, "service_name": "lo-decide-el-payload"},
    )
    row = appointment(hub, subject)
    hub.check("§9 the service changed", row.get("service_id"), colour_id)
    hub.check("§9 …with the catalogue's name", row.get("service_name"), colour_name)
    hub.check_true(
        "§9 …and the catalogue's price",
        int(row.get("service_price") or 0) == 4500,
        f"service_price: {row.get('service_price')!r}",
    )


DETAILS = {
    "customer_name": "Ana García",
    "customer_phone": "+34600111222",
    "customer_email": "ana@example.com",
    "notes": "allergic to ammonia",
    "internal_notes": "pays by card",
}


def partial_edit_keeps_what_it_does_not_name(hub: Hub, links, day: str) -> None:
    """appointments#274: the assistant edits by sending what changes («move Ana's appointment to
    17:30», «hand it to Carla»). The schema filled every contact and notes field it left out with
    `""` — the runtime materialises a `default` BEFORE the handler runs — and the edit wrote them:
    the customer's phone, email and both notes were wiped without anyone asking. Only the runtime
    applies the schema, so only a battery against the runtime can say the default is gone."""
    subject = book(hub, links, links.staff_id, instant(day, "17:00"), DURATION)
    hub.run(
        "appointments.appointments.update",
        {
            "appointment_id": subject,
            "start_datetime": instant(day, "17:00"),
            **DETAILS,
        },
    )
    row = appointment(hub, subject)
    for key, value in DETAILS.items():
        hub.check(f"§10 the full edit wrote {key}", row.get(key), value)

    print("§10 handing the appointment over with nothing else keeps contact and notes (#274)")
    hub.run(
        "appointments.appointments.update",
        {
            "appointment_id": subject,
            "staff_id": links.other_staff_id,
            "service_id": links.service_id,
            "start_datetime": instant(day, "17:00"),
        },
    )
    row = appointment(hub, subject)
    hub.check("§10 the appointment changed hands", row.get("staff_id"), links.other_staff_id)
    for key, value in DETAILS.items():
        hub.check(f"§10 …and kept {key}", row.get(key), value)

    print("§11 moving it with only the new time keeps contact and notes (#274)")
    hub.run(
        "appointments.appointments.update",
        {"appointment_id": subject, "start_datetime": instant(day, "17:30")},
    )
    row = appointment(hub, subject)
    hub.check_true(
        "§11 the appointment moved",
        str(row.get("start_datetime", "")).startswith(f"{day}T17:30"),
        f"start_datetime: {row.get('start_datetime')!r}",
    )
    for key, value in DETAILS.items():
        hub.check(f"§11 …and kept {key}", row.get(key), value)

    print("§12 a field sent empty is cleared, and only that one (#274)")
    hub.run(
        "appointments.appointments.update",
        {
            "appointment_id": subject,
            "start_datetime": instant(day, "17:30"),
            "customer_phone": "",
            "internal_notes": "",
        },
    )
    row = appointment(hub, subject)
    hub.check("§12 the phone sent empty is cleared", row.get("customer_phone"), "")
    hub.check("§12 the internal notes sent empty are cleared", row.get("internal_notes"), "")
    for key in ("customer_name", "customer_email", "notes"):
        hub.check(f"§12 …and {key} is kept", row.get(key), DETAILS[key])


if __name__ == "__main__":
    sys.exit(main())
