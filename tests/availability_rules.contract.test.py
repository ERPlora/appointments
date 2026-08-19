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

What is NOT here, and is not an oversight: `outside_schedule`. Business hours
(`schedules.business_hours.list`) and the professional's shift (`staff.availability.for_member`)
are WALL CLOCK, an appointment is a UTC instant, and crossing them needs the business timezone,
which a module still cannot read — hub#1022. Guessing the offset would reject correct bookings
twice a year, at the DST change. It is blocked, not forgotten.

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


def main() -> int:
    check_writers()
    check_reschedule()
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
