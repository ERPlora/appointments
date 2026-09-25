#!/usr/bin/env python3
"""The WhatsApp «requests» door stays retired (appointments#183, half of whatsapp_inbox#206).

WHAT HAPPENED. `whatsapp_inbox` used to park a customer's message as a «request», let somebody at
the salon bind it to a customer, a service and a slot in a panel THIS module provided, approve it,
and emit `whatsapp_inbox.request.approved`; `appointments._book_from_request` listened, booked, and
answered with `appointments.booking_request.fulfilled|failed`. whatsapp_inbox#193 removed the tab
and whatsapp_inbox#206 removed the emitter: a booking that arrives through WhatsApp now lands here
through the ordinary doors and waits among the appointments to confirm. What was left in this
module could not be reached by anyone, yet it was installed in every hub.

WHAT THIS GUARDS. That none of it comes back by accident — a revert, a stale merge, a copy from an
old branch. Each piece is checked where it would be declared or shipped:

  1. the command `appointments._book_from_request`, its schema and its internal sub-step
     `appointments._hold_consume` (which only that command ran);
  2. any listener on a `whatsapp_inbox.*` event — the bus would still deliver it;
  3. the answer events `appointments.booking_request.*`;
  4. the panel that filled the `whatsapp_inbox.request.booking` slot, in the manifest, in the
     sources and in the built bundle a hub downloads;
  5. the strings only that panel painted, in `en` and `es`; the error codes only that door
     produced are marked `deprecated` (ADR-0398 retires a published code in two releases: mark it,
     then delete it) and keep their `en`/`es` text until the second release deletes them;
  6. the handler export (`book_from_request`) in the Rust source and in the built `handler.wasm`.

And that what STAYS is still there: the count of appointments to confirm and the confirm command,
which is where a WhatsApp booking is reviewed now.

Usage: tests/whatsapp_requests_retired.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

RETIRED_COMMANDS = ("appointments._book_from_request", "appointments._hold_consume")
RETIRED_FILES = (
    "schemas/book_from_request.json",
    "commands/_hold_consume.sql",
    "ui/components/erp-appointments-request-booking",
)
RETIRED_EVENT_PREFIX = "appointments.booking_request."
RETIRED_SLOT = "whatsapp_inbox.request.booking"
RETIRED_COMPONENT = "erp-appointments-request-booking"
RETIRED_ERRORS = ("appointments.request_not_bound", "appointments.booking_refused")
# The strings only the retired panel painted. `ui.errLoadCatalogs` is NOT here: the agenda list
# paints it too.
RETIRED_UI_KEYS = (
    "bookingCancel",
    "bookingChange",
    "bookingConfirm",
    "bookingCreateCustomer",
    "bookingCustomer",
    "bookingCustomerSearch",
    "bookingDay",
    "bookingDayClosed",
    "bookingNoSlots",
    "bookingPick",
    "bookingService",
    "bookingSlot",
    "bookingStaff",
    "errCreateCustomer",
    "errLoadSlots",
    "holdCountdown",
    "holdExpired",
    "holdFailed",
    "openingUnknown",
)
RETIRED_HANDLER_EXPORT = "book_from_request"

KEPT_QUERY = "appointments.appointments.count_to_confirm"
KEPT_COMMAND = "appointments.appointments.confirm"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def check_commands() -> None:
    commands = MANIFEST.get("commands") or {}
    for name in RETIRED_COMMANDS:
        if name in commands:
            fail(f"commands: {name!r} is back — only the retired WhatsApp door ran it")
    for rel in RETIRED_FILES:
        if (MODULE_DIR / rel).exists():
            fail(f"{rel}: still in the module")
    if KEPT_COMMAND not in commands:
        fail(
            f"commands: {KEPT_COMMAND!r} is gone — it is where a WhatsApp booking is confirmed now"
        )
    if KEPT_QUERY not in (MANIFEST.get("queries") or {}):
        fail(
            f"queries: {KEPT_QUERY!r} is gone — the bell counting bookings to confirm needs it"
        )


def check_events() -> None:
    events = MANIFEST.get("events") or {}
    for trigger in events.get("listen") or {}:
        if trigger.startswith("whatsapp_inbox."):
            fail(
                f"events.listen: {trigger!r} — Citas must not listen to WhatsApp events"
            )
    for name in events.get("emits") or []:
        if name.startswith(RETIRED_EVENT_PREFIX):
            fail(f"events.emits: {name!r} — nobody asks for a booking request any more")


def check_slot() -> None:
    for entry in MANIFEST.get("provides_slots") or []:
        if (
            entry.get("slot") == RETIRED_SLOT
            or entry.get("component") == RETIRED_COMPONENT
        ):
            fail(f"provides_slots: {entry} — the tab this panel filled was retired")
    bundle = MODULE_DIR / "dist" / "appointments.esm.js"
    if bundle.exists() and RETIRED_COMPONENT in bundle.read_text(errors="replace"):
        fail(
            f"dist/appointments.esm.js still defines {RETIRED_COMPONENT!r}: rebuild dist/"
        )


def check_locales() -> None:
    declared = MANIFEST.get("errors") or {}
    for code in RETIRED_ERRORS:
        decl = declared.get(code)
        if not isinstance(decl, dict) or not isinstance(decl.get("deprecated"), str):
            fail(
                f"module.json: errors.{code} is not marked `deprecated` — ADR-0398 retires a "
                "published code in two releases, and this is the first"
            )
    for lang in ("en", "es"):
        catalog = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text())
        for code in RETIRED_ERRORS:
            if code in declared and code not in (catalog.get("errors") or {}):
                fail(f"locales/{lang}.json: errors.{code} — a declared code needs its text")
        for key in RETIRED_UI_KEYS:
            if key in (catalog.get("ui") or {}):
                fail(f"locales/{lang}.json: ui.{key} — only the retired panel painted it")


def check_schemas() -> None:
    """A schema description is contract text a hub author reads: it must not name the retired door."""
    for schema in sorted((MODULE_DIR / "schemas").glob("*.json")):
        if "_book_from_request" in schema.read_text():
            fail(f"schemas/{schema.name}: still describes `_book_from_request`")


def check_handler() -> None:
    source = (MODULE_DIR / "handler" / "src" / "lib.rs").read_text()
    if f"pub fn {RETIRED_HANDLER_EXPORT}(" in source:
        fail(f"handler/src/lib.rs: `pub fn {RETIRED_HANDLER_EXPORT}` is still exported")
    if RETIRED_EVENT_PREFIX in source:
        fail(f"handler/src/lib.rs: still names {RETIRED_EVENT_PREFIX}*")
    for code in RETIRED_ERRORS:
        if f'"{code}"' in source:
            fail(f"handler/src/lib.rs: still produces the deprecated {code!r}")
    wasm = MODULE_DIR / "dist" / "handler.wasm"
    if wasm.exists() and RETIRED_HANDLER_EXPORT.encode() in wasm.read_bytes():
        fail(
            f"dist/handler.wasm still exports {RETIRED_HANDLER_EXPORT!r}: rebuild the handler"
        )


def main() -> int:
    check_commands()
    check_events()
    check_slot()
    check_locales()
    check_schemas()
    check_handler()
    if failures:
        print("FAIL whatsapp_requests_retired:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK whatsapp_requests_retired: the WhatsApp requests door stays retired")
    return 0


if __name__ == "__main__":
    sys.exit(main())
