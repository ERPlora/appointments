#!/usr/bin/env python3
"""`appointments.appointments.reschedule` contract test (appointments#142) — whose appointment.

Why this file exists: appointments#140 made a cancellation asked «as the customer» prove WHOSE
appointment it is, and left `reschedule` — the other half of the same door — untouched, so any
caller holding an appointment id still moved a stranger's chair to another hour. The rule itself
lives in the WASM handler (`customer_identity_refusal`, shared with `cancel_appointment`, and
unit-tested in `handler/src/lib.rs`); THIS file pins the wiring around it, because a handler whose
reads or payload do not resolve fails at runtime, not at compile time:

  1. MANIFEST. The command runs the handler, and the read the identity gate decides with — the
     appointment row filtered by `payload.appointment_id` — is declared and REQUIRED. Without that
     read there is no `customer_id` to compare against and the gate is blind. The internal
     commands the handler emits as intentions carry the SAME permission as the public command
     (hub#459: the command's permission is the ceiling of everything its ops touch).

  2. PAYLOAD. `schemas/appointment_reschedule.json` accepts the `channel` discriminator
     (`staff` | `customer`, default `staff`) — the agenda screen keeps sending only
     `{appointment_id, start_datetime}` and stays on the staff path — AND the `customer_id` the
     customer channel identifies itself with. `additionalProperties` is false, so a field the
     schema does not declare never reaches the handler that checks it: the identity gate would be
     dead code behind a rejected payload. That is exactly how this hole was born.

  3. I18N. The domain codes the handler can answer with have an English source string and its
     Spanish translation under `errors` in `locales/{en,es}.json` (ADR-0055), and every one of
     them is declared in the manifest's `errors` block.

The intentions themselves against a real Postgres are already covered, chain and gates included,
by `tests/command_chains.postgres.test.py`; this file does not repeat them.

Usage: tests/reschedule.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

COMMAND = "appointments.appointments.reschedule"
HANDLER_FN = "reschedule_appointment"
GET_QUERY = "appointments.appointments.get"
INTENTIONS = (
    "appointments._reschedule_state_assert",
    "appointments._reschedule_row",
    "appointments._appointment_overlap_assert",
    "appointments._history_reschedule",
    "appointments._gate_clear",
)
DOMAIN_CODES = (
    "appointments.cannot_reschedule",
    # appointments#142: the appointment is not this customer's to move.
    "appointments.customer_mismatch",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest wiring ─────────────────────────────────────────────────────────────


def check_manifest() -> None:
    commands = MANIFEST.get("commands", {})
    cmd = commands.get(COMMAND)
    if not isinstance(cmd, dict):
        fail(f"{COMMAND}: not declared")
        return
    handler = cmd.get("handler")
    if not isinstance(handler, dict) or handler.get("function") != HANDLER_FN:
        fail(f"{COMMAND}: must run the WASM handler `{HANDLER_FN}` (got {handler!r})")
    for leftover in ("sql", "expect_rows", "min_affected_rows"):
        if leftover in cmd:
            fail(
                f"{COMMAND}.{leftover}: leftover of the declarative command — the handler owns it now"
            )

    reads = {r.get("query"): r for r in cmd.get("reads", []) if isinstance(r, dict)}
    row = reads.get(GET_QUERY)
    if row is None:
        fail(
            f"{COMMAND}.reads: missing {GET_QUERY!r} — the identity gate compares the caller "
            f"against the appointment's OWN customer_id, which only this read carries"
        )
    else:
        if row.get("params", {}).get("appointment_id") != "payload.appointment_id":
            fail(
                f"{COMMAND}.reads[{GET_QUERY}]: must filter by `payload.appointment_id`"
            )
        if row.get("required") is not True:
            fail(
                f"{COMMAND}.reads[{GET_QUERY}]: must be `required` — no row, no owner, no decision"
            )

    for name in INTENTIONS:
        op = commands.get(name)
        if not isinstance(op, dict):
            fail(
                f"{name}: the handler emits it as an intention but the manifest does not declare it"
            )
            continue
        if op.get("permission") != cmd.get("permission"):
            fail(
                f"{name}.permission ({op.get('permission')!r}) != {COMMAND}.permission "
                f"({cmd.get('permission')!r}) — hub#459 ceiling"
            )
        for rel in op.get("sql", []):
            if not (MODULE_DIR / rel).exists():
                fail(f"{name}.sql: {rel!r} is not in the package")
        if not op.get("sql"):
            fail(f"{name}: declares no sql")

    if "appointments.appointment.rescheduled" not in cmd.get("emit", []):
        fail(f"{COMMAND}.emit: must still emit `appointments.appointment.rescheduled`")

    ai = cmd.get("ai")
    if isinstance(ai, dict):
        text = (ai.get("description") or "").lower()
        if "customer_id" not in text:
            fail(
                f"{COMMAND}.ai.description: says nothing about `customer_id` — the assistant "
                f"composes the payload and would keep sending moves the handler refuses"
            )


# ── Layer 2: payload schema ──────────────────────────────────────────────────────────────


def check_schema() -> None:
    rel = MANIFEST.get("commands", {}).get(COMMAND, {}).get("schema")
    if not rel or not (MODULE_DIR / rel).exists():
        fail(f"{COMMAND}.schema: {rel!r} is not in the package")
        return
    schema = json.loads((MODULE_DIR / rel).read_text())
    properties = schema.get("properties") or {}
    required = schema.get("required", [])

    channel = properties.get("channel")
    if not isinstance(channel, dict):
        fail(f"{rel}: no `channel` property — the customer channel cannot declare itself")
    else:
        if sorted(channel.get("enum", [])) != ["customer", "staff"]:
            fail(
                f"{rel}: channel.enum must be exactly ['staff','customer'], got {channel.get('enum')!r}"
            )
        if channel.get("default") != "staff":
            fail(
                f"{rel}: channel.default must be 'staff' (the agenda screen sends no channel)"
            )
    if "channel" in required:
        fail(
            f"{rel}: channel must NOT be required — the agenda screen sends only the id and the start"
        )

    # The handler refuses a `channel: customer` move that does not name the customer the
    # appointment belongs to — but it only ever sees the field if the schema declares it:
    # `additionalProperties: false` rejects the payload before the handler runs.
    customer = properties.get("customer_id")
    if not isinstance(customer, dict):
        fail(
            f"{rel}: no `customer_id` property — with additionalProperties false the customer "
            f"channel cannot say whose appointment it is and the identity gate is unreachable"
        )
    elif customer.get("type") != "string":
        fail(f"{rel}: customer_id.type must be 'string', got {customer.get('type')!r}")
    if "customer_id" in required:
        fail(
            f"{rel}: customer_id must NOT be required at schema level — the agenda screen moves "
            f"appointments on the staff channel without one; the customer channel is bound by the handler"
        )
    # appointments#165 / #156: the move panel is the counter and declares what `create` lets it
    # declare. Undeclared here, the handler never sees them: the whole payload is rejected.
    for flag in ("allow_past", "allow_short_notice"):
        prop = properties.get(flag)
        if not isinstance(prop, dict):
            fail(
                f"{rel}: no `{flag}` property — the counter cannot declare it when it moves an "
                f"appointment, and additionalProperties false rejects the whole payload"
            )
            continue
        if prop.get("type") != "boolean":
            fail(f"{rel}: {flag}.type must be 'boolean', got {prop.get('type')!r}")
        if prop.get("default") is not False:
            fail(f"{rel}: {flag}.default must be false — only the counter screen declares it")
        if flag in required:
            fail(f"{rel}: {flag} must NOT be required — the customer channel never sends it")
    if schema.get("additionalProperties") is not False:
        fail(f"{rel}: additionalProperties must stay false — the payload is a closed contract")


# ── Layer 3: i18n of the domain codes ────────────────────────────────────────────────────


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

    declared = MANIFEST.get("errors") or {}
    for code in DOMAIN_CODES:
        if code not in declared:
            fail(f"module.json errors: {code!r} is not declared")


def main() -> int:
    check_manifest()
    check_schema()
    check_i18n()
    if failures:
        print(f"✗ {COMMAND}: {len(failures)} problem(s)")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"✓ {COMMAND}: identity wiring, payload contract and i18n are in place")
    return 0


if __name__ == "__main__":
    sys.exit(main())
