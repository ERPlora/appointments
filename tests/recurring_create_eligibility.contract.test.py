#!/usr/bin/env python3
"""`recurring.create` judges the professional like a single booking — appointments#283, the wiring.

The series door was a bare INSERT (`commands/recurring_create.sql`) with no `reads`: the assistant
or the API could save a series with a professional who does not perform its service, and every
«Book appointments» then died on `materialize` with `staff_not_eligible`. The fix runs the door
through the WASM handler `create_recurring`, which resolves the three links with the same
`resolve_booking` as `appointments.create` and only then writes the template through the internal
`appointments._recurring_insert`.

The rule itself is unit-tested in `handler/src/lib.rs` (`series_create_*`) and proven end to end
in `tests/recurring_create_eligibility.hub.test.py`. What fails SILENTLY at runtime is the wiring,
and that is what this file pins (hub#610: a read whose owner is not in `depends_on` is omitted
without error; a read that is not `required` degrades instead of refusing):

  1. HANDLER. `recurring.create` runs `create_recurring`, the guest exports it, and the command
     still declares `appointments.recurring.created` (the handler's copy carries the series id).
  2. READS. The four catalogue reads of a booking, each `required` and filtered by the TOP-LEVEL
     payload id, with every owner in `depends_on`.
  3. INSERT. `appointments._recurring_insert` is internal, runs the template INSERT and binds the
     id the handler hands it (`:recurring_id`), never a fresh `:new_id` — otherwise the row would be
     written with one id and the answer would report another.
  4. I18N. `staff_not_eligible` is declared in `errors` and translated en/es.

Usage: tests/recurring_create_eligibility.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

CREATE = "appointments.recurring.create"
INSERT = "appointments._recurring_insert"
CATALOGUE_READS = {
    "customers.get": {"customer_id": "payload.customer_id"},
    "services.services.get": {"service_id": "payload.service_id"},
    "staff.members.get": {"staff_id": "payload.staff_id"},
    "staff.services.eligible_for_service": {"service_id": "payload.service_id"},
}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def depends_on_ids() -> set:
    return {
        dep["id"] if isinstance(dep, dict) else dep
        for dep in MANIFEST.get("depends_on") or []
    }


def check_handler(cmd: dict) -> None:
    handler = cmd.get("handler")
    if not isinstance(handler, dict) or handler.get("function") != "create_recurring":
        fail(
            f"{CREATE}: must run the WASM handler 'create_recurring' (got {handler!r})"
        )
    if cmd.get("sql"):
        fail(f"{CREATE}: a bare `sql` door would skip the professional check again")
    source = (MODULE_DIR / "handler" / "src" / "lib.rs").read_text()
    if not re.search(r"#\[plugin_fn\]\s*pub fn create_recurring\(", source):
        fail("handler/src/lib.rs: the guest does not export `create_recurring`")
    if "appointments.recurring.created" not in (cmd.get("emit") or []):
        fail(f"{CREATE}: must keep declaring `appointments.recurring.created`")


def check_reads(cmd: dict) -> None:
    reads = {r.get("query"): r for r in cmd.get("reads") or [] if isinstance(r, dict)}
    for query, params in CATALOGUE_READS.items():
        if query.split(".")[0] not in depends_on_ids():
            fail(
                f"depends_on: {query.split('.')[0]!r} missing — {query!r} would be omitted"
            )
        read = reads.get(query)
        if read is None:
            fail(f"{CREATE}.reads: missing {query!r}")
            continue
        if read.get("required") is not True:
            fail(
                f"{CREATE}.reads[{query}]: must be `required` — no catalogue, no series"
            )
        for param, expr in params.items():
            if (read.get("params") or {}).get(param) != expr:
                fail(f"{CREATE}.reads[{query}]: params.{param} must be {expr!r}")


def check_insert() -> None:
    cmd = MANIFEST["commands"].get(INSERT)
    if not isinstance(cmd, dict):
        fail(f"{INSERT}: not declared")
        return
    if cmd.get("sql") != ["commands/_recurring_insert.sql"]:
        fail(
            f"{INSERT}: must run commands/_recurring_insert.sql (got {cmd.get('sql')!r})"
        )
        return
    sql = (MODULE_DIR / "commands" / "_recurring_insert.sql").read_text()
    body = "\n".join(l for l in sql.splitlines() if not l.lstrip().startswith("--"))
    if ":recurring_id" not in body:
        fail(
            "_recurring_insert.sql: must write the id the handler hands it (`:recurring_id`)"
        )
    if ":new_id" in body:
        fail(
            "_recurring_insert.sql: `:new_id` is a fresh id per statement, not the series id"
        )
    if (MODULE_DIR / "commands" / "recurring_create.sql").exists():
        fail("commands/recurring_create.sql: the bare door must be gone")


def check_i18n() -> None:
    code = "appointments.staff_not_eligible"
    if code not in (MANIFEST.get("errors") or {}):
        fail(f"module.json: errors[{code!r}] not declared")
    texts = {}
    for lang in ("en", "es"):
        texts[lang] = (
            json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text()).get(
                "errors"
            )
            or {}
        ).get(code)
        if not texts[lang]:
            fail(f"locales/{lang}.json: errors[{code!r}] is missing")
    if texts.get("en") and texts.get("en") == texts.get("es"):
        fail(f"locales/es.json: errors[{code!r}] is still the English text")


def main() -> int:
    cmd = MANIFEST["commands"].get(CREATE)
    if not isinstance(cmd, dict):
        fail(f"{CREATE}: not declared")
    else:
        check_handler(cmd)
        check_reads(cmd)
    check_insert()
    check_i18n()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK: recurring.create judges the professional through required reads")
    return 0


if __name__ == "__main__":
    sys.exit(main())
