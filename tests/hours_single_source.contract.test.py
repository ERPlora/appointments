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

AND WHAT WE TELL THE ASSISTANT HAS TO MATCH (appointments#118, second round). Retiring a verdict
from the SQL is only half of it: the assistant builds its tools from the manifest (ADR-0033), so an
`ai.description` that still lists `outside_schedule` teaches it that this engine knows about the
opening hours when the `CASE` can no longer return that word. That is the same false belief
appointments#122 documents, planted by us. The two checks at the bottom close it, and both read
their truth from somewhere other than the prose they judge:

  * the reasons a query CAN return are parsed out of its own `CASE ... END AS reason`;
  * the vocabulary of reason words is the union of those plus the `appointments.<code>` refusals the
    handler emits — so `outside_schedule` is a KNOWN word (the door really does refuse with it),
    which is what makes «the engine offers it» detectable instead of merely absent;
  * naming the authority bare («crossing schedules») is a claim to cross it, and is only allowed to
    an operation that actually reads it. An operation that just points elsewhere names the exact
    operation (`schedules.business_hours.list`), which is what the assistant can act on anyway.

AND IT HAS TO MATCH FOR BOTH QUERIES, NOT ONE (appointments#124). Those two checks closed the door
the bug came through and left the one next to it open. The first only looked at a query that
answers with a reason, and only `availability_check.sql` carries a `CASE ... END AS reason`, so the
sister query — the one that lists the free slots of a day — could be told again that it answers
`outside_schedule` and stay green. The second only fired on the word `schedules`, so the same lie
written as «crossing the business opening hours» went straight past it.

Both are closed here, and neither by adding words to a blacklist:

  * every query is judged, with «returns no reason at all» as the empty answer of one that has no
    `reason` column. A word only counts when it is written as a CODE — snake_case anywhere, or a
    one-word code in backticks — because `blocked`, `overlap` and `held` are also English, and
    judging those by the bare word turns four honest descriptions of this manifest red;
  * and the paraphrase is answered with a DUTY instead of a blacklist: an `appointments.availability.*`
    operation that does not read the authority has to name `appointments.availability.day_opening`
    in its description. Rewriting the description into a claim of knowing the hours takes the
    pointer out with it, whatever words the claim is made of — and a pointer is what the assistant
    can act on anyway. Watching for English synonyms of «opening hours» is the option NOT taken:
    that list rots on its own and goes quiet when it does (appointments#125).

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

# The door's own refusals, read from the Rust that emits them. `outside_schedule` lives here and
# NOT in the availability engine any more: that asymmetry is the whole point of the two checks at
# the bottom, so the vocabulary has to come from the handler and not from a list typed here.
HANDLER = MODULE_DIR / "handler" / "src" / "lib.rs"

# The authority that owns the opening hours (ADR-0392, appointments#102).
AUTHORITY = "schedules"

# The doc page that explains the refusals to a human. Only the table of the section below is this
# battery's business — the prose under it talks about the DOOR, which does still refuse on hours.
CONCEPTS = "docs/concepts.md"
REASONS_SECTION = "Availability has reasons"

# The engine whose `CASE` the doc table describes.
AVAILABILITY_CHECK = "appointments.availability.check"

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


REASON_CASE = re.compile(r"CASE(.*?)END\s+AS\s+reason", re.IGNORECASE | re.DOTALL)
REASON_LITERAL = re.compile(r"THEN\s+'([a-z_][a-z0-9_]*)'", re.IGNORECASE)
# `[a-z_]` on purpose, so the internal `appointments._insert_appointment` commands DO match and the
# filter in `handler_refusals` is the thing that drops them. A regex that never saw them would make
# that filter — and the self-check that proves it works — vacuous.
HANDLER_REFUSAL = re.compile(r'"appointments\.([a-z_][a-z0-9_]*)"')
# A referral names the operation the caller should ask instead: `schedules.business_hours.list`.
QUALIFIED_AUTHORITY = re.compile(r"\bschedules\.[a-z_]+\.[a-z_]+")

# Every operation of this module that answers «can this be booked» (appointments#124).
AVAILABILITY = "appointments.availability."
# The only one of them that really knows the opening hours: it reads the authority and hands the
# answer over. Whoever cannot do that has to point the assistant here by name.
DAY_OPENING = "appointments.availability.day_opening"


def emitted_reasons(sql: str) -> set[str]:
    """The words a statement's `CASE ... END AS reason` can actually produce. Comments are already
    stripped by `sql_of`, so a reason quoted in prose does not count as emitted."""
    out: set[str] = set()
    for body in REASON_CASE.findall(sql):
        out |= {r.lower() for r in REASON_LITERAL.findall(body)}
    return out


def handler_refusals() -> set[str]:
    """The `appointments.<code>` refusals the door emits, straight from the Rust. Internal commands
    (`appointments._insert_appointment`) are plumbing, not refusals, so they are dropped."""
    if not HANDLER.is_file():
        return set()
    return {c for c in HANDLER_REFUSAL.findall(HANDLER.read_text()) if not c.startswith("_")}


def describes(spec: dict) -> str:
    return ((spec.get("ai") or {}).get("description") or "")


def promised_as_a_code(word: str, description: str) -> bool:
    """Is `word` offered to the assistant as a REASON CODE, or is it just English?

    A code carrying an underscore (`outside_schedule`, `too_soon`, `slot_on_hold`) is not something
    anybody writes by accident: any occurrence of it is a promise. A one-word code is a different
    animal — `blocked`, `overlap` and `held` are ordinary English, and `blocked_times.list` saying
    it «lists blocked time periods» describes what it does, it does not claim to answer `blocked`.
    Judging those by the bare word turns four honest descriptions red (measured on this manifest,
    appointments#124), which is how a guard gets its assertions loosened until it holds nothing.
    So a one-word code only counts when it is written AS code, in backticks.
    """
    if "_" in word:
        return re.search(rf"\b{re.escape(word)}\b", description) is not None
    return f"`{word}`" in description


def reads_the_authority(name: str, spec: dict) -> bool:
    """Reaches `schedules` for real: either its SQL selects from a `schedules_*` table, or it
    declares a `reads` on one of the authority's operations (how a handler gets them)."""
    if any(t.startswith(f"{AUTHORITY}_") for t in tables_read(sql_of(spec))):
        return True
    return any(
        str(r.get("query", "")).startswith(f"{AUTHORITY}.") for r in (spec.get("reads") or [])
    )


def doc_table_reasons() -> tuple[set[str], str]:
    """The reasons listed in the TABLE of the «Availability has reasons» section, and the prose that
    follows it. Only rows of the markdown table count: the paragraph below is about the door."""
    path = MODULE_DIR / CONCEPTS
    if not path.is_file():
        return set(), ""
    lines = path.read_text().splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.startswith("#") and REASONS_SECTION in ln), None)
    if start is None:
        return set(), ""
    end = next(
        (i for i, ln in enumerate(lines[start + 1 :], start + 1) if ln.startswith("#")), len(lines)
    )
    section = lines[start + 1 : end]
    reasons = set()
    prose = []
    for ln in section:
        if ln.lstrip().startswith("|"):
            cells = [c.strip() for c in ln.strip().strip("|").split("|")]
            if cells and cells[0].startswith("`") and cells[0].endswith("`"):
                reasons.add(cells[0].strip("`").lower())
        else:
            prose.append(ln)
    return reasons, "\n".join(prose)


def check_the_reason_readers_find_the_positive() -> None:
    """Both new checks below are «X must not appear»: if the parsers returned nothing the greens
    would be free. Prove each one sees a planted positive before trusting an absence."""
    probe = strip_comments(
        "SELECT CASE WHEN a = 1 THEN \'too_soon\' WHEN b = 1 THEN \'held\' ELSE \'\' END AS reason"
    )
    if emitted_reasons(probe) != {"too_soon", "held"}:
        fail(
            "the reason parser does not read a plain `CASE ... END AS reason`: it would report an "
            f"empty set for every query and pass on anything ({emitted_reasons(probe)!r})"
        )
    if emitted_reasons("SELECT 1 FROM t"):
        fail("the reason parser invents reasons for a statement that has no `reason` column")

    refusals = handler_refusals()
    if "outside_schedule" not in refusals:
        fail(
            "the handler scan does not find `appointments.outside_schedule`: the vocabulary would "
            "not contain the very word this check exists to catch, so it could never fire"
        )
    if any(c.startswith("_") for c in refusals):
        fail("the handler scan counts internal commands as refusals: it would fire on plumbing")

    engine = MANIFEST.get("queries", {}).get(AVAILABILITY_CHECK, {})
    if not emitted_reasons(sql_of(engine)):
        fail(
            f"`{AVAILABILITY_CHECK}` reads as emitting no reason at all: the scan is not reaching "
            "the real SQL, and both checks below are then judging prose against an empty set"
        )

    table, prose = doc_table_reasons()
    if not table:
        fail(
            f"no reason row found in the «{REASONS_SECTION}» table of {CONCEPTS}: the doc check "
            "passes on an empty set"
        )
    # The positive is placed AFTER the filtered region on purpose: the paragraph under the table
    # says the door refuses on `outside_schedule`, and that is TRUE. A parser that swallowed the
    # prose would drag that word into the table set and fail the honest doc.
    if "outside_schedule" not in prose:
        fail(
            f"the «{REASONS_SECTION}» prose no longer mentions `outside_schedule`: the door still "
            "refuses with it, and this check has lost the control that proves the table parser "
            "stops at the table"
        )
    if "outside_schedule" in table:
        fail(
            f"{CONCEPTS} lists `outside_schedule` as an answer of the availability engine: the "
            f"`CASE` of `{AVAILABILITY_CHECK}` cannot return it since appointments#118. The door "
            "refuses with it — which the paragraph under the table already says — but whoever "
            "reads the table plans a screen around a reason the engine never sends"
        )

    # appointments#124 — the reason check now judges the queries with NO `reason` column, so the
    # word reader decides everything and the extension has to have something to reach.
    if not promised_as_a_code("outside_schedule", "closed hours come back as outside_schedule"):
        fail(
            "the code reader does not see a snake_case code written in plain prose: the check "
            "would pass on the very description appointments#118 had to fix"
        )
    if promised_as_a_code("blocked", "lists blocked time periods (holidays, vacations)"):
        fail(
            "the code reader reads the English word «blocked» as the code `blocked`: it would "
            "turn the honest description of `blocked_times.list` red and get itself loosened"
        )
    if not promised_as_a_code("blocked", "answers `blocked` when the slot is taken"):
        fail(
            "the code reader does not see a one-word code written in backticks: a query with no "
            "`reason` column could promise `blocked` and `held` with nothing to stop it"
        )
    if not [n for n, spec in MANIFEST.get("queries", {}).items() if not emitted_reasons(sql_of(spec))]:
        fail(
            "every query of the manifest emits a reason: judging the ones that do not is then a "
            "no-op, and the hole appointments#124 closed would reopen unnoticed"
        )

    # …and the pointer check has to be judging real operations on both sides of its exemption.
    availability = {
        n: spec
        for block in ("queries", "commands")
        for n, spec in MANIFEST.get(block, {}).items()
        if n.startswith(AVAILABILITY)
    }
    if not [n for n, spec in availability.items() if not reads_the_authority(n, spec)]:
        fail(
            f"no `{AVAILABILITY}*` operation is judged by the pointer check: every one of them "
            "reads the authority, so the check passes without looking at a single description"
        )
    if not [n for n, spec in availability.items() if reads_the_authority(n, spec)]:
        fail(
            f"no `{AVAILABILITY}*` operation reads the authority: the exemption of the pointer "
            f"check is never taken, so it has never been shown to spare `{DAY_OPENING}`"
        )


def check_the_assistant_is_not_promised_a_reason_the_query_cannot_return() -> None:
    """appointments#118 — the assistant builds its tools from the manifest (ADR-0033). A reason word
    in an `ai.description` that the statement's own `CASE` cannot produce is a false belief we
    planted: it is exactly what appointments#122 describes, only sourced from us.

    EVERY query is judged, not only the ones that answer with a reason (appointments#124). The
    first version skipped a query with no `CASE ... END AS reason` on the grounds that it makes no
    promise of this shape — but that is backwards: a query that cannot return ANY reason is the one
    with the most to promise falsely, and it was the hole the bug walked back through. Only
    `availability_check.sql` carries a `CASE`, so «all the queries with a reason column» meant ONE:
    the sister query could be told again that it answers `outside_schedule` and stay green. A query
    with no reason column now carries the empty list as its answer, and every code in the
    vocabulary is forbidden to it.
    """
    vocabulary = handler_refusals()
    for spec in MANIFEST.get("queries", {}).values():
        vocabulary |= emitted_reasons(sql_of(spec))
    for name, spec in sorted(MANIFEST.get("queries", {}).items()):
        can_return = emitted_reasons(sql_of(spec))
        description = describes(spec)
        for word in sorted(vocabulary - can_return):
            if not promised_as_a_code(word, description):
                continue
            answers = (
                f"its `CASE ... END AS reason` can only return {sorted(can_return)}"
                if can_return
                else "it has no `reason` column at all, so it can return none"
            )
            fail(
                f"`{name}` tells the assistant it answers `{word}`, but {answers}. The tool "
                "description is the contract the assistant plans with, so it will ask this query "
                "about something it cannot see and read the empty answer as «fine»"
            )


def check_every_availability_answer_points_at_the_authority() -> None:
    """appointments#124 — the half that a paraphrase used to walk around.

    Forbidding the claim «we cross `schedules`» only holds while the claim is spelled the way the
    check spells it. «crossing the business opening hours» is the same lie in words the check never
    had, and it stayed green; going after the synonyms means maintaining a blacklist of English,
    which rots on its own and fails silently when it does.

    The duty does not rot. An availability answer that does not read the authority has to hand the
    assistant the operation that does, by name. A paraphrase is then no longer a hole: whoever
    rewrites the description into a claim of knowing the hours takes the pointer out with it — and
    if they leave it in, the assistant still has the operation to ask, which is the thing it can
    actually act on.
    """
    for block in ("queries", "commands"):
        for name, spec in sorted(MANIFEST.get(block, {}).items()):
            if not name.startswith(AVAILABILITY):
                continue
            if reads_the_authority(name, spec):
                continue
            if DAY_OPENING in describes(spec):
                continue
            fail(
                f"`{name}` answers about availability without reading the opening hours and "
                f"without telling the assistant to ask `{DAY_OPENING}`. Since appointments#118 "
                "nothing of this module's SQL knows when the business is open, so an answer of "
                "this family either reads the authority or points at the operation that does — "
                "otherwise the assistant reads «free» as «open» and offers an hour with the "
                "shutters down"
            )


def check_the_assistant_is_not_told_we_cross_the_hours_authority() -> None:
    """Naming `schedules` bare is a claim to take it into account, and only an operation that
    actually reaches it may make that claim. Pointing elsewhere is fine and useful — but then it
    names the operation to ask (`schedules.business_hours.list`), which is what the assistant can
    act on. Anything vaguer teaches it that this module crosses hours it never reads."""
    for block in ("queries", "commands"):
        for name, spec in sorted(MANIFEST.get(block, {}).items()):
            description = describes(spec)
            if not re.search(rf"\b{AUTHORITY}\b", description, re.IGNORECASE):
                continue
            if reads_the_authority(name, spec):
                continue
            if QUALIFIED_AUTHORITY.search(description):
                continue
            fail(
                f"`{name}` tells the assistant it takes `{AUTHORITY}` into account, but it neither "
                f"reads a `{AUTHORITY}_*` table nor declares a `reads` on the authority. Say which "
                f"operation to ask instead (`{AUTHORITY}.business_hours.list`) or stop naming it: "
                "since appointments#118 nothing of this module's SQL knows the opening hours"
            )


def main() -> int:
    check_the_scanner_finds_the_positive()
    check_no_published_operation_writes_the_hours()
    check_nobody_reads_the_hours()
    check_the_contract_migration_retires_the_tables()
    check_the_retired_operations_are_gone()
    check_setup_does_not_ask_for_our_hours()
    check_the_docs_do_not_offer_them()
    check_the_reason_readers_find_the_positive()
    check_the_assistant_is_not_promised_a_reason_the_query_cannot_return()
    check_the_assistant_is_not_told_we_cross_the_hours_authority()
    check_every_availability_answer_points_at_the_authority()
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
