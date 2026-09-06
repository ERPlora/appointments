#!/usr/bin/env python3
"""The marker that says «this booking is already committed» must stay unforgeable (appointments#136).

WHAT THIS GUARDS. Since #136 an appointment is born `confirmed` instead of `pending` when the
salon asked for it AND one of exactly two things is true (`born_confirmed`, `handler/src/lib.rs`):

  1. the entry carries `booked_online` — the caller's own claim, the same one the row has always
     stored; what is new is that the salon's setting decides what to do with it;
  2. the payload carries a non-empty `request_id`, which the handler reads as «an automation
     booked this», because `_book_from_request` is the ONLY door that carries one.

Door 2 is a marker with no key behind it: nothing checks WHO put the `request_id` there. It is safe
today only because of a property of the manifest — the doors a browser can reach are
`additionalProperties: false` and none of them declares `request_id`, so a caller cannot smuggle
one in, and the only command whose schema does declare it is `internal: true` (reachable from the
event bus and the runtime, never from a client). That property is not enforced anywhere: it is four
JSON files that happen to agree today.

WHY A TEST AND NOT A COMMENT. If someone later adds `"request_id"` to `appointment_create.json` —
to link a created appointment back to a request, which is a perfectly reasonable thing to want — or
flips one of those schemas to `additionalProperties: true`, then ANY caller who can create an
appointment can also decide it skips the salon's review. Nothing would fail: the Rust tests would
stay green, the module would validate, and the hole would ship. This is the guardrail that turns
that silent change into a red test (root CLAUDE.md, «cero regresiones»).

It also pins the event name: `appointments.appointment.confirmed` is emitted from INSIDE the
handler (the confirmation is conditional, so it cannot be declared as the command's `emit`), and
the runtime refuses to queue an event that is not in `events.emits` (hub#240). Drop it from the
manifest and the confirmation goes silently missing at runtime, with every Rust test still green.

Usage: tests/auto_confirm.contract.test.py   (exit 0 = green)
"""

import copy
import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# The marker `born_confirmed` reads as «an automation booked this».
AUTOMATION_MARKER = "request_id"

# Emitted from inside the handler, so the manifest is the only place that declares it.
CONFIRMED_EVENT = "appointments.appointment.confirmed"

# Every wasm entry point that builds a row through `prepare_appointment` — i.e. every door where
# the born status is decided. Keyed by the `handler.function` in the manifest so that renaming a
# command does not quietly drop it out of this battery.
BORN_STATUS_FUNCTIONS = {
    "create_appointment",
    "bulk_create",
    "materialize_recurring",
    "book_from_request",
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


def declares(node, key: str) -> bool:
    """Does this schema declare `key` as a property, at ANY depth (arrays' items included)?"""
    if isinstance(node, dict):
        props = node.get("properties")
        if isinstance(props, dict) and key in props:
            return True
        return any(declares(child, key) for child in node.values())
    if isinstance(node, list):
        return any(declares(child, key) for child in node)
    return False


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
    smuggled = {
        "type": "object",
        "additionalProperties": False,
        "properties": {"appointments": {"type": "array", "items": {
            "type": "object",
            "additionalProperties": False,
            "properties": {AUTOMATION_MARKER: {"type": "string"}},
        }}},
    }
    if not declares(smuggled, AUTOMATION_MARKER):
        fail(
            f"the reader no longer finds `{AUTOMATION_MARKER}` declared inside an array item: "
            "this battery stopped checking the door it exists to watch"
        )

    if declares({"type": "object", "properties": {"customer_id": {"type": "string"}}}, AUTOMATION_MARKER):
        fail(f"the reader reports `{AUTOMATION_MARKER}` on a schema that does not declare it")

    # A property literally NAMED like the marker's value must not count — only a declaration does.
    if declares({"type": "object", "properties": {"notes": {"default": AUTOMATION_MARKER}}}, AUTOMATION_MARKER):
        fail("the reader confuses a default VALUE with a declared property")

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


def check_only_an_internal_door_declares_the_marker() -> None:
    """The marker means «an automation booked this». A client-reachable door must not accept it."""
    for name, decl in sorted(commands_of(MANIFEST).items()):
        schema = load_schema(decl)
        if schema is None or not declares(schema, AUTOMATION_MARKER):
            continue
        if not decl.get("internal"):
            fail(
                f"`{name}` declares `{AUTOMATION_MARKER}` in {decl.get('schema')} and is NOT "
                "`internal: true`: any caller that can run it can make the appointment skip the "
                "salon's review, because `born_confirmed` reads that field as proof an automation "
                "booked it"
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
                f"caller could pass `{AUTOMATION_MARKER}` through it and be born confirmed without "
                "the salon ever seeing the booking"
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
    check_only_an_internal_door_declares_the_marker()
    check_the_public_doors_stay_closed()
    check_the_confirmation_event_is_declared()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print(
        "OK: only an internal door declares the automation marker, the public ones stay closed, "
        "and the confirmation event is declared"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
