#!/usr/bin/env python3
"""Slot holds stay retired (appointments#184, follows appointments#183).

WHAT HAPPENED. A «hold» set a slot aside for a few minutes while somebody at the salon decided on a
booking request that arrived through WhatsApp: `appointments.slots.hold` wrote the row,
`slots.release_hold` gave it back, a scheduled task expired it, and every availability read and
booking door refused the held slot with `appointments.slot_on_hold`. appointments#183 retired the
requests door, and with it the only caller of `slots.hold`. What was left still showed the owner a
setting («Hold a slot for (minutes)») that changed nothing, and ran a task every five minutes for
rows nobody creates any more.

WHAT THIS GUARDS. That none of it comes back by accident — a revert, a stale merge, a copy from an
old branch — checked where each piece would be declared or shipped:

  1. the commands `slots.hold`, `slots.release_hold`, `slots.expire_holds`, their SQL and schemas,
     and the scheduled task that ran the expiry;
  2. the events `appointments.slot.held` / `appointments.slot.hold_released`;
  3. the reads `appointments.slot_holds.live|upcoming` and every read a command declares on them;
  4. the availability engine: no `appointments_slot_hold` in its SQL, no `held` verdict, no
     `exclude_hold_ref` parameter in the queries, the schemas or the manifest params;
  5. the setting `hold_minutes`: not in the settings schema (the Settings screen is drawn from it),
     not read by `settings.get`, not written by `settings.upsert`, and without its `en`/`es` text;
  6. the error `appointments.slot_on_hold`: GONE — ADR-0398 retires a published code in two
     releases, #184 marked it `deprecated` in 1.1.91 and #187 deleted it with its `en`/`es` text;
  7. the handler: no `holds_from`, no read of the hold queries, in the Rust source and in the built
     `handler.wasm`.

The TABLE `appointments_slot_hold` and the COLUMN `appointments_settings.hold_minutes` are set aside
by `011_drop_slot_hold_storage.sql` (appointments#187); `slot_hold_storage_retired.postgres.test.py`
pins that migration.

Usage: tests/slot_holds_retired.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

RETIRED_COMMANDS = (
    "appointments.slots.hold",
    "appointments.slots.release_hold",
    "appointments.slots.expire_holds",
)
RETIRED_QUERIES = ("appointments.slot_holds.live", "appointments.slot_holds.upcoming")
RETIRED_FILES = (
    "commands/slot_hold_upsert.sql",
    "commands/slot_hold_release.sql",
    "commands/slot_hold_expire.sql",
    "schemas/slot_hold.json",
    "schemas/slot_release_hold.json",
    "queries/slot_holds_live.sql",
    "queries/slot_holds_upcoming.sql",
)
RETIRED_EVENTS = ("appointments.slot.held", "appointments.slot.hold_released")
RETIRED_ERROR = "appointments.slot_on_hold"
RETIRED_SETTING = "hold_minutes"
RETIRED_PARAM = "exclude_hold_ref"
HOLD_TABLE = "appointments_slot_hold"
ENGINE_SQL = ("queries/availability_check.sql", "queries/availability_slots.sql")
SETTINGS_SQL = ("queries/settings_get.sql", "commands/settings_upsert.sql")
AVAILABILITY_SCHEMAS = (
    "schemas/availability_check.json",
    "schemas/availability_slots.json",
)

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def sql_without_comments(text: str) -> str:
    """Only real SQL counts: the comments may keep telling the story of what was retired."""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"--[^\n]*", " ", text)


def check_commands_and_task() -> None:
    commands = MANIFEST.get("commands") or {}
    for name in RETIRED_COMMANDS:
        if name in commands:
            fail(f"commands: {name!r} is back — nobody sets a slot aside any more")
    for rel in RETIRED_FILES:
        if (MODULE_DIR / rel).exists():
            fail(f"{rel}: still in the module")
    for task in MANIFEST.get("scheduled_tasks") or []:
        if task.get("command") in RETIRED_COMMANDS:
            fail(
                f"scheduled_tasks: {task.get('name')!r} still runs {task.get('command')!r}"
            )


def check_events() -> None:
    events = MANIFEST.get("events") or {}
    for name in RETIRED_EVENTS:
        if name in (events.get("emits") or []):
            fail(f"events.emits: {name!r} — no hold is ever taken or given back")
    for command, spec in (MANIFEST.get("commands") or {}).items():
        for name in spec.get("emit") or []:
            if name in RETIRED_EVENTS:
                fail(f"commands.{command}.emit: {name!r}")


def check_reads() -> None:
    queries = MANIFEST.get("queries") or {}
    for name in RETIRED_QUERIES:
        if name in queries:
            fail(f"queries: {name!r} — it reads holds nobody creates")
    for command, spec in (MANIFEST.get("commands") or {}).items():
        for read in spec.get("reads") or []:
            if read.get("query") in RETIRED_QUERIES:
                fail(f"commands.{command}.reads: still loads {read.get('query')!r}")
            if RETIRED_PARAM in (read.get("params") or {}):
                fail(f"commands.{command}.reads: still passes {RETIRED_PARAM!r}")


def check_engine() -> None:
    for rel in ENGINE_SQL:
        sql = sql_without_comments((MODULE_DIR / rel).read_text())
        if HOLD_TABLE in sql:
            fail(f"{rel}: still reads {HOLD_TABLE}")
        if RETIRED_PARAM in sql:
            fail(f"{rel}: still binds :{RETIRED_PARAM}")
        if re.search(r"'held'", sql):
            fail(f"{rel}: can still answer the verdict 'held'")
    for rel in AVAILABILITY_SCHEMAS:
        props = json.loads((MODULE_DIR / rel).read_text()).get("properties") or {}
        if RETIRED_PARAM in props:
            fail(f"{rel}: still accepts {RETIRED_PARAM!r}")
    manifest_text = json.dumps(MANIFEST)
    if "`held`" in manifest_text or "or held" in manifest_text:
        fail("module.json: a description still promises the verdict `held`")


def check_setting() -> None:
    schema = json.loads((MODULE_DIR / "schemas" / "settings_upsert.json").read_text())
    if RETIRED_SETTING in (schema.get("properties") or {}):
        fail(
            f"schemas/settings_upsert.json: {RETIRED_SETTING!r} is still on the Settings screen, "
            "where it changes nothing"
        )
    for rel in SETTINGS_SQL:
        if RETIRED_SETTING in sql_without_comments((MODULE_DIR / rel).read_text()):
            fail(f"{rel}: still reads or writes {RETIRED_SETTING}")
    for lang in ("en", "es"):
        catalog = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text())
        fields = (catalog.get("settings") or {}).get("fields") or {}
        if RETIRED_SETTING in fields:
            fail(
                f"locales/{lang}.json: settings.fields.{RETIRED_SETTING} — no field paints it"
            )


def check_error() -> None:
    if RETIRED_ERROR in (MANIFEST.get("errors") or {}):
        fail(
            f"module.json: errors.{RETIRED_ERROR} is still declared — it was deprecated in 1.1.91 "
            "and ADR-0398 deletes it in the next release"
        )
    for lang in ("en", "es"):
        catalog = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text())
        if RETIRED_ERROR in (catalog.get("errors") or {}):
            fail(f"locales/{lang}.json: errors.{RETIRED_ERROR} — no code produces it any more")


def check_handler() -> None:
    source = (MODULE_DIR / "handler" / "src" / "lib.rs").read_text()
    if "fn holds_from(" in source:
        fail("handler/src/lib.rs: `holds_from` is still there")
    if f'"{RETIRED_ERROR}"' in source:
        fail(f"handler/src/lib.rs: still produces the deprecated {RETIRED_ERROR!r}")
    for name in RETIRED_QUERIES:
        if name in source:
            fail(f"handler/src/lib.rs: still reads {name!r}")
    if '"held"' in source:
        fail('handler/src/lib.rs: still ranks the verdict "held"')
    wasm = MODULE_DIR / "dist" / "handler.wasm"
    if wasm.exists() and b"slot_holds" in wasm.read_bytes():
        fail("dist/handler.wasm still reads the slot holds: rebuild the handler")


def main() -> int:
    check_commands_and_task()
    check_events()
    check_reads()
    check_engine()
    check_setting()
    check_error()
    check_handler()
    if failures:
        print("FAIL slot_holds_retired:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("OK slot_holds_retired: slot holds stay retired")
    return 0


if __name__ == "__main__":
    sys.exit(main())
