#!/usr/bin/env python3
"""Availability contract test (appointments#10) — every command that WRITES a slot applies the
same rules, and reads them instead of being told.

appointments#10 was opened because `create` decided availability with `payload.settings`: the
browser handed the hub its own `allow_overlapping`. PR #60 closed that for `create`. The residue
this file pins is the other three:

- `bulk_create` and `recurring.materialize` had the same hole `create` had — they booked with no
  blocked-agenda and no lead-time check at all;
- `reschedule` was the last Tier 0 command of the family: the browser sent `start_datetime`,
  `end_datetime` AND `duration_minutes`, and the only server-side guards were the status `WHERE`
  and the overlap gate.

What fails SILENTLY here is the wiring, so that is what this file checks (hub#610: a read whose
owner is not in `depends_on` is dropped without error; a read that is not `required` degrades
instead of refusing — a guard whose input can go missing is a guard that OPENS):

  1. Every writing command declares the booking policy read (`appointments.settings.get`) as
     `required`, and NO payload of theirs accepts a `settings` object any more.
  2. Every writing command declares a blocked-times read as `required` — the by-day one when it
     books a single slot, the day-independent one when it spans several.
  3. `reschedule` runs the WASM handler, reads its own appointment row, and its schema no longer
     accepts `end_datetime` (the end is arithmetic the handler does).
  4. `reschedule` still emits its two SERVER-SIDE gates, in order, around the UPDATE: the race
     between «the handler read the state» and «the row moves» only closes there.
  5. Every domain code these rules answer with is translated (ADR-0055).

  6. Every writing command declares the hub's opening hours as a `required` read, so
     `outside_schedule` is enforced at the DOOR and not merely reported by the screen
     (appointments#89). This one used to be the section's famous absence: business hours are WALL
     CLOCK, an appointment is an instant, and crossing them needs the business timezone, which a
     module could not read. `context.timezone` (hub#1022) landed, so the rule moved from
     `queries/availability_check.sql` — advisory — into the handler.

What is NOT here, and is not an oversight: the PROFESSIONAL's own working hours. The business is
open, but whether that particular person works that hour is a second rule, and its read
(`staff.availability.for_member`) needs `:staff_id` plus a `:date_from`/`:date_to` range that
`reads.params` cannot express — it binds literal `payload.<field>` values only, and `reschedule`
does not even carry a `staff_id`. Tracked in appointments#98; it is blocked on the runtime, not
forgotten.

Usage: tests/availability_rules.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

POLICY_READ = "appointments.settings.get"
BY_DAY_BLOCKS = "appointments.blocked_times.overlapping"
UPCOMING_BLOCKS = "appointments.blocked_times.upcoming"

# command -> the blocked-times read it is expected to declare.
WRITERS = {
    "appointments.appointments.create": BY_DAY_BLOCKS,
    "appointments.appointments.bulk_create": UPCOMING_BLOCKS,
    "appointments.recurring.materialize": UPCOMING_BLOCKS,
    "appointments.appointments.reschedule": UPCOMING_BLOCKS,
}

RESCHEDULE = "appointments.appointments.reschedule"
RESCHEDULE_CHAIN = [
    "appointments._reschedule_state_assert",
    "appointments._reschedule_row",
    "appointments._appointment_overlap_assert",
    "appointments._history_reschedule",
]

DOMAIN_CODES = (
    "appointments.too_soon",
    "appointments.too_far",
    "appointments.blocked",
    "appointments.settings_unavailable",
    "appointments.availability_unavailable",
    "appointments.cannot_reschedule",
    # appointments#89 — the opening-hours door.
    "appointments.outside_schedule",
    # appointments#79 — used to escape as a raw WASM error instead of a code.
    "appointments.invalid_start",
)

# appointments#89: the four commands that put an appointment on the books. The opening-hours read
# is the WIRE of that door — without it the handler has nothing to check against, so it is pinned
# here as well as in the Rust tests. `required` matters as much as its presence: a read that may
# quietly fail to resolve is a guard that opens.
BOOKING_COMMANDS = (
    "appointments.appointments.create",
    "appointments.appointments.reschedule",
    "appointments.appointments.bulk_create",
    "appointments.recurring.materialize",
)
# PR#99 regression: `_book_from_request` (the `whatsapp_inbox.request.approved` listener) books
# through `create_appointment_pure`, so it walks the SAME opening-hours gate — but the runtime
# resolves the reads THIS command declares, not `create`'s. Without the read the gate fails
# CLOSED and every approval answers `availability_unavailable`: the WhatsApp→appointment flow
# dies. It is listed apart because its `required` semantics differ on purpose: all its reads are
# graceful (no `required: true`) so a failed resolution becomes a `booking_refused` ANSWER the
# inbox can show, instead of a runtime abort that retries into the dead-letter and answers nobody.
LISTENER_BOOKING_COMMANDS = ("appointments._book_from_request",)
OPENING_HOURS_READ = "appointments.schedules.active_timeslots"
# appointments#102 — the AUTHORITY. `appointments` owns the appointment and the agenda block; the
# business opening hours belong to `schedules`, which ADR-0392 made the single answer of the
# product to «are we open?». The gate resolves its precedence — exact special day > yearly special
# day > override range > weekly hours — over the booking's own date, so all four lists have to be
# there. They declare a `list` block and that is fine: `preload_reads` goes through
# `queries::execute`, which returns the WHOLE set, paginating internally (hub#650).
SCHEDULES_READS = (
    "schedules.business_hours.list",
    "schedules.special_days.list",
    "schedules.overrides.list",
    "schedules.exception_intervals.list",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def reads_of(command: str) -> dict:
    cmd = MANIFEST.get("commands", {}).get(command)
    if not isinstance(cmd, dict):
        fail(f"{command}: not declared")
        return {}
    return {r.get("query"): r for r in cmd.get("reads", []) if isinstance(r, dict)}


def check_writers() -> None:
    for command, blocks_read in WRITERS.items():
        reads = reads_of(command)
        if not reads:
            continue

        policy = reads.get(POLICY_READ)
        if policy is None or policy.get("required") is not True:
            fail(
                f"{command}.reads: {POLICY_READ!r} must be declared and `required` — otherwise the "
                "caller gets to hand us allow_overlapping again"
            )

        blocked = reads.get(blocks_read)
        if blocked is None:
            fail(
                f"{command}.reads: missing {blocks_read!r} — the blocked guard would never run"
            )
        elif blocked.get("required") is not True:
            fail(
                f"{command}.reads[{blocks_read}]: must be `required` — a guard whose input can go "
                "missing is a guard that opens"
            )

        # The other half of «read, never told»: the payload cannot carry the policy.
        schema_rel = MANIFEST["commands"][command].get("schema")
        if schema_rel:
            schema = json.loads((MODULE_DIR / schema_rel).read_text())
            if "settings" in (schema.get("properties") or {}):
                fail(f"{schema_rel}: still accepts a `settings` object from the caller")


def check_reschedule() -> None:
    cmd = MANIFEST.get("commands", {}).get(RESCHEDULE)
    if not isinstance(cmd, dict):
        fail(f"{RESCHEDULE}: not declared")
        return

    handler = cmd.get("handler")
    if (
        not isinstance(handler, dict)
        or handler.get("function") != "reschedule_appointment"
    ):
        fail(
            f"{RESCHEDULE}: must run the WASM handler `reschedule_appointment` (got {handler!r})"
        )
    if "sql" in cmd:
        fail(
            f"{RESCHEDULE}: must not keep a declarative sql[] — its statements are the handler's"
        )

    own_row = reads_of(RESCHEDULE).get("appointments.appointments.get")
    if own_row is None or own_row.get("required") is not True:
        fail(
            f"{RESCHEDULE}.reads: `appointments.appointments.get` must be declared and `required` "
            "— the state, the professional and the current duration come from the row"
        )
    elif (own_row.get("params") or {}).get(
        "appointment_id"
    ) != "payload.appointment_id":
        fail(
            f"{RESCHEDULE}.reads[appointments.appointments.get]: must bind payload.appointment_id"
        )

    schema = json.loads((MODULE_DIR / cmd["schema"]).read_text())
    props = schema.get("properties") or {}
    if "end_datetime" in props:
        fail(
            f"{cmd['schema']}: still accepts `end_datetime` — the end is start + duration and the "
            "handler computes it; a second opinion could disagree with the duration"
        )
    if schema.get("additionalProperties") is not False:
        fail(f"{cmd['schema']}: must be additionalProperties:false")

    # The gates stay server-side, in order, around the UPDATE.
    for op in RESCHEDULE_CHAIN:
        if not isinstance(MANIFEST.get("commands", {}).get(op), dict):
            fail(
                f"{op}: the handler emits it as an intention but it is not a declared command"
            )
    files = [
        (MANIFEST.get("commands", {}).get(op) or {}).get("sql", [None])[0]
        for op in RESCHEDULE_CHAIN
    ]
    if files != [
        "commands/_reschedule_state_assert.sql",
        "commands/appointment_reschedule.sql",
        "commands/_appointment_overlap_assert.sql",
        "commands/_history_reschedule.sql",
    ]:
        fail(
            f"{RESCHEDULE}: the intention chain runs {files!r}, not the state gate → UPDATE → "
            "overlap gate → history order the race needs"
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


def check_opening_hours_read() -> None:
    """appointments#89 — the door needs its hinge: the opening-hours read, declared and required."""
    query = MANIFEST.get("queries", {}).get(OPENING_HOURS_READ)
    if not isinstance(query, dict):
        fail(
            f"queries.{OPENING_HOURS_READ}: not declared — the handler has nothing to read"
        )
    elif not (MODULE_DIR / str(query.get("sql"))).exists():
        fail(
            f"queries.{OPENING_HOURS_READ}.sql: {query.get('sql')!r} is not in the package"
        )
    elif "list" in query:
        fail(
            f"queries.{OPENING_HOURS_READ}: is a paginated `list`; a handler read gets plain rows"
        )
    for command in BOOKING_COMMANDS:
        read = reads_of(command).get(OPENING_HOURS_READ)
        if read is None:
            fail(
                f"{command}: declares no read of {OPENING_HOURS_READ!r} — it can book outside the "
                "business opening hours, which is the whole of appointments#89"
            )
        elif read.get("required") is not True:
            fail(
                f"{command}: the {OPENING_HOURS_READ!r} read is not `required: true` — a read that "
                "may fail to resolve leaves the opening-hours gate open"
            )
    for command in LISTENER_BOOKING_COMMANDS:
        read = reads_of(command).get(OPENING_HOURS_READ)
        if read is None:
            fail(
                f"{command}: declares no read of {OPENING_HOURS_READ!r} — it books through "
                "`create_appointment_pure`, whose gate fails CLOSED, so every approval is refused "
                "with `availability_unavailable` and the WhatsApp→appointment flow is dead"
            )
        elif read.get("required") is True:
            fail(
                f"{command}: the {OPENING_HOURS_READ!r} read must stay GRACEFUL (no `required: "
                "true`), like every read of this listener — a runtime abort retries into the "
                "dead-letter and the inbox never gets its answer; the handler already fails closed"
            )


def check_schedules_authority() -> None:
    """appointments#102 — the opening hours belong to `schedules`, so the door has to READ it.

    The handler tests inject the four lists straight into `context.reads`, so they stay green even
    if the manifest stops declaring them — and then the gate fails closed in production with the
    CI in green. That is literally appointments#100. This is the guard that cannot be fooled that
    way: the wiring is asserted where the runtime reads it.

    `schedules` must also be a HARD dependency: `preload_reads` only serves a `required` read whose
    owner is in `depends_on` (`commands.rs::read_in_scope`) — otherwise it warns to stderr and
    OMITS it, and an omitted read of a fail-closed gate refuses every booking.
    """
    deps = {
        d["id"] if isinstance(d, dict) else d for d in MANIFEST.get("depends_on") or []
    }
    if "schedules" not in deps:
        fail(
            "depends_on: `schedules` missing — a `required` read of a module outside depends_on is "
            "omitted (hub#610), and the opening-hours gate would refuse every booking"
        )
    floor = next(
        (
            d.get("min_version")
            for d in MANIFEST.get("depends_on") or []
            if isinstance(d, dict) and d.get("id") == "schedules"
        ),
        None,
    )
    if not floor:
        fail(
            "depends_on[schedules]: no `min_version` — `schedules.exception_intervals.list` was "
            "born in 2.0.17 (schedules#23); against an older one the read fails and every booking "
            "aborts instead of the install refusing (hub#681)"
        )

    for command in BOOKING_COMMANDS:
        reads = reads_of(command)
        for query in SCHEDULES_READS:
            read = reads.get(query)
            if read is None:
                fail(
                    f"{command}: declares no read of {query!r} — the hub's real opening hours, its "
                    "bank holidays and its overrides would all be invisible to the gate"
                )
            elif read.get("required") is not True:
                fail(
                    f"{command}: the {query!r} read is not `required: true` — a read that may fail "
                    "to resolve leaves the opening-hours gate deciding on a catalogue it cannot "
                    "tell apart from an empty one"
                )
    for command in LISTENER_BOOKING_COMMANDS:
        reads = reads_of(command)
        for query in SCHEDULES_READS:
            read = reads.get(query)
            if read is None:
                fail(
                    f"{command}: declares no read of {query!r} — it books through the same gate, "
                    "and the runtime resolves the reads THIS command declares (appointments#100)"
                )
            elif read.get("required") is True:
                fail(
                    f"{command}: the {query!r} read must stay GRACEFUL, like every read of this "
                    "listener — an abort retries into the dead-letter and answers nobody"
                )


def main() -> int:
    check_writers()
    check_reschedule()
    check_opening_hours_read()
    check_schedules_authority()
    check_i18n()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: every command that writes a slot reads its availability rules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
