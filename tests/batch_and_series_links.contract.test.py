#!/usr/bin/env python3
"""`bulk_create` / `recurring.materialize` contract test (appointments#54) — a BATCH and a SERIES
resolve their links exactly like `create`.

appointments#11 made `create` authoritative and left these two behind: `reads.params` only accepts
a top-level `payload.<field>`, so a batch with its ids buried per item, and a series whose whole
template travelled in the payload, went on writing `customer_name` / `service_name` /
`service_price` / `staff_name` as they arrived. The fix was the SHAPE, not the runtime: the three
ids move to the top level and both commands declare the same reads as `create`.

The handler logic is unit-tested in `handler/src/lib.rs`. What fails SILENTLY at runtime is the
wiring, and that is what this file pins (hub#610: a read whose owner is not in `depends_on` is
omitted without error; a read that is not `required` degrades instead of refusing):

  1. MANIFEST. Both commands run their WASM handler and declare the catalogue reads, each
     `required` and filtered by a TOP-LEVEL payload id, with every owner in `depends_on`.
  2. SCHEMA. The three ids are required top-level strings, and no payload may carry a name or a
     price any more — those are the fields the browser used to dictate.
  3. SERIES. `materialize` loads its template by id through `appointments.recurring.get`, which
     must exist as a query and must NOT filter by `is_active` (an inactive template has to reach
     the handler so the refusal is `recurring_inactive`, not `recurring_not_found`).
  4. I18N. Every domain code these two paths can answer with has an English source string and its
     Spanish translation under `errors` in `locales/{en,es}.json` (ADR-0055).

Usage: tests/batch_and_series_links.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

BULK = "appointments.appointments.bulk_create"
MATERIALIZE = "appointments.recurring.materialize"
RECURRING_GET = "appointments.recurring.get"

# The catalogue reads `create` declares, now shared by both commands, keyed by the TOP-LEVEL
# payload field they filter by.
CATALOGUE_READS = {
    "customers.get": {"customer_id": "payload.customer_id"},
    "services.services.get": {"service_id": "payload.service_id"},
    "staff.members.get": {"staff_id": "payload.staff_id"},
    "staff.services.eligible_for_service": {"service_id": "payload.service_id"},
}
# The booking policy is read, never told (appointments#10).
POLICY_READ = "appointments.settings.get"

HANDLERS = {BULK: "bulk_create", MATERIALIZE: "materialize_recurring"}
SCHEMAS = {
    BULK: "schemas/appointment_bulk_create.json",
    MATERIALIZE: "schemas/recurring_materialize.json",
}
# Fields no payload of these two commands may accept any more: the browser named the customer, the
# service and the price with them.
FORBIDDEN_FIELDS = (
    "customer_name",
    "customer_phone",
    "customer_email",
    "service_name",
    "service_price",
    "staff_name",
    "service",
    "settings",
    "recurring",
)
DOMAIN_CODES = (
    "appointments.catalog_unavailable",
    "appointments.customer_not_found",
    "appointments.service_not_found",
    "appointments.service_not_bookable",
    "appointments.staff_not_found",
    "appointments.staff_not_bookable",
    "appointments.staff_not_eligible",
    "appointments.settings_unavailable",
    "appointments.recurring_unavailable",
    "appointments.recurring_not_found",
    "appointments.recurring_inactive",
    "appointments.recurring_mismatch",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def check_command(name: str) -> None:
    cmd = MANIFEST.get("commands", {}).get(name)
    if not isinstance(cmd, dict):
        fail(f"{name}: not declared")
        return

    handler = cmd.get("handler")
    if not isinstance(handler, dict) or handler.get("function") != HANDLERS[name]:
        fail(f"{name}: must run the WASM handler {HANDLERS[name]!r} (got {handler!r})")

    depends_on = set(MANIFEST.get("depends_on", []))
    reads = {r.get("query"): r for r in cmd.get("reads", []) if isinstance(r, dict)}

    for query, params in CATALOGUE_READS.items():
        owner = query.split(".")[0]
        if owner not in depends_on:
            fail(
                f"depends_on: {owner!r} missing — the read {query!r} would be omitted (hub#610)"
            )
        read = reads.get(query)
        if read is None:
            fail(
                f"{name}.reads: missing {query!r} — the batch would invent the snapshot again"
            )
            continue
        if read.get("required") is not True:
            fail(
                f"{name}.reads[{query}]: must be `required` — no catalogue, no booking"
            )
        for param, expr in params.items():
            if (read.get("params") or {}).get(param) != expr:
                fail(f"{name}.reads[{query}]: params.{param} must be {expr!r}")

    policy = reads.get(POLICY_READ)
    if policy is None or policy.get("required") is not True:
        fail(
            f"{name}.reads: {POLICY_READ!r} must be declared and `required` (appointments#10)"
        )


def check_schema(name: str) -> None:
    schema_path = MANIFEST.get("commands", {}).get(name, {}).get("schema")
    if schema_path != SCHEMAS[name]:
        fail(f"{name}.schema: must be {SCHEMAS[name]!r} (got {schema_path!r})")
        return
    schema = json.loads((MODULE_DIR / schema_path).read_text())
    props = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    for field in ("customer_id", "service_id", "staff_id"):
        if field not in required:
            fail(
                f"{schema_path}: {field!r} must be REQUIRED at the top level (reads.params)"
            )
        if (props.get(field) or {}).get("type") != "string":
            fail(f"{schema_path}: {field!r} must be a top-level string")

    # Anywhere in the document, nested `items` included.
    for field in FORBIDDEN_FIELDS:
        if _declares(schema, field):
            fail(
                f"{schema_path}: still accepts {field!r} — the caller must not name it"
            )


def _declares(node: object, field: str) -> bool:
    """True when `field` appears as a declared property anywhere in the schema."""
    if isinstance(node, dict):
        if field in (node.get("properties") or {}):
            return True
        return any(_declares(v, field) for v in node.values())
    if isinstance(node, list):
        return any(_declares(v, field) for v in node)
    return False


def check_recurring_get() -> None:
    query = MANIFEST.get("queries", {}).get(RECURRING_GET)
    if not isinstance(query, dict):
        fail(
            f"{RECURRING_GET}: not declared — materialize has no authoritative template"
        )
        return
    sql_path = query.get("sql")
    if not sql_path:
        fail(f"{RECURRING_GET}: no sql file")
        return
    sql = (MODULE_DIR / sql_path).read_text()
    if ":recurring_id" not in sql:
        fail(f"{sql_path}: must filter by :recurring_id")
    if ":hub_id" not in sql:
        fail(f"{sql_path}: must be scoped by :hub_id")
    if re.search(r"is_active\s*=", sql):
        fail(
            f"{sql_path}: must NOT filter by is_active — an inactive template has to reach the "
            "handler so the refusal is `recurring_inactive`, not `recurring_not_found`"
        )
    for column in ("customer_id", "service_id", "staff_id"):
        if column not in sql:
            fail(
                f"{sql_path}: must select {column} (the handler contrasts it with the payload)"
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
    for name in (BULK, MATERIALIZE):
        check_command(name)
        check_schema(name)
    check_recurring_get()
    check_i18n()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK: bulk_create and recurring.materialize resolve their links through required reads"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
