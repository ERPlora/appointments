#!/usr/bin/env python3
"""The opening hours are configured in ONE place, and that place is `schedules` (appointments#117).

WHAT WENT WRONG. Since appointments#102 the booking door reads the hours, bank holidays and
overrides of the `schedules` module — the authority the rest of the product asks whether the
business is open (ADR-0392). But this module kept publishing its own timetable as WRITEABLE API:
`appointments.schedules.create/.delete`, `appointments.timeslots.create/.delete`, their two listing
queries, an `ai` block on each one (so the assistant offers them next to
`schedules.business_hours.set`) and a setup-checklist step, «Your working hours», measured on OUR
tables. Whoever set the business up had no way of telling which one wins: change the hours in one,
the other keeps saying something else, and which answer reaches the customer depends on whether
`schedules` happens to carry a rule for that date.

WHY A TEST AND NOT JUST THE DELETION. Deleting them fixes today. This stops a second timetable
coming back under another name, which is the shape the bug would take next: nothing about
`appointments_schedule` stops a future command from writing to it again, and the reintroduction
would look like a feature, not like a regression.

THE INVARIANT IS ABOUT THE SQL, NOT ABOUT NAMES. The battery reads every statement the manifest
publishes and asks what it does to the two hours tables — so a `appointments.opening_hours.set`
that writes the very same rows fails just the same. The names of the six retired operations are
checked too, but as the cheap half; the SQL scan is the one that holds.

WHAT DELIBERATELY STAYS. `appointments.schedules.active_timeslots` and the two availability
queries still READ those tables: that is the transitional fallback the handler
(`legacy_timeslot_refusal`) uses while `schedules` carries no rule reaching the date, and it is
what keeps a salon configured before appointments#102 working. Reading is not a second place to
configure — nobody can write there any more. Its removal, with the tables themselves, is
appointments#118.

BUT THE FALLBACK IS NOT A TOOL. A `reads` source of the handler is not something the assistant
should be handed: offered as «the business's opening hours», it answers from a table nothing can
write any more — empty on every hub set up after #117 — so the assistant would tell the owner the
salon has no hours while `schedules` holds them. The one tool for that question is
`schedules.business_hours.list`; the availability engine (`availability.slots`/`.check`) keeps its
`ai` block because it answers a different question (is THIS slot free?), not «when are we open?».

Usage: tests/hours_single_source.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# The module's OWN copy of the timetable. `schedules` writes its own tables (`schedules_*`) and is
# not this battery's business.
HOURS_TABLES = ("appointments_schedule", "appointments_schedule_timeslot")

# The queries allowed to READ them: the transitional fallback, owned by appointments#118. Anything
# else reading them is a management surface that came back.
READ_ALLOWLIST = {
    "appointments.schedules.active_timeslots",
    "appointments.availability.slots",
    "appointments.availability.check",
}

# The availability ENGINE: it reads the hours tables to answer «is this slot free?», which is a
# different question from «when is the business open?», so it may stay a tool of the assistant.
# Every other allowed reader is the handler's fallback, and a fallback is not offered to anyone.
AVAILABILITY_ENGINE = {
    "appointments.availability.slots",
    "appointments.availability.check",
}

# The six operations appointments#117 retired. Cheap half of the check — kept by name so the diff
# that brings one back is readable, but the SQL scan below is what actually holds the line.
RETIRED = (
    "appointments.schedules.list",
    "appointments.schedules.timeslots",
    "appointments.schedules.create",
    "appointments.schedules.delete",
    "appointments.timeslots.create",
    "appointments.timeslots.delete",
)

WRITE = re.compile(
    r"\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)", re.IGNORECASE
)
READ = re.compile(r"\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)", re.IGNORECASE)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def strip_comments(sql: str) -> str:
    """`-- …` lines are prose: a table named in a comment is not a statement touching it."""
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def sql_of(spec: dict) -> str:
    """Every statement a command or query declares, concatenated. Missing file = empty."""
    raw = spec.get("sql")
    paths = [raw] if isinstance(raw, str) else list(raw or [])
    out = []
    for rel in paths:
        path = MODULE_DIR / rel
        out.append(strip_comments(path.read_text()) if path.is_file() else "")
    return "\n".join(out)


def tables_written(sql: str) -> set[str]:
    return {t.lower() for t in WRITE.findall(sql)}


def tables_read(sql: str) -> set[str]:
    return {t.lower() for t in READ.findall(sql)}


def check_the_scanner_finds_the_positive() -> None:
    """A scanner that reports nothing because it parses nothing is a green that proves nothing."""
    probe = strip_comments(
        "-- INSERT INTO appointments_schedule is prose here\n"
        "UPDATE appointments_schedule_timeslot SET is_deleted = 1 WHERE id = :id;\n"
        "SELECT 1 FROM appointments_schedule sc JOIN appointments_appointment a ON a.id = sc.id;"
    )
    if "appointments_schedule_timeslot" not in tables_written(probe):
        fail("the write scanner does not see an UPDATE on the hours table: it checks nothing")
    if "appointments_schedule" in tables_written(probe):
        fail("the write scanner counts a commented-out INSERT: it would fire on prose")
    if not {"appointments_schedule", "appointments_appointment"} <= tables_read(probe):
        fail("the read scanner misses a plain FROM/JOIN: it checks nothing")

    # And the real manifest has to give the scanner something to chew on, or every assertion
    # below passes on an empty set.
    booked = tables_written(sql_of(MANIFEST["commands"]["appointments._insert_appointment"]))
    if "appointments_appointment" not in booked:
        fail(
            "`_insert_appointment` does not read as writing `appointments_appointment`: the scan "
            "is not reaching this module's SQL at all"
        )


def check_no_published_operation_writes_the_hours() -> None:
    for name, spec in sorted(MANIFEST.get("commands", {}).items()):
        written = tables_written(sql_of(spec))
        for table in HOURS_TABLES:
            if table in written:
                fail(
                    f"`{name}` writes `{table}`: the opening hours are configured in `schedules` "
                    "(ADR-0392, appointments#102), so a second door that writes this module's own "
                    "timetable is the two-places bug coming back"
                )


def check_only_the_fallback_reads_the_hours() -> None:
    for name, spec in sorted(MANIFEST.get("queries", {}).items()):
        if name in READ_ALLOWLIST:
            continue
        read = tables_read(sql_of(spec))
        for table in HOURS_TABLES:
            if table in read:
                fail(
                    f"`{name}` reads `{table}` and is not the transitional fallback: listing this "
                    "module's own timetable is what made it look configurable. The hours are read "
                    "from `schedules.business_hours.list`"
                )


def check_the_fallback_is_not_offered_to_the_assistant() -> None:
    """A query that reads the hours tables and is not the engine is the handler's `reads` source:
    it carries no `ai` block, or the assistant gets a second — and now always empty — place to ask
    when the business is open."""
    for name in sorted(READ_ALLOWLIST - AVAILABILITY_ENGINE):
        spec = MANIFEST.get("queries", {}).get(name)
        if spec is None:
            continue
        if spec.get("ai"):
            fail(
                f"`{name}` is offered to the assistant (`ai` block): it is the handler's transitional "
                "fallback over a table nothing writes since appointments#117, so as a tool it answers "
                "«no opening hours» on every new hub. The assistant asks `schedules.business_hours.list`"
            )


def check_the_retired_operations_are_gone() -> None:
    for name in RETIRED:
        for block in ("queries", "commands"):
            if name in MANIFEST.get(block, {}):
                fail(f"`{name}` is still published in `{block}`: appointments#117 retired it")


def check_setup_does_not_ask_for_our_hours() -> None:
    setup = MANIFEST.get("setup")
    if not setup:
        return
    query = MANIFEST.get("queries", {}).get(setup.get("query"), {})
    read = tables_read(sql_of(query))
    for table in HOURS_TABLES:
        if table in read:
            fail(
                f"the setup step {setup.get('title')!r} is measured on `{table}`: with nothing "
                "able to write those rows it can never be ticked, and it sends the owner to this "
                "module to do what `schedules` owns"
            )


def check_the_docs_do_not_offer_them() -> None:
    for rel in ("docs/screens.md", "README.md"):
        path = MODULE_DIR / rel
        if not path.is_file():
            continue
        text = path.read_text()
        for name in RETIRED:
            if name in text:
                fail(f"{rel} still documents `{name}` as an operation of this module")


def main() -> int:
    check_the_scanner_finds_the_positive()
    check_no_published_operation_writes_the_hours()
    check_only_the_fallback_reads_the_hours()
    check_the_fallback_is_not_offered_to_the_assistant()
    check_the_retired_operations_are_gone()
    check_setup_does_not_ask_for_our_hours()
    check_the_docs_do_not_offer_them()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print("OK: the opening hours are configured in `schedules` and nowhere else")
    return 0


if __name__ == "__main__":
    sys.exit(main())
