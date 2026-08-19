#!/usr/bin/env python3
"""`appointments._book_from_request` contract test (appointments#38) — an approved WhatsApp request
has to REACH this module, book like anything else, and answer back.

The behaviour lives in the handler (`book_from_request_pure`, unit-tested in `handler/src/lib.rs`).
What cannot be unit-tested there is the WIRING, and the wiring is where this chain died: the whole
feature was a missing entry in `events.listen`. A listener that is not declared, a command that
does not exist, a read whose owner is not in `depends_on` (hub#610: it is omitted SILENTLY), or an
answer event this module does not declare (hub#240: emitting it FAILS the command) all break at
runtime with nothing to see. This file pins each one:

  1. LISTENER. `whatsapp_inbox.request.approved` is listened to, and lands on a command of THIS
     module (since hub#659 a listener may not name another module's command, and the installer
     refuses the whole install if it does). `whatsapp_inbox` is deliberately NOT in `depends_on`:
     the bus does not consult it, and a salon with a diary and no WhatsApp must keep working.

  2. READS. The listener resolves the same catalogue as `create` — a booking through this door is
     a booking, not a looser one — and every owner is in `depends_on`. They are declared WITHOUT
     `required` on purpose: a `required` read that cannot resolve aborts the command, and inside a
     listener an aborted command is a dead-letter row nobody reads. The handler already refuses
     when a read is missing (`catalog_unavailable`, `settings_unavailable`,
     `availability_unavailable`), so what this buys is a VISIBLE answer instead of a silent death,
     which is the entire point of the issue.

  3. ANSWERS. Both `appointments.booking_request.*` events are declared in `events.emits` — a
     handler emitting an event its module does not declare makes the command fail (hub#240).

  4. I18N. Every domain code the answer can carry has an English source string and its Spanish
     translation under `errors` (ADR-0055).

  5. SLOT. The panel that BINDS the request to real records is provided by this module
     (`whatsapp_inbox.request.booking`, ADR-0043 §3bis) — `whatsapp_inbox` cannot pick a service, a
     professional and a free slot, and must not learn how.

Usage: tests/booking_from_request.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

TRIGGER = "whatsapp_inbox.request.approved"
COMMAND = "appointments._book_from_request"
HANDLER = "book_from_request"

# The same authoritative catalogue `create` resolves, filtered by the FLAT payload fields — the
# only shape `reads.params` can address (`payload.<field>`).
LISTENER_READS = {
    "appointments.settings.get": {},
    "customers.get": {"customer_id": "payload.customer_id"},
    "services.services.get": {"service_id": "payload.service_id"},
    "staff.members.get": {"staff_id": "payload.staff_id"},
    "staff.services.eligible_for_service": {"service_id": "payload.service_id"},
    "appointments.appointments.conflicting": {
        "staff_id": "payload.staff_id",
        "start_datetime": "payload.start_datetime",
    },
    "appointments.blocked_times.overlapping": {
        "staff_id": "payload.staff_id",
        "start_datetime": "payload.start_datetime",
    },
}

ANSWER_EVENTS = (
    "appointments.booking_request.fulfilled",
    "appointments.booking_request.failed",
)

DOMAIN_CODES = (
    "appointments.request_not_bound",
    "appointments.overlapping_appointment",
    "appointments.booking_refused",
)

BOOKING_SLOT = "whatsapp_inbox.request.booking"
BOOKING_COMPONENT = "erp-appointments-request-booking"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def check_listener() -> None:
    listen = (MANIFEST.get("events") or {}).get("listen") or {}
    entry = listen.get(TRIGGER)
    command = entry.get("command") if isinstance(entry, dict) else None
    if not command:
        fail(
            f"events.listen: nothing listens to {TRIGGER!r} — approving a request on WhatsApp "
            "confirms a row and creates no appointment, which is appointments#38 itself"
        )
        return
    if command != COMMAND:
        fail(f"events.listen[{TRIGGER}]: expected {COMMAND!r}, got {command!r}")
    if not command.startswith("appointments."):
        fail(
            f"events.listen[{TRIGGER}] points outside this module — "
            "`installer::validate_event_listeners` refuses the whole install (hub#659)"
        )

    if "whatsapp_inbox" in set(MANIFEST.get("depends_on") or []):
        fail(
            "depends_on: `whatsapp_inbox` must NOT be there. The event bus does not consult "
            "depends_on (it only orders installation), and a hard dependency would stop a salon "
            "from having a diary without buying a WhatsApp inbox"
        )


def check_command() -> None:
    cmd = (MANIFEST.get("commands") or {}).get(COMMAND)
    if not isinstance(cmd, dict):
        fail(f"{COMMAND}: not declared")
        return
    handler = cmd.get("handler")
    if not isinstance(handler, dict) or handler.get("function") != HANDLER:
        fail(f"{COMMAND}: must run the WASM handler {HANDLER!r} (got {handler!r})")
    if cmd.get("internal") is not True:
        fail(
            f"{COMMAND}: must be `internal` — it is the relay's door, not a public command "
            "anybody can call to book an appointment against an arbitrary request id"
        )
    if not cmd.get("schema"):
        fail(f"{COMMAND}: declares no schema; the event payload would go in unchecked")
    else:
        schema = json.loads((MODULE_DIR / cmd["schema"]).read_text())
        if schema.get("additionalProperties") is False:
            fail(
                f"{cmd['schema']}: `additionalProperties: false` refuses the system params the "
                "runtime stamps on every event payload, so every approval dead-letters"
            )
        if schema.get("required") != ["request_id"]:
            fail(
                f"{cmd['schema']}: only `request_id` may be required — an approval that bound "
                "nothing is a valid event this handler has to ANSWER, not reject at the door"
            )

    depends_on = set(MANIFEST.get("depends_on") or [])
    reads = {r.get("query"): r for r in cmd.get("reads") or [] if isinstance(r, dict)}
    for query, params in LISTENER_READS.items():
        owner = query.split(".")[0]
        if owner != MANIFEST["id"] and owner not in depends_on:
            fail(
                f"depends_on: {owner!r} missing — the read {query!r} would be omitted (hub#610)"
            )
        read = reads.get(query)
        if read is None:
            fail(
                f"{COMMAND}.reads: missing {query!r} — a booking made through this door has to "
                "resolve the same records as one made on the screen"
            )
            continue
        if read.get("required") is True:
            fail(
                f"{COMMAND}.reads[{query}]: must NOT be `required`. Inside a listener a read that "
                "aborts the command is a dead-letter row nobody reads; the handler already "
                "refuses when the read is missing, and a refusal travels back to the inbox"
            )
        for name, expr in params.items():
            if (read.get("params") or {}).get(name) != expr:
                fail(f"{COMMAND}.reads[{query}]: params.{name} must be {expr!r}")


def check_answers() -> None:
    emits = set((MANIFEST.get("events") or {}).get("emits") or [])
    for event in ANSWER_EVENTS:
        if event not in emits:
            fail(
                f"events.emits: {event!r} missing — a handler that emits an event its module does "
                "not declare makes the whole command FAIL (hub#240), so the booking would roll "
                "back and the answer would never leave"
            )


def check_i18n() -> None:
    catalogs = {}
    for lang in ("en", "es"):
        path = MODULE_DIR / "locales" / f"{lang}.json"
        if not path.exists():
            fail(f"locales/{lang}.json: missing")
            continue
        catalogs[lang] = json.loads(path.read_text()).get("errors") or {}
        for code in DOMAIN_CODES:
            value = catalogs[lang].get(code)
            if not isinstance(value, str) or not value.strip():
                fail(f"locales/{lang}.json: errors[{code!r}] is missing")
    if "en" in catalogs and "es" in catalogs:
        for code in DOMAIN_CODES:
            en, es = catalogs["en"].get(code), catalogs["es"].get(code)
            if en and es and en == es:
                fail(f"locales/es.json: errors[{code!r}] is still the English text")
            if en and not re.fullmatch(r"[\x20-\x7e]+", en):
                fail(
                    f"locales/en.json: errors[{code!r}] carries non-ASCII text — English is the source"
                )


def check_slot() -> None:
    slots = {s.get("slot"): s for s in MANIFEST.get("provides_slots") or []}
    slot = slots.get(BOOKING_SLOT)
    if slot is None:
        fail(
            f"provides_slots: {BOOKING_SLOT!r} missing. Without it nobody can bind a request to a "
            "customer, a service, a professional and a free slot — and an unbound approval can "
            "only ever be answered `request_not_bound`, which makes the listener useless"
        )
        return
    if slot.get("component") != BOOKING_COMPONENT:
        fail(f"provides_slots[{BOOKING_SLOT}]: component must be {BOOKING_COMPONENT!r}")
    if slot.get("permission") != "appointments.add_appointment":
        fail(
            f"provides_slots[{BOOKING_SLOT}]: the panel BOOKS, so it must be gated by "
            "`appointments.add_appointment`, not by a read permission"
        )
    source = (
        MODULE_DIR / "ui" / "components" / BOOKING_COMPONENT / f"{BOOKING_COMPONENT}.ts"
    )
    if not source.exists():
        fail(
            f"{source.relative_to(MODULE_DIR)}: the slot filler is declared but not written"
        )


def main() -> int:
    check_listener()
    check_command()
    check_answers()
    check_i18n()
    check_slot()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK: an approved request reaches appointments, books authoritatively, and answers back"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
