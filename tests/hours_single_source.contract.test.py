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
    which is what makes «a query offers it» detectable instead of merely absent. Since
    appointments#122 the OPERATION `appointments.availability.check` does answer it, legitimately:
    it is a handler command that adds the hours to the SQL verdict. What is judged here is the SQL
    half (`appointments.availability.own_rules`), which still cannot produce that word, and the doc
    table, which has to list exactly what the operation answers — hours included;
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

# The doc page that explains the refusals to a human. Only the TABLE of the section below is this
# battery's business: it is the list a reader plans a screen around, so it has to match what
# `appointments.availability.check` can actually answer — its SQL half's `CASE` plus the opening
# hours the handler adds (appointments#122). The prose around it is not a row and is not judged.
CONCEPTS = "docs/concepts.md"
REASONS_SECTION = "Availability has reasons"

# The verdict the engine adds on top of its SQL: the opening hours, from the authority
# (appointments#122). It is the one reason of the table the `CASE` cannot produce.
HOURS_REASON = "outside_schedule"

# The engine whose `CASE` the doc table describes. It is the SQL half of
# `appointments.availability.check`, which since appointments#122 answers through the handler
# so it can add the opening hours the SQL cannot reach.
AVAILABILITY_CHECK = "appointments.availability.own_rules"

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

# The only operation that really knows the opening hours: it reads the authority and hands the
# answer over. Whoever cannot do that has to point the assistant here by name.
DAY_OPENING = "appointments.availability.day_opening"

# WHAT MAKES AN OPERATION AN AVAILABILITY ANSWER (appointments#125). Not its name. Until this issue
# the family was `name.startswith("appointments.availability.")`, so the very same answer published
# under another name owed nothing at all — measured: `appointments.booking.free_hours`, the SQL of
# `slots` word for word and no pointer, was green. A name is a label the author chooses; these two
# are what the operation DOES, and they are the manifest's own contract:
#   · it crosses the booking calendar — what is already booked AND what is blocked out. Reading one
#     of the two is ordinary (`appointments.appointments.conflicting` reads bookings,
#     `appointments.blocked_times.list` reads blocks); crossing BOTH is how «when can this be
#     booked» is computed, whatever the operation is called.
#   · it asks for the READ permission of the schedule surface. A booking action asks for
#     `add_appointment`/`change_appointment` instead: the door ENFORCES the hours and refuses, it
#     does not hand the assistant an answer about them, so its description is a different contract.
BOOKING_CALENDAR = ("appointments_appointment", "appointments_blocked_time")
ANSWER_PERMISSION = "appointments.view_schedule"

# How an `ai.description` talks about the hours the business keeps.
#
# 🔴 THIS IS NOT A BLACKLIST OF FORBIDDEN WORDINGS, and the difference is the whole design. A list
# of phrases an operation may not say is what appointments#124 refused, for a good reason: it goes
# out of date the first time somebody says it another way, and it does so in SILENCE — the missing
# phrase reads as «nothing to report». Here the vocabulary is on the other side of the assertion:
# an answer that does not read the authority MUST hit it, because saying «I do not know the opening
# hours» is the disclaimer it owes (`check_an_availability_answer_says_what_it_does_not_know`). A
# wording this regex has never seen therefore turns the guard RED and names the operation, instead
# of letting the claim through unseen. Failing loud is what a list of English can be trusted to do.
HOURS_TALK = re.compile(
    r"\b(?:open|opening|business|working|trading|closing)\s+(?:hours|times)\b"
    r"|\bhours?\s+the\s+business\b"
    r"|\bbusiness\s+is\s+(?:open|closed|shut)\b"
    r"|\bwhen\s+the\s+business\s+(?:opens|closes|is\s+open)\b",
    re.IGNORECASE,
)
# Clauses, not sentences: a claim bolted on after a semicolon or a colon is the same claim.
CLAUSE = re.compile(r"(?<=[.!?;:])\s+")
# The markers that turn a mention of the hours into the disclaimer it is allowed to be. Whitelist
# on purpose: an unknown way of negating produces a FALSE RED that names the description, never a
# quiet green — the opposite failure mode of the blacklist this replaces.
DENIAL = re.compile(
    r"\b(?:not|never|neither|nor|without|cannot|can't|don't|doesn't|isn't|aren't|ignores?|"
    r"ignoring|unaware|blind)\b",
    re.IGNORECASE,
)


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


def declared_reads(spec: dict) -> list[str]:
    """The operations a handler command takes its answer from, by name."""
    out = []
    for read in spec.get("reads") or []:
        query = str(read.get("query", "")) if isinstance(read, dict) else str(read)
        if query:
            out.append(query)
    return out


def published(name: str):
    """The spec of an operation of THIS module, wherever the manifest publishes it."""
    for block in ("queries", "commands"):
        spec = MANIFEST.get(block, {}).get(name)
        if spec is not None:
            return spec
    return None


def is_an_availability_answer(name: str, spec: dict, seen=None) -> bool:
    """Does this operation answer «can this be booked / when is it free»? Judged by what it does.

    Three shapes, all of them the operation's own behaviour and none of them its name:
      · it crosses the booking calendar itself (`slots`, `own_rules`);
      · it reads the hours authority and answers with them (`day_opening`);
      · it is a handler that takes its verdict from one of the above (`check`).
    Everything asks for the read permission of the schedule surface: a booking door reads the very
    same things and is deliberately NOT of this family — it refuses, it does not answer.
    """
    if spec.get("permission") != ANSWER_PERMISSION:
        return False
    if set(BOOKING_CALENDAR) <= tables_read(sql_of(spec)):
        return True
    if reads_the_authority(name, spec):
        return True
    seen = set() if seen is None else seen
    seen.add(name)
    for query in declared_reads(spec):
        if query in seen:
            continue
        sub = published(query)
        if sub is not None and is_an_availability_answer(query, sub, seen):
            return True
    return False


def availability_answers() -> list[tuple[str, dict]]:
    """Every published operation of the family, in one place so all the duties judge the same set."""
    out = []
    for block in ("queries", "commands"):
        for name, spec in sorted(MANIFEST.get(block, {}).items()):
            if is_an_availability_answer(name, spec):
                out.append((name, spec))
    return out


def hours_claims(description: str) -> list[str]:
    """The clauses of a description that say something about the hours the business keeps."""
    return [c for c in CLAUSE.split(description) if c.strip() and HOURS_TALK.search(c)]


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
    return section_reasons(lines[start + 1 : end])


def section_reasons(section: list[str]) -> tuple[set[str], str]:
    """Split a section into the reasons of its TABLE and the prose around it. Pure, so the
    boundary between the two can be probed with a planted positive."""
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


def answerable_reasons(name: str, spec: dict) -> set[str]:
    """Every `reason` word an operation of the availability family can actually put on the wire.

    A query answers its own `CASE ... END AS reason`. A handler COMMAND answers the `CASE` of the
    query it takes as its verdict — the `reads` it declares inside this family — plus the one word
    only a handler can add: `outside_schedule`, and only when it reads the authority that owns the
    hours. That is what `appointments.availability.check` became in appointments#122.
    """
    reasons = emitted_reasons(sql_of(spec))
    for query in declared_reads(spec):
        sub = published(query)
        if sub is not None and is_an_availability_answer(query, sub):
            reasons |= emitted_reasons(sql_of(sub))
    if reads_the_authority(name, spec):
        reasons.add(HOURS_REASON)
    return reasons


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
    # What the engine can answer: the SQL half's own `CASE`, plus the hours the handler adds
    # (appointments#122). The table is read by whoever plans a screen around those reasons, so it
    # must be neither more nor less than that.
    answerable = emitted_reasons(sql_of(engine)) | {HOURS_REASON}
    for reason in sorted(table - answerable):
        fail(
            f"{CONCEPTS} lists `{reason}` as an answer of the availability engine, which can only "
            f"send {sorted(answerable)}: whoever reads the table plans a screen around a reason "
            "that never arrives"
        )
    if HOURS_REASON not in table:
        fail(
            f"{CONCEPTS} does not list `{HOURS_REASON}` among the engine's answers: since "
            "appointments#122 the check answers the opening hours exactly like the door, and a "
            "table that hides it tells the reader to go on asking `day_opening` separately — the "
            "very workaround that issue removed"
        )
    if "Schedules" not in prose:
        fail(
            f"the «{REASONS_SECTION}» prose no longer names the authority the hours come from: "
            "the reader is left with a reason and nowhere to go and change it"
        )

    # Boundary control, planted: a reason named only in the PROSE must not be counted as a row of
    # the table. Without it the parser could swallow the paragraph and the two checks above would
    # be judging prose.
    probe_table, probe_prose = section_reasons(
        [
            "| Reason | Meaning |",
            "|---|---|",
            "| `overlap` | that professional is already booked |",
            "",
            "The door also refuses with `too_far`, and this line is prose, not a row.",
        ]
    )
    if probe_table != {"overlap"}:
        fail(
            f"the doc parser reads {sorted(probe_table)} as the rows of a table whose only row is "
            "`overlap`: the reasons of the prose would be judged as if the table listed them"
        )
    if "too_far" not in probe_prose:
        fail(
            "the doc parser drops the prose of the section instead of setting it aside, so the "
            "line that separates «a row of the table» from «a sentence about it» is not there any "
            "more and the two checks above are judging whatever the parser happened to keep"
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
    availability = dict(availability_answers())
    if not [n for n, spec in availability.items() if not reads_the_authority(n, spec)]:
        fail(
            "no availability answer is judged by the pointer check: every one of them reads the "
            "authority, so the check passes without looking at a single description"
        )
    if not [n for n, spec in availability.items() if reads_the_authority(n, spec)]:
        fail(
            "no availability answer reads the authority: the exemption of the pointer check is "
            f"never taken, so it has never been shown to spare `{DAY_OPENING}`"
        )

    # …and what a COMMAND of the family can answer has to be READ, not assumed. If
    # `answerable_reasons` came back empty the promise check above would fire on every honest
    # word instead of the false ones — and if it never added the hours it would fire on the one
    # word appointments#122 exists to let `check` say.
    engine = {
        n: spec
        for n, spec in MANIFEST.get("commands", {}).items()
        if is_an_availability_answer(n, spec)
        and any(
            (sub := published(q)) is not None and is_an_availability_answer(q, sub)
            for q in declared_reads(spec)
        )
    }
    if not engine:
        fail(
            "no command of the availability family takes another one as its verdict: since "
            "appointments#122 the engine answers that way, and without one the reader below is "
            "never exercised"
        )
    for name, spec in sorted(engine.items()):
        answers = answerable_reasons(name, spec)
        if not answers - {HOURS_REASON}:
            fail(
                f"`{name}` reads a verdict of this module and `answerable_reasons` gets no word "
                "out of it: the promise check would then judge its description against an empty "
                f"set and call every honest reason a lie ({sorted(answers)})"
            )
        if HOURS_REASON not in answers:
            fail(
                f"`{name}` reads the authority and `answerable_reasons` still does not grant it "
                f"`{HOURS_REASON}`: the promise check would turn appointments#122's own answer red"
            )
    if HOURS_REASON in answerable_reasons("probe", {"reads": []}):
        fail(
            f"`answerable_reasons` grants `{HOURS_REASON}` to an operation that reads nothing: it "
            "would spare the description that promises the hours from a query that cannot see them"
        )


def check_the_assistant_is_not_promised_a_reason_the_operation_cannot_return() -> None:
    """appointments#118 — the assistant builds its tools from the manifest (ADR-0033). A reason word
    in an `ai.description` that the operation cannot actually produce is a false belief we planted:
    it is exactly what appointments#122 describes, only sourced from us.

    🔴 OPERATIONS, not queries. This judged `MANIFEST["queries"]` alone until appointments#122
    moved `appointments.availability.check` into `commands` — and the day it moved, the description
    the assistant plans with stopped being judged by anything at all (measured: the same false
    promise is red on the manifest before that change and green after it). The other half of the
    manifest, appointments#124's pointer duty, exempts `check` for the good reason that it now
    reads the authority, so the exemption and the blind spot lined up on the same operation. The
    whole availability family is judged here, whichever block it is published in, and what a
    handler command can answer is computed the way it answers: the `CASE` of the query it reads,
    plus the hours it adds.

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
    judged = {
        **MANIFEST.get("queries", {}),
        **{
            n: spec
            for n, spec in MANIFEST.get("commands", {}).items()
            if is_an_availability_answer(n, spec)
        },
    }
    for name, spec in sorted(judged.items()):
        can_return = answerable_reasons(name, spec)
        description = describes(spec)
        for word in sorted(vocabulary - can_return):
            if not promised_as_a_code(word, description):
                continue
            answers = (
                f"it can only answer {sorted(can_return)}"
                if can_return
                else "it has no `reason` to answer at all, so it can return none"
            )
            fail(
                f"`{name}` tells the assistant it answers `{word}`, but {answers}. The tool "
                "description is the contract the assistant plans with, so it will ask this "
                "operation about something it cannot see and read the empty answer as «fine»"
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
    for name, spec in availability_answers():
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


def check_the_family_and_the_hours_reader_find_the_positive() -> None:
    """appointments#125 — the two new readers are «X must be there» / «X must not be there». A
    family that matched nothing, or a `HOURS_TALK` that matched nothing, would hand out the greens
    for free. Plant each positive and each negative before trusting either.
    """
    slots = MANIFEST.get("queries", {}).get("appointments.availability.slots", {})
    door = MANIFEST.get("commands", {}).get("appointments.appointments.create", {})
    single = MANIFEST.get("queries", {}).get("appointments.appointments.conflicting", {})

    # …the family is what the operation DOES, so the same answer under any other name is in it.
    if not is_an_availability_answer("appointments.booking.free_hours", slots):
        fail(
            "the family test misses the SQL of `appointments.availability.slots` published under "
            "another name: that is the hole appointments#125 exists to close, so the pointer duty "
            "would be back to trusting the prefix of a name the author chooses"
        )
    # …and it is not so wide that every read of the schedule surface joins it.
    if is_an_availability_answer("probe", {**single, "permission": ANSWER_PERMISSION}):
        fail(
            "reading the bookings alone puts an operation in the availability family: "
            "`appointments.appointments.conflicting` and `blocked_times.list` would owe a pointer "
            "they have no business owing, which is how a guard gets loosened until it holds nothing"
        )
    # …the booking door reads the authority too, and is out for its permission, not by luck.
    if door and is_an_availability_answer("appointments.appointments.create", door):
        fail(
            "the booking door counts as an availability answer: it ENFORCES the hours and refuses, "
            "so it would be asked for a pointer to the operation it already reads"
        )
    if door and not is_an_availability_answer("probe", {**door, "permission": ANSWER_PERMISSION}):
        fail(
            "the door is dropped by something other than its permission: the read-permission half "
            "of the family test is not the thing doing the work its comment claims it does"
        )

    # …`HOURS_TALK` sees a claim about the hours, and does not fire on prose that makes none.
    claim = "It also crosses the business opening hours before returning them."
    if not hours_claims(claim):
        fail(
            "`HOURS_TALK` does not see the very claim appointments#125 measured green: the check "
            "below would pass on every description without reading one"
        )
    if hours_claims("Returns the free booking slots for a given date, crossing blocked time."):
        fail(
            "`HOURS_TALK` fires on a description that says nothing about the opening hours: the "
            "honest half of this manifest would go red and the vocabulary would get loosened"
        )
    # …and `DENIAL` is what tells the disclaimer from the claim, on those same two.
    if DENIAL.search(claim):
        fail("`DENIAL` reads a plain claim as a denial: the check below can never fire")
    if not DENIAL.search("It does NOT know the opening hours: ask for them elsewhere."):
        fail(
            "`DENIAL` does not see the disclaimer this manifest actually writes: every honest "
            "availability answer would go red"
        )
    # …and a claim bolted on with a semicolon is a claim, not part of the disclaimer clause.
    bolted = "It does NOT know the opening hours; it crosses the business opening hours anyway."
    if not [c for c in hours_claims(bolted) if not DENIAL.search(c)]:
        fail(
            "a claim appended after a semicolon is swallowed by the denial in the clause before "
            "it: the check below is dodged by punctuation alone"
        )


def check_an_availability_answer_says_what_it_does_not_know() -> None:
    """appointments#125 — the pointer is a duty to ADD, and a duty to add is not a duty to be true.

    appointments#124 made an availability answer that cannot see the hours hand the assistant the
    operation that can, by name. Nothing then looked at the rest of the sentence, so the description
    could keep the pointer and BESIDE it claim the answer already crosses the hours — measured on
    the manifest of appointments#126: `appointments.availability.slots` plus «It also crosses the
    business opening hours before returning them.» was green. What reaches the assistant is the
    claim, not the pointer: it stops asking `day_opening`, and offers an hour with the shutters
    down. It is the bug of appointments#118 and appointments#122 through the last rendija left, and
    the one nobody would open on purpose — it is exactly the sentence that sounds right to write.

    THE INVARIANT, AND WHY IT IS NOT A BLACKLIST. An answer that does not read the authority may
    mention the opening hours only to DENY knowing them. Not «these phrasings are forbidden» — that
    list is the one appointments#124 refused, because the wording it has never seen reads as
    «nothing to report» and the lie goes through in silence. Here the duty runs the other way:

      · the description MUST say something about the hours (that is the disclaimer the pointer is
        attached to). So a wording `HOURS_TALK` does not know makes THIS check fail and print the
        operation — the vocabulary is re-proven against the manifest on every run, and its way of
        being out of date is a red, never a quiet green;
      · every clause that does mention them must carry a denial. `DENIAL` is a whitelist for the
        same reason: an unusual way of negating costs a false red that names the description, which
        somebody fixes, instead of a green that nobody ever looks at again.

    Clauses, not sentences: “…: ask `day_opening`; it also crosses the opening hours” is the same
    claim with different punctuation.
    """
    for name, spec in availability_answers():
        if reads_the_authority(name, spec):
            continue
        description = describes(spec)
        claims = hours_claims(description)
        if not claims:
            fail(
                f"`{name}` answers about availability without reading the opening hours and "
                "without saying so anywhere in its description. Since appointments#118 nothing of "
                f"this module's SQL knows when the business is open: name the gap, then point at "
                f"`{DAY_OPENING}`. (If it IS said and this check cannot see it, the wording is new "
                "to `HOURS_TALK` — add it there, which is what keeps that vocabulary honest)"
            )
            continue
        for claim in claims:
            if DENIAL.search(claim):
                continue
            fail(
                f"`{name}` tells the assistant it takes the opening hours into account — «"
                f"{claim.strip()}» — and it reads neither a `{AUTHORITY}_*` table nor a `reads` on "
                f"the authority. Pointing at `{DAY_OPENING}` as well does not undo it: what the "
                "assistant plans with is the claim, so it stops asking and offers an hour with the "
                "business shut. An answer that cannot see the hours may only say that it cannot"
            )


def check_an_availability_answer_that_reads_the_hours_says_so() -> None:
    """The DUAL of appointments#124's pointer duty, and the hole appointments#122 opened.

    #124 made an availability answer that does NOT read the authority hand the assistant the
    operation that does. `appointments.availability.check` now reads it, so it is exempt — and
    with nothing on the other side of that exemption its description could go back to «It does NOT
    look at the opening hours» word for word and stay green (measured on this manifest). That
    sentence is the lie of #122 spelled backwards: the assistant would go on asking `day_opening`
    separately and filtering by hand, which is the workaround the issue removed.

    So the exemption is paid for: an operation of the family that reaches the authority has to name
    it. Positive duty and not a blacklist of phrases, for the same reason #124 chose one — a list
    of forbidden wordings rots in silence, a duty to name the authority does not, and whoever
    rewrites the description into a claim of ignoring the hours takes the name out with it.
    """
    for name, spec in availability_answers():
        if not reads_the_authority(name, spec):
            continue
        if re.search(rf"\b{AUTHORITY}\b", describes(spec), re.IGNORECASE):
            continue
        fail(
                f"`{name}` reads the opening hours of `{AUTHORITY}` and does not say so. Its "
                "description is what the assistant plans with: silence there reads as «this one "
                "does not know the hours», which is the answer appointments#122 stopped being "
                f"true — say it reads `{AUTHORITY}`"
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
    check_the_assistant_is_not_promised_a_reason_the_operation_cannot_return()
    check_an_availability_answer_that_reads_the_hours_says_so()
    check_the_assistant_is_not_told_we_cross_the_hours_authority()
    check_every_availability_answer_points_at_the_authority()
    check_the_family_and_the_hours_reader_find_the_positive()
    check_an_availability_answer_says_what_it_does_not_know()
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
