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

NOTHING STAYS ANY MORE (appointments#118). Until this issue the two availability queries and
`appointments.schedules.active_timeslots` still READ those tables: the transitional fallback the
handler used while `schedules` carried no rule reaching the date, kept for the salon configured
before appointments#102. Both conditions that made it necessary are gone — appointments#117
retired every write, and schedules#36 seeds the whole week on install — so the fallback had become
a refusal the salon could not explain with anything it can see configured. The reads went with it
and migration 009 retires the tables themselves, which is why the allowlist below is EMPTY: no
statement of this module may name them at all.

That is what turns this battery from «only one place WRITES the hours» into «only one place HAS
them». A query that reads `appointments_schedule*` now cannot even run, so bringing one back means
bringing the tables back, and the migration check below is what makes that visible in the diff.

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

# Nobody may read them either, since appointments#118: the transitional fallback is gone and the
# tables with it. An empty allowlist is the point — it is not a placeholder waiting to be filled.
READ_ALLOWLIST: set[str] = set()

# The migration that retires the tables. `contract` is what makes the runtime translate the
# `DROP TABLE` into `ALTER TABLE ... RENAME TO _deprecated_...` instead of destroying the rows.
RETIRING_MIGRATION = "migrations/postgres/009_drop_own_timetable.sql"

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


def check_nobody_reads_the_hours() -> None:
    """appointments#118 — not «only the fallback reads them» any more: NOBODY does."""
    for name, spec in sorted(MANIFEST.get("queries", {}).items()):
        if name in READ_ALLOWLIST:
            continue
        read = tables_read(sql_of(spec))
        for table in HOURS_TABLES:
            if table in read:
                fail(
                    f"`{name}` reads `{table}`: since appointments#118 the table is retired by "
                    "migration 009, so this query answers on a renamed table or aborts. The "
                    "opening hours are read from `schedules.business_hours.list`"
                )


def check_the_contract_migration_retires_the_tables() -> None:
    """The reads going is half the fix; the tables have to go too, or the next writer re-creates
    the surface by simply naming a table that is still there. `contract` is what keeps the rows:
    the runtime turns a `DROP TABLE` of a contract migration into a `RENAME TO _deprecated_...`.
    """
    entries = MANIFEST.get("migrations", {}).get("postgres") or []
    entry = next(
        (
            e
            for e in entries
            if isinstance(e, dict) and e.get("file") == RETIRING_MIGRATION
        ),
        None,
    )
    if entry is None:
        fail(
            f"`{RETIRING_MIGRATION}` is not declared in migrations.postgres: the two hours tables "
            "stay in every hub's database, ready for the next query to name them again"
        )
        return
    if entry.get("kind") != "contract":
        fail(
            f"`{RETIRING_MIGRATION}` is not `kind: contract` ({entry.get('kind')!r}): the guard "
            "would take the DROP literally and destroy the rows instead of renaming them aside"
        )
    sql = strip_comments((MODULE_DIR / RETIRING_MIGRATION).read_text())
    dropped = {
        t.lower()
        for t in re.findall(
            r"\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)", sql, re.IGNORECASE
        )
    }
    for table in HOURS_TABLES:
        if table not in dropped:
            fail(
                f"`{RETIRING_MIGRATION}` does not drop `{table}`: it survives in the database and "
                "the single-source-of-truth is only true in the manifest"
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
    check_nobody_reads_the_hours()
    check_the_contract_migration_retires_the_tables()
    check_the_retired_operations_are_gone()
    check_setup_does_not_ask_for_our_hours()
    check_the_docs_do_not_offer_them()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print(
        "OK: the opening hours live in `schedules` and nowhere else — this module neither "
        "writes, reads nor keeps them"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
