#!/usr/bin/env python3
"""The doors that decide «this booking is already committed» stay closed (appointments#136).

WHAT THIS GUARDS. Since #136 an appointment is born `confirmed` instead of `pending` when the
salon asked for it AND the entry carries `booked_online` (`born_confirmed`, `handler/src/lib.rs`).
Until appointments#183 there was a second door — a non-empty `request_id`, carried only by the
WhatsApp requests listener `_book_from_request` — and this battery kept that marker out of every
client-reachable schema. The listener is retired and `request_id` means nothing to the handler any
more (`a_request_id_no_longer_confirms_a_booking_on_arrival` pins that in Rust), so what is left to
guard here is the shape of the doors themselves: every door that decides a born status validates a
CLOSED payload (`additionalProperties: false`), so nothing the handler might read as a marker in
the future can be smuggled past its schema.

It also pins the event name: `appointments.appointment.confirmed` is emitted from INSIDE the
handler (the confirmation is conditional, so it cannot be declared as the command's `emit`), and
the runtime refuses to queue an event that is not in `events.emits` (hub#240). Drop it from the
manifest and the confirmation goes silently missing at runtime, with every Rust test still green.

Usage: tests/auto_confirm.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# Emitted from inside the handler, so the manifest is the only place that declares it.
CONFIRMED_EVENT = "appointments.appointment.confirmed"

# Every wasm entry point that builds a row through `prepare_appointment` — i.e. every door where
# the born status is decided. Keyed by the `handler.function` in the manifest so that renaming a
# command does not quietly drop it out of this battery.
BORN_STATUS_FUNCTIONS = {
    "create_appointment",
    "bulk_create",
    "materialize_recurring",
}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def commands_of(manifest: dict) -> dict:
    return manifest.get("commands", {})


def born_status_doors(manifest: dict) -> dict:
    """`{command name: declaration}` for every door that decides a born status."""
    return {
        name: decl
        for name, decl in commands_of(manifest).items()
        if (decl.get("handler") or {}).get("function") in BORN_STATUS_FUNCTIONS
    }


def load_schema(decl: dict) -> dict | None:
    ref = decl.get("schema")
    if not ref:
        return None
    path = MODULE_DIR / ref
    if not path.exists():
        return None
    return json.loads(path.read_text())


def open_objects(node, path: str = "") -> list[str]:
    """Paths of every object in the schema that does NOT pin `additionalProperties: false`."""
    found: list[str] = []
    if isinstance(node, dict):
        if node.get("type") == "object" and node.get("additionalProperties") is not False:
            found.append(path or "<root>")
        for key, child in node.items():
            found.extend(open_objects(child, f"{path}.{key}" if path else key))
    elif isinstance(node, list):
        for index, child in enumerate(node):
            found.extend(open_objects(child, f"{path}[{index}]"))
    return found


# ── the controls ────────────────────────────────────────────────────────────────────────────────


def check_the_check_finds_the_positive() -> None:
    """Feed the readers the exact bad shapes this battery exists to catch, and demand a report.

    A contract test that only ever runs against a clean tree is green whether it works or not.
    """
    opened = {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object"}}}}
    reported = open_objects(opened)
    if "<root>" not in reported:
        fail("the reader no longer reports a root object left open to extra properties")
    if not any("items" in p for p in reported):
        fail("the reader no longer reports a nested object left open to extra properties")
    if open_objects({"type": "object", "additionalProperties": False, "properties": {}}):
        fail("the reader reports an object that DOES pin `additionalProperties: false`")


def check_every_born_status_door_is_accounted_for() -> None:
    """If the doors went missing, «no door declares the marker» would be true and worthless."""
    doors = born_status_doors(MANIFEST)
    found = {(d.get("handler") or {}).get("function") for d in doors.values()}
    missing = BORN_STATUS_FUNCTIONS - found
    if missing:
        fail(
            "the manifest no longer routes to "
            + ", ".join(sorted(missing))
            + " — either they were renamed (update BORN_STATUS_FUNCTIONS) or the born status is "
            "decided somewhere this battery is not looking"
        )


def check_the_public_doors_stay_closed() -> None:
    """`additionalProperties: false` is what stops a marker being smuggled past the schema."""
    for name, decl in sorted(born_status_doors(MANIFEST).items()):
        if decl.get("internal"):
            continue
        schema = load_schema(decl)
        if schema is None:
            fail(f"`{name}` decides a born status and has no schema to validate its payload")
            continue
        for path in open_objects(schema):
            fail(
                f"`{name}` ({decl.get('schema')}) leaves `{path}` open to extra properties: a "
                "caller could pass keys the schema never reviewed straight to the handler that "
                "decides whether the booking skips the salon's review"
            )


def check_the_confirmation_event_is_declared() -> None:
    """The handler emits it conditionally, so `events.emits` is the only declaration there is."""
    emits = (MANIFEST.get("events") or {}).get("emits") or []
    if CONFIRMED_EVENT not in emits:
        fail(
            f"`{CONFIRMED_EVENT}` is not in `events.emits`: the runtime refuses to queue an event "
            "the manifest does not declare (hub#240), so an appointment born confirmed would "
            "announce nothing and every Rust test would still be green"
        )


def main() -> int:
    check_the_check_finds_the_positive()
    check_every_born_status_door_is_accounted_for()
    check_the_public_doors_stay_closed()
    check_the_confirmation_event_is_declared()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print(
        "OK: every door that decides a born status stays closed, and the confirmation event is "
        "declared"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
