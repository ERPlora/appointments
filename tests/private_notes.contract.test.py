#!/usr/bin/env python3
"""The salon's private appointment notes never leave through a read a MODEL can call.

Why this file exists (appointments#143). `appointments.appointments.list_for_customer` takes a
`customer_id` and returns that customer's visits — with `notes` and `internal_notes`, which is
where the colour formula, the products used and whatever the salon writes down for itself live.
The query carries an `ai` block, so it is assembled as a TOOL for the assistant and for the `ai`
steps of a flow (`crates/server/src/assistant.rs`: a query is offered only `if let Some(ai) =
&q.def.ai`). The unattended WhatsApp recipe hands that tool to a model that is reading a
stranger's message, so the message decides the arguments.

Identity CANNOT be settled inside this module: for a read the `customer_id` IS the filter, so
there is no row to compare it against — the caller would only be attesting to itself (that is why
`customer_identity_refusal`, which #140/#142 gave `cancel`/`reschedule`, has no equivalent here).
Binding the id belongs to the kernel, next to the payload pinning of ERPlora/hub#1623, and a
`query` grant pins nothing today (`crates/runtime/src/flows/grants.rs::check_query_grant` compares
the NAME and nothing else).

What this module owns, and what the market settles unanimously, is WHAT comes out: the salon's
notes stay inside the salon. Fresha ("appointment notes are private and only visible to you and
your team"), Vagaro ("visible only to the business") and Booksy keep client/appointment notes on
the business side, never on the client-facing surface. So the delegated door carries the visit —
when, what, with whom, in what state — and never the notes; the counter keeps the whole row.

The contract this file pins, as a TABLE over the manifest so a query added tomorrow cannot
reopen the door:

  1. No query with an `ai` block SELECTs `notes` or `internal_notes`.
  2. `list_for_customer` is still the delegated door (`ai` + `expose_api`): the fix narrows what
     it returns, it does not withdraw the tool the WhatsApp recipe already builds on.
  3. `list_for_customer_with_notes` is the counter's door: it carries both note columns, keeps
     the module's read permission, and has NO `ai` block.

Anchored in BOTH directions on purpose: a scanner that quietly stopped seeing `internal_notes`
would turn every one of these into a green that proves nothing, so the same scanner has to KEEP
finding the notes on the counter's query (control 3) and the `ai` table has to be non-empty.

Usage: tests/private_notes.contract.test.py   (exit 0 = green). No container, no Postgres.
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

PERMISSION = "appointments.view_appointment"
DELEGATED = "appointments.appointments.list_for_customer"
COUNTER = "appointments.appointments.list_for_customer_with_notes"
PRIVATE_COLUMNS = ("notes", "internal_notes")

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def sql_without_comments(rel: str) -> str:
    """The SQL as the engine sees it: `--` comments stripped.

    The headers of this module explain at length why the notes live in these rows, so a scanner
    that matched raw text would find `internal_notes` in the PROSE of a query that does not
    select it and refuse a perfectly closed door.
    """
    raw = (MODULE_DIR / rel).read_text()
    return "\n".join(re.sub(r"--.*$", "", line) for line in raw.splitlines())


def selects_column(rel: str, column: str) -> bool:
    """Does this SQL return `column` to the caller?

    Only the projection counts: `internal_notes` in a WHERE or in an UPDATE target is not a
    column that reaches whoever called the query. The SELECT list is everything between the
    first `SELECT` and its `FROM`.
    """
    sql = sql_without_comments(rel)
    m = re.search(r"\bSELECT\b(.*?)\bFROM\b", sql, re.IGNORECASE | re.DOTALL)
    if not m:
        return False
    return re.search(rf"\b{re.escape(column)}\b", m.group(1), re.IGNORECASE) is not None


def query_sql(name: str) -> str | None:
    q = MANIFEST.get("queries", {}).get(name)
    if not isinstance(q, dict):
        return None
    rel = q.get("sql")
    if not rel or not (MODULE_DIR / rel).exists():
        return None
    return rel


# ── 1. The table: nothing a model can call returns the salon's notes ─────────────────────

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
    for column in PRIVATE_COLUMNS:
        if selects_column(rel, column):
            fail(
                f"{name} has an `ai` block and SELECTs {column!r} ({rel}): the assistant and the "
                f"`ai` steps of a flow are offered this query as a tool, so the salon's private "
                f"notes would be composed into an answer a model writes for whoever is on the "
                f"other side. Drop the column from the projection, or drop the `ai` block."
            )

# ── 2. The delegated door is still there, just narrower ──────────────────────────────────

delegated = MANIFEST.get("queries", {}).get(DELEGATED)
if not isinstance(delegated, dict):
    fail(f"{DELEGATED}: not declared in module.json")
else:
    if not (delegated.get("ai") or {}).get("description"):
        fail(
            f"{DELEGATED}.ai: missing. The fix is to stop returning the notes, NOT to withdraw "
            f"the tool: the shipped `appointment-from-whatsapp*` recipes list this query in the "
            f"`tools.queries` of their `book_appointment` step, so removing the `ai` block would "
            f"leave the model unable to find the appointment it is being asked to move."
        )
    if delegated.get("expose_api") is not True:
        fail(
            f"{DELEGATED}.expose_api: must stay true (the salon's own API key reads it)"
        )

# ── 3. The counter's door carries the notes — and the scanner still finds them ───────────

counter = MANIFEST.get("queries", {}).get(COUNTER)
if not isinstance(counter, dict):
    fail(
        f"{COUNTER}: not declared in module.json. The stylist needs the last formula at the "
        f"chair (appointments#46): once the delegated read stops carrying the notes, the "
        f"customer sheet needs a door that does — one the model is never offered."
    )
else:
    if counter.get("permission") != PERMISSION:
        fail(
            f"{COUNTER}.permission is {counter.get('permission')!r}, expected {PERMISSION!r}"
        )
    if counter.get("ai"):
        fail(
            f"{COUNTER}.ai: must NOT be declared — this is the door that carries the notes, so "
            f"offering it as a tool would put them straight back in a model's reach"
        )
    rel = query_sql(COUNTER)
    if not rel:
        fail(f"{COUNTER}.sql: not declared or not in the package")
    else:
        for column in PRIVATE_COLUMNS:
            if not selects_column(rel, column):
                fail(
                    f"{COUNTER} does not SELECT {column!r} ({rel}): the counter's door has to "
                    f"return what the delegated one gave up, otherwise the customer sheet lost "
                    f"the formula instead of protecting it — and this guard would be scanning "
                    f"for a column no query has, which passes for the wrong reason"
                )

if failures:
    print(f"✗ private notes contract: {len(failures)} failure(s)\n")
    for f in failures:
        print(f"  • {f}\n")
    sys.exit(1)

print(
    f"✓ private notes contract: {len(ai_queries)} `ai` queries carry no notes; "
    f"{COUNTER.split('.')[-1]} keeps them for the counter"
)
