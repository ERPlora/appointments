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
     `queries/availability_check.sql` — advisory — into the handler. Since appointments#118
     «the opening hours» means the four `schedules.*` lists and nothing else: this module's own
     copy, and the read that served it, are retired, so the only guard left is the one below.

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
# appointments#102 — the AUTHORITY. `appointments` owns the appointment and the agenda block; the
# business opening hours belong to `schedules`, which ADR-0392 made the single answer of the
# product to «are we open?». The gate resolves its precedence — exact special day > yearly special
# day > override range > weekly hours — over the booking's own date, so all four lists have to be
# there. They declare a `list` block and that is fine: `preload_reads` goes through
# `queries::execute`, which returns the WHOLE set, paginating internally (hub#650).
# schedules#36 — the first release that SEEDS the week (L-F 09:00-18:00, weekend closed) when the
# module is installed. appointments#118 retired this module's own timetable BECAUSE of it: below
# this floor «the hub has no opening hours» is a reachable state again, and the gate fails closed.
SEEDING_SCHEDULES = "2.0.28"

SCHEDULES_READS = (
    "schedules.business_hours.list",
    "schedules.special_days.list",
    "schedules.overrides.list",
    "schedules.exception_intervals.list",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def _version(raw: str) -> tuple:
    """`2.0.28` > `2.0.9`: compare the numbers, not the strings."""
    return tuple(int(part) for part in re.findall(r"\d+", str(raw)))


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
    # The overlap gate and the history line are statements of `_reschedule_row`, after its UPDATE:
    # both find the row by `updated_at = :now`, which only holds inside ONE command — the runtime
    # mints a fresh `:now` for every operation a WASM handler returns (appointments#196).
    files = [
        rel
        for op in RESCHEDULE_CHAIN
        for rel in (MANIFEST.get("commands", {}).get(op) or {}).get("sql", [None])
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
    elif _version(floor) < _version(SEEDING_SCHEDULES):
        fail(
            f"depends_on[schedules].min_version is {floor!r}, below {SEEDING_SCHEDULES} — that is "
            "the first release that SEEDS the week on install (schedules#36), and appointments#118 "
            "removed this module's own timetable on the strength of it. Against an older "
            "`schedules` a fresh hub can carry no hours at all, and the gate refuses every booking "
            "with nothing the owner can see to fix"
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


# ── appointments#122 · the ENGINE answers the hours too ──────────────────────────────────────
#
# Everything above is about the DOOR. `appointments.availability.check` is the other side: what a
# caller is told BEFORE booking. It answered «free» about an hour the door would refuse, because a
# query of a module may only name its own tables and the hours belong to `schedules`. It is a
# handler command now, taking the SQL verdict as a read and adding the hours through the very
# function the door runs.
ENGINE = "appointments.availability.check"
ENGINE_RULES = "appointments.availability.own_rules"
ENGINE_FN = "check_availability"
HANDLER = MODULE_DIR / "handler" / "src" / "lib.rs"
# The `CASE ... END AS reason` of the SQL half is the list of verdicts it can produce.
REASON_CASE = re.compile(r"CASE(.*?)END\s+AS\s+reason", re.IGNORECASE | re.DOTALL)
REASON_LITERAL = re.compile(r"THEN\s+'([a-z_][a-z0-9_]*)'", re.IGNORECASE)
# …and this is how the handler says «the hours outrank this one».
RANKED_BELOW = re.compile(r"RANKED_BELOW_THE_HOURS:\s*\[&str;\s*\d+\]\s*=\s*\[([^\]]*)\]")


def sql_reasons() -> set[str]:
    """Every `reason` the SQL half can answer, read from its own `CASE`."""
    rel = MANIFEST.get("queries", {}).get(ENGINE_RULES, {}).get("sql")
    if not rel:
        return set()
    sql = "\n".join(
        line.split("--", 1)[0] for line in (MODULE_DIR / rel).read_text().splitlines()
    )
    out: set[str] = set()
    for body in REASON_CASE.findall(sql):
        out |= {r.lower() for r in REASON_LITERAL.findall(body)}
    return out


def ranked_below_the_hours(source: str) -> set[str]:
    """The verdicts the handler declares the opening hours outrank."""
    m = RANKED_BELOW.search(source)
    return set(re.findall(r'"([a-z_][a-z0-9_]*)"', m.group(1))) if m else set()


# The refusals the DOOR decides before it ever looks at the clock on the wall: `prepare_appointment`
# runs `lead_time_refusal` before `schedule_refusal`, so the hours cannot overwrite them and the
# engine must hand them back untouched. Everything else the SQL can answer the door ranks BELOW the
# hours, so it belongs in `RANKED_BELOW_THE_HOURS`. The two lists together have to cover the `CASE`.
RANKED_ABOVE_THE_HOURS = frozenset({"invalid_start", "too_soon", "too_far"})


def unranked_reasons(reasons: set[str], below: set[str]) -> set[str]:
    """The SQL verdicts the handler places NOWHERE against the opening hours. Pure, so the
    partition can be probed with a planted positive instead of trusted."""
    return set(reasons) - set(below) - set(RANKED_ABOVE_THE_HOURS)


def check_the_engine_answers_the_hours() -> None:
    engine = MANIFEST.get("commands", {}).get(ENGINE)
    if engine is None:
        fail(
            f"`{ENGINE}` is not a command: a query cannot declare `reads` or a handler (the "
            "manifest schema has neither), so as a query it can never see the opening hours and "
            "answers «free» about an hour the door refuses"
        )
        return
    if ENGINE in MANIFEST.get("queries", {}):
        fail(
            f"`{ENGINE}` is published as a query AND as a command: two doors with one name answer "
            "differently, and the SQL one is the one that does not know the hours"
        )
    if engine.get("handler", {}).get("function") != ENGINE_FN:
        fail(
            f"`{ENGINE}` does not run `{ENGINE_FN}`: the verdict is back in SQL that cannot read "
            f"`schedules`, got {engine.get('handler')!r}"
        )
    declared = {
        r.get("query"): bool(r.get("required"))
        for r in engine.get("reads", [])
        if isinstance(r, dict)
    }
    for needed in (ENGINE_RULES, POLICY_READ, *SCHEDULES_READS):
        if needed not in declared:
            fail(
                f"`{ENGINE}` does not declare the read `{needed}`: without it the engine answers "
                "on an input it never got"
            )
        elif not declared[needed]:
            fail(
                f"`{ENGINE}` declares `{needed}` without `required`: a read that may quietly fail "
                "to resolve turns the engine optimistic again — exactly the bug of #122"
            )


def check_every_verdict_of_the_sql_is_ranked_against_the_hours() -> None:
    """The handler decides in the DOOR's order: lead time → hours → blocked → overlap. A
    verdict added to the SQL tomorrow that nobody ranked would be reported as itself and never be
    overwritten by the hours — safe, but silently wrong for a rule the door ranks lower. So every
    word the SQL can answer has to be accounted for: either the hours outrank it
    (`RANKED_BELOW_THE_HOURS`) or the door settles it first (`RANKED_ABOVE_THE_HOURS`).

    🔴 «or the door emits it as an `appointments.<code>` refusal» is NOT good enough, and that is
    what this check said first. `overlapping_appointment` is a code the door emits AND ranks below
    the hours: a verdict added to the SQL under that name walked straight
    through, and the engine would report it instead of `outside_schedule` — the exact silent escape
    the paragraph above says this check prevents (measured on this manifest). Being emitted by the
    door proves the door knows the word, not that the door decides it before the clock."""
    source = HANDLER.read_text()
    below = ranked_below_the_hours(source)
    reasons = sql_reasons()
    if not reasons:
        fail(
            f"no `reason` could be read from the SQL of `{ENGINE_RULES}`: this check then passes "
            "on an empty set and ranks nothing"
        )
    if not below:
        fail(
            "`RANKED_BELOW_THE_HOURS` could not be read from the handler: the ranking would look "
            "empty and every verdict would seem to outrank the opening hours"
        )
    for reason in sorted(unranked_reasons(reasons, below)):
        fail(
            f"the SQL can answer `{reason}` and the handler ranks it nowhere: add it to "
            "`RANKED_BELOW_THE_HOURS` if the opening hours outrank it, or to "
            f"`RANKED_ABOVE_THE_HOURS` here if the door settles it first (and then say so in "
            "`prepare_appointment`) — an unranked verdict silently escapes the hours the door "
            "does enforce"
        )
    for reason in sorted(below & RANKED_ABOVE_THE_HOURS):
        fail(
            f"`{reason}` is ranked BOTH above and below the opening hours: the engine and the door "
            "cannot both be the one that decides it"
        )


def check_the_ranking_reader_finds_the_positive() -> None:
    """Both readers above are «X must be there»: if either returned nothing the check would pass
    on emptiness. Plant the positive and the negative before trusting them."""
    probe = "const RANKED_BELOW_THE_HOURS: [&str; 2] = [\"blocked\", \"held\"];"
    if ranked_below_the_hours(probe) != {"blocked", "held"}:
        fail(
            "the ranking reader cannot read a plain `RANKED_BELOW_THE_HOURS`: it would report an "
            f"empty set and rank nothing ({ranked_below_the_hours(probe)!r})"
        )
    if ranked_below_the_hours("const SOMETHING_ELSE: [&str; 1] = [\"blocked\"];"):
        fail("the ranking reader matches any Rust array: it would read the wrong list")
    if "overlap" not in sql_reasons():
        fail(
            "`overlap` is not among the reasons read from the SQL: the parser is not reaching the "
            f"`CASE` of `{ENGINE_RULES}`, so the coverage check ranks nothing"
        )

    # The partition has to REJECT a verdict the door merely knows a word for.
    # `overlapping_appointment` is a refusal the door emits and ranks BELOW the hours: accepting
    # it on that ground is the hole this check used to have.
    below = ranked_below_the_hours(HANDLER.read_text())
    if not unranked_reasons({"overlapping_appointment"}, below):
        fail(
            "the partition accepts `overlapping_appointment` as ranked: a verdict the door emits but settles "
            "AFTER the hours would pass unranked and escape them in silence"
        )
    if unranked_reasons({"too_soon", "blocked"}, below):
        fail(
            "the partition calls `too_soon`/`blocked` unranked: every honest verdict of the SQL "
            f"would be red ({sorted(unranked_reasons({'too_soon', 'blocked'}, below))})"
        )

    # …and what puts the three of `RANKED_ABOVE_THE_HOURS` above them is one fact of the door:
    # `lead_time_refusal` runs BEFORE `schedule_refusal`. Reorder it and this list is a lie.
    source = HANDLER.read_text()
    door = source[source.find("fn prepare_appointment") :]
    lead, hours = door.find("lead_time_refusal(settings"), door.find("schedule_refusal(input")
    if lead < 0 or hours < 0:
        fail(
            "`prepare_appointment` no longer calls `lead_time_refusal` and `schedule_refusal` by "
            "name: `RANKED_ABOVE_THE_HOURS` has nothing left anchoring it to the door's order"
        )
    elif lead > hours:
        fail(
            "the door now judges the opening hours BEFORE the lead time, so "
            f"{sorted(RANKED_ABOVE_THE_HOURS)} are no longer above them: the engine hands back a "
            "word the door would have overwritten"
        )
    for reason in sorted(RANKED_ABOVE_THE_HOURS):
        if f'"appointments.{reason}"' not in source:
            fail(
                f"`{reason}` is ranked above the hours here but the door emits no "
                f"`appointments.{reason}`: the list has drifted from the refusals that exist"
            )


def main() -> int:
    check_writers()
    check_reschedule()
    check_schedules_authority()
    check_i18n()
    check_the_engine_answers_the_hours()
    check_every_verdict_of_the_sql_is_ranked_against_the_hours()
    check_the_ranking_reader_finds_the_positive()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: every command that writes a slot reads its availability rules")
    return 0


if __name__ == "__main__":
    sys.exit(main())
