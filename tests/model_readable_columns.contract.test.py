#!/usr/bin/env python3
"""What a MODEL may read out of an appointment row — and what stays on the counter.

A query carrying an `ai` block is assembled as a TOOL: for the salon's own assistant, and for the
`ai` step of any flow that was granted it (`crates/server/src/assistant.rs`, a query is offered
only `if let Some(ai) = &q.def.ai`; `crates/runtime/src/flows/agent_runner.rs` crosses the same
table with the step's `tools.queries`). The unattended WhatsApp recipe hands those tools to a model
that is reading a STRANGER's message, so the message decides the arguments — and a read cannot be
narrowed to «the person writing»: a `query` grant pins the NAME and nothing else
(`crates/runtime/src/flows/grants.rs::check_query_grant`), which is ERPlora/hub#1662.

So the module cannot control WHO asks. What it owns is WHAT comes out, and this file pins that as a
TABLE over the manifest, so a query added tomorrow cannot quietly reopen a door.

Two families of columns are withheld, each closed by its own issue:

  • notes (appointments#143) — `notes` / `internal_notes`, where the colour formula, the products
    used and whatever the salon writes down for itself live. Counter door:
    `list_for_customer_with_notes`.
  • contact (appointments#146) — `customer_phone` / `customer_email`. The day agenda
    (`appointments.appointments.list`) returned a whole day of them, so a stranger writing to a
    salon that granted this read to an unattended flow only had to ask for the list to walk away
    with the day's contact sheet. Counter door: `appointments.appointments.get`.

**`customer_name` is deliberately NOT withheld**, and control 4 keeps it reachable. The market is
unanimous that the line falls between the name and the way to reach someone: Vagaro's least
privileged access level leaves an employee «only able to see a client's first and last name»
(support.vagaro.com, Configure Access Levels and Employee Permissions); the hide-list salon owners
ask Square for is «phone numbers, email addresses, and home addresses», never the name
(community.squareup.com/t5/Feature-Requests, Allow Administrators to Hide Client Contact
Information); Booksy sells an alert for the exact shape of this leak — a staff member who «displays
contact details of multiple clients in a short period of time» (support.booksy.com, How do I manage
staff permissions); Fresha drops client details when a row leaves for a less trusted surface (only
start/end times reach an external calendar) and says its AI Concierge «only accesses the
information it needs»; Shopify's APIs «redact customer personal data by default» and approve «the
minimum amount of data needed». Stripping the name instead would cost the assistant the one
question it exists to answer — «who have I got at ten?» — and buy nothing: a name is not a channel.

Anchored in BOTH directions on purpose. A scanner that quietly stopped matching would turn every
control here into a green that proves nothing, so the same scanner has to KEEP finding each
family's columns on its counter query (control 3), the `ai` table has to be non-empty, and the
delegated day agenda has to keep returning the name (control 4).

Usage: tests/model_readable_columns.contract.test.py   (exit 0 = green). No container, no Postgres.
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

PERMISSION = "appointments.view_appointment"
DELEGATED = "appointments.appointments.list_for_customer"
DAY_AGENDA = "appointments.appointments.list"

# Each family: the columns a model must never be able to name, and the door that keeps them for
# the counter. The counter door carries the columns and has NO `ai` block.
FAMILIES = {
    "the salon's private notes": {
        "columns": ("notes", "internal_notes"),
        "counter": "appointments.appointments.list_for_customer_with_notes",
        "why_counter": (
            "the stylist needs the last formula at the chair (appointments#46): once the "
            "delegated read stopped carrying the notes, the customer sheet needed a door that "
            "does — one the model is never offered"
        ),
    },
    "the customer's contact details": {
        "columns": ("customer_phone", "customer_email"),
        "counter": "appointments.appointments.get",
        "why_counter": (
            "opening one appointment at the counter still has to show how to reach that "
            "customer (appointments#146); what a model must not get is a whole day of them "
            "in one answer"
        ),
    },
}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def sql_without_comments(rel: str) -> str:
    """The SQL as the engine sees it: `--` comments stripped.

    The headers of this module explain at length why these columns live in these rows, so a
    scanner that matched raw text would find `internal_notes` — or `customer_phone` — in the PROSE
    of a query that does not select it and refuse a perfectly closed door.
    """
    raw = (MODULE_DIR / rel).read_text()
    return "\n".join(re.sub(r"--.*$", "", line) for line in raw.splitlines())


def mentions_column(rel: str, column: str) -> bool:
    """Does this SQL name `column` ANYWHERE the engine reads it?

    Deliberately NOT "does the projection return it". For a query a model can call, the projection
    is not the only way out: a column in a WHERE is an oracle (`internal_notes LIKE :x`, or
    `customer_phone = :x`, lets the caller probe one guess at a time), and a CTE or a scalar
    subquery puts the SELECT that reaches the caller AFTER the first `SELECT … FROM`, where a
    projection-only scan never looks. Measured on this file's first cut (appointments#147 review):
    an `ai` query with a CTE whose outer SELECT returned `internal_notes`, and one filtering on
    `internal_notes`, both passed a projection-only scan. So the rule is the simple one that fails
    closed: a query with an `ai` block does not NAME these columns, in any clause. Two `ai` queries
    of this module already use CTEs (`availability_check.sql`, `availability_slots.sql`), so the
    shape is not hypothetical.
    """
    return (
        re.search(rf"\b{re.escape(column)}\b", sql_without_comments(rel), re.IGNORECASE)
        is not None
    )


def query_sql(name: str) -> str | None:
    q = MANIFEST.get("queries", {}).get(name)
    if not isinstance(q, dict):
        return None
    rel = q.get("sql")
    if not rel or not (MODULE_DIR / rel).exists():
        return None
    return rel


# ── 1. The table: nothing a model can call names a withheld column ───────────────────────

ai_queries = {
    name: q
    for name, q in (MANIFEST.get("queries") or {}).items()
    if isinstance(q, dict) and (q.get("ai") or {}).get("description")
}

if not ai_queries:
    fail(
        "no query declares an `ai` block: either the manifest changed shape or this guard is "
        "scanning nothing — an empty table cannot prove the door is shut"
    )

for name, q in sorted(ai_queries.items()):
    rel = q.get("sql")
    if not rel or not (MODULE_DIR / rel).exists():
        fail(f"{name}.sql: {rel!r} is not in the package")
        continue
    for family, spec in FAMILIES.items():
        for column in spec["columns"]:
            if mentions_column(rel, column):
                fail(
                    f"{name} has an `ai` block and names {column!r} ({rel}): the assistant and "
                    f"the `ai` steps of a flow are offered this query as a tool, so {family} "
                    f"would be composed into an answer a model writes for whoever is on the "
                    f"other side — or probed through a WHERE. Take the column out of the query "
                    f"entirely, or drop the `ai` block. The counter reads it through "
                    f"{spec['counter']}."
                )

# ── 2. The delegated door is still there, just narrower ──────────────────────────────────

delegated = MANIFEST.get("queries", {}).get(DELEGATED)
if not isinstance(delegated, dict):
    fail(f"{DELEGATED}: not declared in module.json")
else:
    if not (delegated.get("ai") or {}).get("description"):
        fail(
            f"{DELEGATED}.ai: missing. The fix is to stop returning the withheld columns, NOT to "
            f"withdraw the tool: the shipped `appointment-from-whatsapp*` recipes list this query "
            f"in the `tools.queries` of their `book_appointment` step, so removing the `ai` block "
            f"would leave the model unable to find the appointment it is being asked to move."
        )
    if delegated.get("expose_api") is not True:
        fail(
            f"{DELEGATED}.expose_api: must stay true (the salon's own API key reads it)"
        )

# ── 3. Every family's counter door carries its columns — and the scanner still finds them ─

for family, spec in FAMILIES.items():
    counter_name = spec["counter"]
    counter = MANIFEST.get("queries", {}).get(counter_name)
    if not isinstance(counter, dict):
        fail(f"{counter_name}: not declared in module.json. {spec['why_counter']}.")
        continue
    if counter.get("permission") != PERMISSION:
        fail(
            f"{counter_name}.permission is {counter.get('permission')!r}, "
            f"expected {PERMISSION!r}"
        )
    if counter.get("ai"):
        fail(
            f"{counter_name}.ai: must NOT be declared — this is the door that carries "
            f"{family}, so offering it as a tool would put them straight back in a model's reach"
        )
    rel = query_sql(counter_name)
    if not rel:
        fail(f"{counter_name}.sql: not declared or not in the package")
        continue
    for column in spec["columns"]:
        if not mentions_column(rel, column):
            fail(
                f"{counter_name} does not name {column!r} ({rel}): the counter's door has to "
                f"return what the delegated one gave up, otherwise the screen lost {family} "
                f"instead of protecting them — and this guard would be scanning for a column no "
                f"query has, which passes for the wrong reason"
            )

# ── 4. The name is NOT contact: the day agenda still tells a model WHO is coming ──────────

if any("customer_name" in spec["columns"] for spec in FAMILIES.values()):
    fail(
        "customer_name is listed as a withheld column. That is not the line the market draws "
        "(Vagaro's most restricted access level still shows first and last name; the hide-lists "
        "Square and Booksy users ask for are phone, email and address). Withholding it costs the "
        "assistant «who have I got at ten?» and buys nothing — a name is not a channel."
    )

agenda_sql = query_sql(DAY_AGENDA)
if not agenda_sql:
    fail(f"{DAY_AGENDA}.sql: not declared or not in the package")
elif not (MANIFEST["queries"][DAY_AGENDA].get("ai") or {}).get("description"):
    fail(
        f"{DAY_AGENDA}.ai: missing. Narrowing the projection is the fix for appointments#146; "
        f"withdrawing the day agenda from the assistant is not. No shipped recipe lists this "
        f"query, but it is how the salon's own assistant answers «what does my day look like?»."
    )
elif not mentions_column(agenda_sql, "customer_name"):
    fail(
        f"{DAY_AGENDA} no longer names 'customer_name' ({agenda_sql}): the agenda column, the "
        f"calendar entry title and the table's search keys all read it "
        f"(ui/components/erp-appointments-list), and the assistant cannot say who is coming "
        f"without it. Contact details were what had to go, not the customer's identity."
    )

if failures:
    print(f"✗ model-readable columns: {len(failures)} failure(s)\n")
    for f in failures:
        print(f"  • {f}\n")
    sys.exit(1)

print(
    f"✓ model-readable columns: {len(ai_queries)} `ai` queries carry neither the salon's notes "
    f"nor the customer's contact details; the counter keeps both, and the day agenda keeps the name"
)
