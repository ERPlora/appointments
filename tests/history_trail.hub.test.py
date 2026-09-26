#!/usr/bin/env python3
"""A move and a cancellation leave their line in the appointment's history — regression of
ERPlora/appointments#196, against the REAL kernel.

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

    return hub.finish(
        "a move and a cancellation each leave exactly the history line that says what happened "
        "and who asked, and a refused move leaves none"
    )


if __name__ == "__main__":
    sys.exit(main())
