#!/usr/bin/env python3
"""`appointments.appointments.cancel` contract test (appointments#6) — the cancellation policy.

Why this file exists: `cancellation_notice_hours` and `allow_customer_cancellation` had been in
the settings row since day one, and nothing read them: `cancel` was a plain UPDATE that ignored
who was asking and how far ahead. The policy now lives in the WASM handler (`cancel_appointment`
in `handler/src/lib.rs`, unit-tested there); THIS file pins the wiring the handler depends on,
because a handler whose reads or intentions do not resolve fails at runtime, not at compile time:

  1. MANIFEST. The command runs the handler (no declarative `sql`/`expect_rows` left behind that
     would double-apply), declares the two REQUIRED reads the handler decides with (the
     appointment row filtered by `payload.appointment_id`, and the settings singleton), and the
     two internal commands the handler emits as intentions exist with the SAME permission as the
     public command (hub#459: the command's permission is the ceiling of everything its ops touch).

  2. PAYLOAD. `schemas/appointment_cancel.json` accepts the `channel` discriminator
     (`staff` | `customer`, default `staff`) — the agenda screen keeps sending only
     `{appointment_id, reason}` and stays on the staff path.

  3. I18N. The three domain codes the handler can answer with have an English source string and
     its Spanish translation under `errors` in `locales/{en,es}.json` (ADR-0055).

  4. REAL POSTGRES. The two intentions run against a scratch database built from this module's
     migrations: the row flips to `cancelled` with its reason, and the history line records the
     channel. Zero mocks; the layer is SKIPPED (never passed) without the test container.

Usage: tests/cancel.contract.test.py   (exit 0 = green)
"""

import json
import os
import pathlib
import re
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

COMMAND = "appointments.appointments.cancel"
ROW_OP = "appointments._cancel_row"
HISTORY_OP = "appointments._history_cancel"
GET_QUERY = "appointments.appointments.get"
SETTINGS_QUERY = "appointments.settings.get"
DOMAIN_CODES = (
    "appointments.cannot_cancel",
    "appointments.cancellation_notice_required",
    "appointments.customer_cancellation_disabled",
)

CONTAINER = os.environ.get("APPOINTMENTS_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_cancel_test_{os.getpid()}"
HUB = "hub-under-test"
USER = "u-owner"
NOW = "2026-08-18T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


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
    if not isinstance(handler, dict) or handler.get("function") != "cancel_appointment":
        fail(
            f"{COMMAND}: must run the WASM handler `cancel_appointment` (got {handler!r})"
        )
    for leftover in ("sql", "expect_rows", "min_affected_rows"):
        if leftover in cmd:
            fail(
                f"{COMMAND}.{leftover}: leftover of the declarative command — the handler owns it now"
            )

    reads = {r.get("query"): r for r in cmd.get("reads", []) if isinstance(r, dict)}
    row = reads.get(GET_QUERY)
    if row is None:
        fail(
            f"{COMMAND}.reads: missing {GET_QUERY!r} (the state guard and the start time)"
        )
    else:
        if row.get("params", {}).get("appointment_id") != "payload.appointment_id":
            fail(
                f"{COMMAND}.reads[{GET_QUERY}]: must filter by `payload.appointment_id`"
            )
        if row.get("required") is not True:
            fail(
                f"{COMMAND}.reads[{GET_QUERY}]: must be `required` — no row, no decision"
            )
    settings = reads.get(SETTINGS_QUERY)
    if settings is None:
        fail(f"{COMMAND}.reads: missing {SETTINGS_QUERY!r} (the policy)")
    elif settings.get("required") is not True:
        fail(f"{COMMAND}.reads[{SETTINGS_QUERY}]: must be `required`")

    for name in (ROW_OP, HISTORY_OP):
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

    if "appointments.appointment.cancelled" not in cmd.get("emit", []):
        fail(f"{COMMAND}.emit: must still emit `appointments.appointment.cancelled`")


# ── Layer 2: payload schema ──────────────────────────────────────────────────────────────


def check_schema() -> None:
    rel = MANIFEST.get("commands", {}).get(COMMAND, {}).get("schema")
    if not rel or not (MODULE_DIR / rel).exists():
        fail(f"{COMMAND}.schema: {rel!r} is not in the package")
        return
    schema = json.loads((MODULE_DIR / rel).read_text())
    channel = (schema.get("properties") or {}).get("channel")
    if not isinstance(channel, dict):
        fail(
            f"{rel}: no `channel` property — the customer channel cannot declare itself"
        )
        return
    if sorted(channel.get("enum", [])) != ["customer", "staff"]:
        fail(
            f"{rel}: channel.enum must be exactly ['staff','customer'], got {channel.get('enum')!r}"
        )
    if channel.get("default") != "staff":
        fail(
            f"{rel}: channel.default must be 'staff' (the agenda screen sends no channel)"
        )
    if "channel" in schema.get("required", []):
        fail(
            f"{rel}: channel must NOT be required — existing callers send only appointment_id"
        )


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


# ── Layer 4: the two intentions against a real Postgres ──────────────────────────────────


def docker_available() -> bool:
    try:
        res = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return False
    return res.returncode == 0 and res.stdout.strip() == "true"


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
    ]
    if db:
        cmd += ["-d", db]
    cmd += args
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def run_op(name: str, params: dict) -> None:
    spec = MANIFEST["commands"][name]
    body = "\n".join(
        bind((MODULE_DIR / rel).read_text(), params) for rel in spec.get("sql", [])
    )
    psql(["-c", f"BEGIN; {body} COMMIT;"], db=DB)


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def check_against_postgres() -> None:
    if failures:
        return
    if not docker_available():
        notes.append(f"SKIPPED Postgres layer: container {CONTAINER!r} is not running")
        return
    base = {"hub_id": HUB, "current_user_id": USER, "now": NOW}
    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for rel in MANIFEST.get("migrations", {}).get("postgres", []):
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
        psql(
            [
                "-c",
                "INSERT INTO appointments_appointment (id, hub_id, customer_name, service_name, "
                "start_datetime, end_datetime, duration_minutes, status, created_at) VALUES "
                f"('apt-1', {literal(HUB)}, 'Ada', 'Cut', '2026-08-20T10:00:00+02:00', "
                "'2026-08-20T10:30:00+02:00', 30, 'confirmed', '2026-08-01T00:00:00+02:00')",
            ],
            db=DB,
        )
        # The handler's two intentions, in the order it emits them, one transaction.
        run_op(ROW_OP, {**base, "appointment_id": "apt-1", "reason": 'sick "again"'})
        run_op(
            HISTORY_OP,
            {**base, "new_id": "h-1", "appointment_id": "apt-1", "channel": "customer"},
        )

        status = scalar(
            "SELECT status FROM appointments_appointment WHERE id = 'apt-1'"
        )
        if status != "cancelled":
            fail(f"{ROW_OP}: status is {status!r}, expected 'cancelled'")
        reason = scalar(
            "SELECT cancellation_reason FROM appointments_appointment WHERE id = 'apt-1'"
        )
        if reason != 'sick "again"':
            fail(f"{ROW_OP}: cancellation_reason is {reason!r}")
        history = scalar(
            "SELECT new_value FROM appointments_history WHERE appointment_id = 'apt-1' AND action = 'cancelled'"
        )
        if not history:
            fail(f"{HISTORY_OP}: wrote no history line")
        else:
            try:
                parsed = json.loads(history)
            except json.JSONDecodeError:
                fail(f"{HISTORY_OP}: new_value is not JSON: {history!r}")
                parsed = {}
            if parsed.get("channel") != "customer":
                fail(
                    f"{HISTORY_OP}: new_value.channel is {parsed.get('channel')!r}, expected 'customer'"
                )
            if parsed.get("status") != "cancelled":
                fail(f"{HISTORY_OP}: new_value.status is {parsed.get('status')!r}")

        # Terminal state: the row op is a no-op and its history line is pinned to the run (nothing).
        run_op(
            ROW_OP,
            {
                **base,
                "now": "2026-08-18T10:00:00+02:00",
                "appointment_id": "apt-1",
                "reason": "twice",
            },
        )
        reason = scalar(
            "SELECT cancellation_reason FROM appointments_appointment WHERE id = 'apt-1'"
        )
        if reason != 'sick "again"':
            fail(
                f"{ROW_OP}: a second cancel rewrote the reason ({reason!r}) on an already-cancelled row"
            )
        notes.append(f"postgres layer ran on {CONTAINER} ({DB})")
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)'])


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    check_manifest()
    check_schema()
    check_i18n()
    check_against_postgres()
    for note in notes:
        print(f"  · {note}")
    print()
    if failures:
        print(f"FAILED — {len(failures)} violation(s) of the cancel contract:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — appointments v{MANIFEST.get('version')}: cancel policy wired (handler + reads + i18n)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
