#!/usr/bin/env python3
"""`appointments.appointments.create` contract test (appointments#11) — the three links of a
booking are RESOLVED against the hub's records, not told by the browser.

The handler (`create_appointment` in `handler/src/lib.rs`, unit-tested there) freezes the
customer/service/professional snapshot from the reads the runtime pre-loads (ADR-0069). A read
that is not declared, not `required`, not filtered by the payload id, or whose owner module is
not in `depends_on`, fails at RUNTIME, silently (hub#610: a read outside `depends_on` is omitted
without error). This file pins that wiring:

  1. MANIFEST. `create` declares the four catalogue reads, each `required` and filtered by the
     payload id, and every read's owner is in `depends_on`.
  2. I18N. Every domain code the handler can answer with has an English source string and its
     Spanish translation under `errors` in `locales/{en,es}.json` (ADR-0055).

Usage: tests/create_links.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

COMMAND = "appointments.appointments.create"
# query -> {param name: payload expression}
CATALOGUE_READS = {
    "customers.get": {"customer_id": "payload.customer_id"},
    "services.services.get": {"service_id": "payload.service_id"},
    "staff.members.get": {"staff_id": "payload.staff_id"},
    "staff.services.eligible_for_service": {"service_id": "payload.service_id"},
}
DOMAIN_CODES = (
    "appointments.catalog_unavailable",
    "appointments.customer_not_found",
    "appointments.service_not_found",
    "appointments.service_not_bookable",
    "appointments.staff_not_found",
    "appointments.staff_not_bookable",
    "appointments.staff_not_eligible",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def check_manifest() -> None:
    cmd = MANIFEST.get("commands", {}).get(COMMAND)
    if not isinstance(cmd, dict):
        fail(f"{COMMAND}: not declared")
        return
    handler = cmd.get("handler")
    if not isinstance(handler, dict) or handler.get("function") != "create_appointment":
        fail(
            f"{COMMAND}: must run the WASM handler `create_appointment` (got {handler!r})"
        )

    depends_on = set(MANIFEST.get("depends_on", []))
    reads = {r.get("query"): r for r in cmd.get("reads", []) if isinstance(r, dict)}
    for query, params in CATALOGUE_READS.items():
        owner = query.split(".")[0]
        if owner not in depends_on:
            fail(
                f"depends_on: `{owner}` missing — the read {query!r} would be omitted (hub#610)"
            )
        read = reads.get(query)
        if read is None:
            fail(f"{COMMAND}.reads: missing {query!r}")
            continue
        if read.get("required") is not True:
            fail(
                f"{COMMAND}.reads[{query}]: must be `required` — no catalogue, no booking"
            )
        for name, expr in params.items():
            if (read.get("params") or {}).get(name) != expr:
                fail(f"{COMMAND}.reads[{query}]: params.{name} must be {expr!r}")


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
    check_manifest()
    check_i18n()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK: appointments.appointments.create resolves its links through required reads"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
