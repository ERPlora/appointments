#!/usr/bin/env python3
"""appointments#149 — flipping ONE setting from another screen must not wipe the other twelve.

WHAT WENT WRONG. `appointments.settings.upsert` is the only door into the salon's booking
settings, and it takes the WHOLE form. That is right for the Settings tab, which paints every
field and sends the full snapshot back, and wrong for everybody else: the runtime materialises
the JSON Schema `default` of every key the caller omitted (ADR-0073,
`crates/runtime/src/registry.rs::apply_defaults`) and the SQL writes `excluded.<column>` for all
of them. So a foreign screen that only wants to flip «confirm bookings made by the customer
automatically» sends `{"auto_confirm_online": false}` and silently resets the other twelve
settings to factory values:

    default_duration 45 -> 60 · slot_interval 30 -> 15 · calendar_end_hour 22 -> 20 · …

Measured against origin/main@39b13fa: 12 of 12. Nobody sees it — the write succeeds, the event
fires, and the salon finds out when a booking lands at 20:30 in a calendar that used to close at
22:00. whatsapp_inbox#123 needs exactly that flip (the WhatsApp screen offers «appointments
confirm themselves / I review them»), so without a narrow door the two screens overwrite each
other by design.

THE DOOR THIS FILE PINS. `appointments.settings.set_auto_confirm_online`: one boolean, the same
permission that gates `settings.upsert`, the same `appointments.settings.updated` event, and SQL
that writes that one column and the audit trail. Nothing else.

WHY NOT `patch` (hub#632). PATCH completion is declared per RECORD (`records.<x>.patch`, resolved
through the record whose `update` is the command); the settings singleton is not a record — it is
the `settings` block (ADR-0082) — so turning `upsert` into a partial door means publishing the
settings row as a record first. A narrow command is also the stronger contract for a foreign
caller: it CANNOT touch anything else, not even by mistake, and the permission it needs is the one
it actually uses.

WHAT IS CHECKED, four layers:

  1. THE CONTRACT (no container). The command exists, takes exactly one boolean under
     `additionalProperties: false`, is gated by the same permission as `settings.upsert`, runs in
     a transaction, emits the settings event the module declares, and its `expect_rows` code is
     declared in `errors` AND translated in `en` + `es`. Plus the STATIC half of the guard: the
     SQL may assign `auto_confirm_online`, the audit columns and the singleton's identity — a
     mutant that adds `default_duration = excluded.default_duration` to the `SET` dies here even
     with no Postgres around.

  2. THE ROW IS NOT CLOBBERED (real Postgres). A salon whose thirteen settings all differ from
     their factory value flips the switch through the narrow door: the flag moves, the audit
     columns move, and every other column of the table is byte-identical. The same scenario
     driven through `settings.upsert` — the door that exists today, with the runtime's defaults
     applied — is asserted to CLOBBER: this test refuses to pass by finding nothing.

  3. THE HUB THAT NEVER SAVED SETTINGS. The narrow door on an empty table creates the singleton
     with the value asked for and with exactly what `settings.upsert` would have written from an
     empty form. Compared against a control row, not against a list of numbers copied by hand.

  4. TENANCY AND SOFT-DELETE. The write reaches one hub only, and a settings row that is
     soft-deleted affects 0 rows — which is what `expect_rows` turns into the declared error
     instead of a silent write into a row nobody can read.

Usage: tests/settings_narrow_write.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  throwaway database and DROPS it at the end, pass or fail. Without the container layers 2-4 are
  SKIPPED — never counted as passed. Layer 1 runs regardless.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_settings_narrow_write_test_{os.getpid()}"

NARROW = "appointments.settings.set_auto_confirm_online"
UPSERT = "appointments.settings.upsert"
FLAG = "auto_confirm_online"

NOW = "2026-09-08T09:00:00+02:00"
LATER = "2026-09-08T18:30:00+02:00"

# The columns a narrow write is allowed to touch: the flag, the audit trail and — only on the
# INSERT branch, when the hub has no settings yet — the singleton's identity.
AUDIT_COLUMNS = {"created_by", "updated_by", "created_at", "updated_at"}
IDENTITY_COLUMNS = {"id", "hub_id"}

# A salon that configured EVERY setting away from its factory value. Layer 2 leans on that: a
# column left at its default could be clobbered without the comparison noticing.
CONFIGURED = {
    "default_duration": 45,
    "min_booking_notice": 30,
    "max_advance_booking": 30,
    "allow_overlapping": True,
    "send_reminders": False,
    "reminder_hours_before": 2,
    "allow_customer_cancellation": False,
    "cancellation_notice_hours": 48,
    "calendar_start_hour": 10,
    "calendar_end_hour": 22,
    "slot_interval": 30,
    FLAG: True,
}

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── manifest helpers ─────────────────────────────────────────────────────────────────────


def command(name: str) -> dict:
    return MANIFEST.get("commands", {}).get(name, {})


def schema_of(name: str) -> dict:
    rel = command(name).get("schema")
    if not isinstance(rel, str) or not (MODULE_DIR / rel).exists():
        return {}
    return json.loads((MODULE_DIR / rel).read_text())


def sql_text(name: str) -> str:
    return "\n".join(
        (MODULE_DIR / rel).read_text() for rel in command(name).get("sql", [])
    )


# ── Layer 1: the contract ────────────────────────────────────────────────────────────────

ASSIGNMENT_RE = re.compile(r"([a-z_][a-z0-9_]*)\s*=", re.I)
INSERT_COLUMNS_RE = re.compile(
    r"INSERT\s+INTO\s+appointments_settings\s*\(([^)]*)\)", re.I | re.S
)


def strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", " ", sql)


def check_command_is_declared() -> dict:
    spec = command(NARROW)
    if not spec:
        fail(
            f"`{NARROW}` is not declared in module.json: the only way to flip "
            f"{FLAG!r} from another screen is still `{UPSERT}`, which rewrites the whole form"
        )
        return {}
    upsert = command(UPSERT)
    if spec.get("permission") != upsert.get("permission"):
        fail(
            f"commands.{NARROW}.permission is {spec.get('permission')!r} but `{UPSERT}` is gated "
            f"by {upsert.get('permission')!r}: the same policy must need the same permission, or "
            "the narrow door is either a privilege escalation or a dead end"
        )
    if spec.get("permission") not in MANIFEST.get("permissions", []):
        fail(
            f"commands.{NARROW}.permission {spec.get('permission')!r} is not in this module's "
            "`permissions`"
        )
    if spec.get("transaction") is not True:
        fail(
            f"commands.{NARROW}: `transaction` is not true — the write and its outbox row must "
            "roll back together"
        )
    emits = spec.get("emit", [])
    if "appointments.settings.updated" not in emits:
        fail(
            f"commands.{NARROW}.emit does not carry `appointments.settings.updated`: whoever "
            f"reacts to a settings change (flows, other modules) would miss this one"
        )
    for event in emits:
        if event not in MANIFEST.get("events", {}).get("emits", []):
            fail(f"commands.{NARROW}.emit: {event!r} is not declared in `events.emits`")
    if not isinstance(spec.get("ai", {}).get("description"), str):
        fail(f"commands.{NARROW}.ai.description: missing — the assistant needs it in English")
    return spec


def check_payload_is_one_boolean() -> None:
    schema = schema_of(NARROW)
    if not schema:
        fail(f"commands.{NARROW}.schema does not resolve to a JSON Schema in the package")
        return
    if schema.get("additionalProperties") is not False:
        fail(
            f"schemas of {NARROW}: `additionalProperties` is not false — a public command "
            "(no leading `_`, no `internal: true`) is a door anybody with the permission can "
            "push, so it must refuse what it does not declare"
        )
    props = schema.get("properties") or {}
    if set(props) != {FLAG}:
        fail(
            f"schemas of {NARROW}: declares {sorted(props)} — the narrow door takes exactly "
            f"[{FLAG!r}] and nothing else"
        )
    if (props.get(FLAG) or {}).get("type") != "boolean":
        fail(f"schemas of {NARROW}: {FLAG!r} must be declared `boolean` (appointments#79)")
    if schema.get("required") != [FLAG]:
        fail(
            f"schemas of {NARROW}: {FLAG!r} must be `required` — a default here would let an "
            "empty payload flip the salon's policy without saying so"
        )
    if FLAG in props and "default" in props[FLAG]:
        fail(
            f"schemas of {NARROW}: {FLAG!r} must NOT carry a `default` (ADR-0073 would "
            "materialise it and turn an omission into a decision)"
        )


def check_expect_rows_error_is_declared_and_translated() -> None:
    expect = command(NARROW).get("expect_rows")
    if not isinstance(expect, dict):
        fail(
            f"commands.{NARROW}: no `expect_rows` gate — a write that matched no row would "
            "answer 200 and emit the event for a change that never happened"
        )
        return
    if expect.get("op") != "min" or expect.get("n") != 1:
        fail(f"commands.{NARROW}.expect_rows: expected `min` 1, got {expect.get('op')!r} {expect.get('n')!r}")
    code = expect.get("error")
    if not isinstance(code, str) or not code.startswith("appointments."):
        fail(f"commands.{NARROW}.expect_rows.error: {code!r} is not a code of this module")
        return
    if code not in MANIFEST.get("errors", {}):
        fail(
            f"commands.{NARROW}.expect_rows.error: {code!r} is not declared in `errors` — the "
            "installer refuses a code that is emitted and not declared"
        )
    for lang in ("en", "es"):
        path = MODULE_DIR / "locales" / f"{lang}.json"
        catalogue = json.loads(path.read_text())
        errors = catalogue.get("errors", catalogue)
        if code not in errors:
            fail(
                f"locales/{lang}.json: {code!r} has no message — the salon would read a raw "
                "error code (ADR-0055: the UI string travels as `en` + its `es`)"
            )


def check_sql_touches_nothing_else() -> None:
    """The static half of the guard: a mutant that widens the write dies without Postgres."""
    sql = strip_comments(sql_text(NARROW))
    if not sql.strip():
        fail(f"commands.{NARROW}: declares no SQL")
        return
    allowed = {FLAG} | AUDIT_COLUMNS | IDENTITY_COLUMNS | {"is_deleted", "deleted_at"}
    assigned = {m.group(1).lower() for m in ASSIGNMENT_RE.finditer(sql)}
    # `WHERE x = :y` and `ON CONFLICT (hub_id)` read columns, they do not write them; the
    # comparison below only cares about names outside the allowed set, and every settings column
    # that shows up on either side of an `=` in THIS file is one the write can reach.
    widened = sorted(assigned - allowed - {"excluded"})
    if widened:
        fail(
            f"commands.{NARROW} SQL: touches {widened} — the whole point of this door is that it "
            f"writes {FLAG!r} and the audit trail, and nothing else (appointments#149)"
        )
    for match in INSERT_COLUMNS_RE.finditer(sql):
        columns = {c.strip().lower() for c in match.group(1).split(",") if c.strip()}
        extra = sorted(columns - allowed)
        if extra:
            fail(
                f"commands.{NARROW} SQL: the INSERT branch lists {extra} — the singleton it "
                "creates for a hub with no settings must take the rest from the table DEFAULTs, "
                "so the factory values live in ONE place (the migration), not two"
            )


# ── Postgres plumbing ────────────────────────────────────────────────────────────────────


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
    cmd = ["docker", "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"]
    if db:
        cmd += ["-d", db]
    cmd += args
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def literal(value) -> str:
    """Mirrors the runtime's bind: a JSON boolean lands in an INTEGER column as 0/1 (hub#208)."""
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


def apply_defaults(schema: dict, payload: dict) -> dict:
    """`crates/runtime/src/registry.rs::apply_defaults` (ADR-0073): the runtime materialises the
    declared `default` of every key the caller left out, which is why the door that exists today
    cannot be used to change one field."""
    out = dict(payload)
    for key, prop in (schema.get("properties") or {}).items():
        if key not in out and isinstance(prop, dict) and "default" in prop:
            out[key] = prop["default"]
    return out


def run_command(name: str, payload: dict, hub: str, user: str, now: str, new_id: str) -> int:
    """Runs a declarative command's SQL the way the runtime would, and returns the rows it
    affected — the number `expect_rows` gates on."""
    params = {
        **apply_defaults(schema_of(name), payload),
        "new_id": new_id,
        "hub_id": hub,
        "current_user_id": user,
        "now": now,
    }
    affected = 0
    for rel in command(name)["sql"]:
        out = psql([], db=DB, stdin=bind((MODULE_DIR / rel).read_text(), params))
        for line in out.splitlines():
            tag = line.strip().split()
            if tag and tag[0] in ("INSERT", "UPDATE", "DELETE"):
                affected += int(tag[-1])
    return affected


def settings_row(hub: str) -> dict | None:
    out = psql(
        [
            "-t",
            "-A",
            "-c",
            "SELECT row_to_json(t) FROM appointments_settings t "
            f"WHERE hub_id = {literal(hub)}",
        ],
        db=DB,
    ).strip()
    if not out:
        return None
    return json.loads(out)


def seed_configured(hub: str, new_id: str) -> dict:
    run_command(UPSERT, dict(CONFIGURED), hub, "u-owner", NOW, new_id)
    row = settings_row(hub)
    if row is None:
        raise RuntimeError(f"seeding {hub} through {UPSERT} left no row")
    return row


def diff(before: dict, after: dict, ignore: set[str]) -> dict:
    return {
        k: (before[k], after.get(k))
        for k in before
        if k not in ignore and after.get(k) != before[k]
    }


# ── Layer 2: the row is not clobbered ────────────────────────────────────────────────────


def check_seed_differs_from_every_default() -> None:
    """Anchors layer 2 in the other direction: a column seeded AT its factory value could be
    reset by a widened write without the comparison seeing anything."""
    schema = schema_of(UPSERT)
    for key, prop in (schema.get("properties") or {}).items():
        if key == FLAG:
            continue
        if key not in CONFIGURED:
            fail(f"this test's salon does not configure {key!r}: a widened write could reset it unseen")
        elif CONFIGURED[key] == prop.get("default"):
            fail(
                f"this test's salon leaves {key!r} at its factory value {prop.get('default')!r}: "
                "pick a different one or layer 2 stops proving anything for that column"
            )


def check_narrow_write_leaves_the_rest_alone() -> None:
    hub = "hub-narrow"
    before = seed_configured(hub, "set-narrow")
    affected = run_command(NARROW, {FLAG: False}, hub, "u-whatsapp", LATER, "set-narrow-new")
    after = settings_row(hub)
    if affected != 1:
        fail(f"{NARROW}: affected {affected} row(s) on an existing settings row, expected 1")
    if after is None:
        fail(f"{NARROW}: the settings row is gone after the write")
        return
    if after[FLAG] != 0:
        fail(f"{NARROW}: {FLAG} is {after[FLAG]!r} after asking for false")
    clobbered = diff(before, after, ignore={FLAG, "updated_at", "updated_by"})
    if clobbered:
        fail(
            f"{NARROW}: flipping one switch changed {len(clobbered)} other column(s) — "
            + ", ".join(f"{k}: {was!r} -> {now!r}" for k, (was, now) in sorted(clobbered.items()))
        )
    if after.get("updated_at") != LATER or after.get("updated_by") != "u-whatsapp":
        fail(
            f"{NARROW}: the audit trail was not refreshed "
            f"(updated_at={after.get('updated_at')!r}, updated_by={after.get('updated_by')!r})"
        )
    notes.append(f"{NARROW} on a configured salon: only {FLAG} + audit moved")


def check_the_comparison_catches_the_positive() -> None:
    """The same flip through the door that exists today MUST clobber. If it does not, the
    comparison above is measuring nothing and its green means nothing (appointments#149 is the
    measurement: 12 of 12 settings reset)."""
    hub = "hub-control"
    before = seed_configured(hub, "set-control")
    run_command(UPSERT, {FLAG: False}, hub, "u-whatsapp", LATER, "set-control-new")
    after = settings_row(hub)
    clobbered = diff(before, after or {}, ignore={FLAG, "updated_at", "updated_by"})
    if not clobbered:
        fail(
            f"control: flipping {FLAG} through `{UPSERT}` clobbered nothing, so this file's "
            "comparison cannot tell a narrow write from a wide one — the check is broken, not "
            "the module"
        )
        return
    notes.append(
        f"control — the same flip through `{UPSERT}` resets {len(clobbered)} setting(s): "
        + ", ".join(sorted(clobbered))
    )


# ── Layer 3: the hub that never saved settings ───────────────────────────────────────────


def check_creates_the_singleton_like_upsert_would() -> None:
    narrow_hub, control_hub = "hub-fresh-narrow", "hub-fresh-control"
    affected = run_command(NARROW, {FLAG: False}, narrow_hub, "u-whatsapp", LATER, "set-fresh")
    run_command(UPSERT, {}, control_hub, "u-owner", LATER, "set-fresh-control")
    created, control = settings_row(narrow_hub), settings_row(control_hub)
    if affected != 1:
        fail(f"{NARROW}: affected {affected} row(s) on a hub with no settings, expected 1")
    if created is None:
        fail(
            f"{NARROW}: a hub that never opened the Settings tab has no row, so the write "
            "matched nothing and the switch cannot be flipped at all"
        )
        return
    if created[FLAG] != 0:
        fail(
            f"{NARROW}: the singleton was created with {FLAG}={created[FLAG]!r} instead of the "
            "value that was asked for (a factory DEFAULT is not an answer to a request)"
        )
    if control is None:
        fail(f"control: `{UPSERT}` with an empty form left no row")
        return
    drift = diff(control, created, ignore={FLAG, "id", "hub_id"} | AUDIT_COLUMNS)
    if drift:
        fail(
            f"{NARROW}: the singleton it creates differs from the one `{UPSERT}` writes from an "
            "empty form — "
            + ", ".join(f"{k}: {ctl!r} vs {new!r}" for k, (ctl, new) in sorted(drift.items()))
        )
    notes.append(f"{NARROW} on a fresh hub: singleton created with the same factory values as `{UPSERT}`")


# ── Layer 4: tenancy and soft-delete ─────────────────────────────────────────────────────


def check_write_stays_in_its_hub() -> None:
    mine, neighbour = "hub-mine", "hub-neighbour"
    seed_configured(mine, "set-mine")
    before = seed_configured(neighbour, "set-neighbour")
    run_command(NARROW, {FLAG: False}, mine, "u-whatsapp", LATER, "set-mine-new")
    after = settings_row(neighbour)
    if after != before:
        fail(
            f"{NARROW}: writing hub {mine!r} changed hub {neighbour!r} — "
            + ", ".join(sorted(diff(before, after or {}, ignore=set())))
        )
    notes.append(f"{NARROW}: the neighbour hub's settings are untouched")


def check_soft_deleted_row_is_refused() -> None:
    hub = "hub-deleted"
    seed_configured(hub, "set-deleted")
    psql(
        ["-c", f"UPDATE appointments_settings SET is_deleted = 1 WHERE hub_id = {literal(hub)}"],
        db=DB,
    )
    affected = run_command(NARROW, {FLAG: False}, hub, "u-whatsapp", LATER, "set-deleted-new")
    row = settings_row(hub)
    if affected != 0:
        fail(
            f"{NARROW}: wrote into a soft-deleted settings row ({affected} row(s)). That row is "
            f"invisible to `appointments.settings.get`, so the flip would be silently lost; "
            "`expect_rows` must see 0 and turn it into the declared error"
        )
    if row is not None and row[FLAG] != 1:
        fail(f"{NARROW}: the soft-deleted row was modified anyway ({FLAG}={row[FLAG]!r})")
    notes.append(f"{NARROW}: a soft-deleted singleton affects 0 rows → the `expect_rows` error")


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def check_against_postgres() -> None:
    if not docker_available():
        notes.append(
            f"SKIPPED Postgres layers: container {CONTAINER!r} is not running "
            "(the contract layer above still ran)"
        )
        return
    if not command(NARROW).get("sql"):
        notes.append(f"SKIPPED Postgres layers: `{NARROW}` declares no SQL to run")
        return
    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for entry in MANIFEST["migrations"]["postgres"]:
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
        notes.append(
            f"scratch database {DB} built from {len(MANIFEST['migrations']['postgres'])} migrations"
        )
        check_narrow_write_leaves_the_rest_alone()
        check_the_comparison_catches_the_positive()
        check_creates_the_singleton_like_upsert_would()
        check_write_stays_in_its_hub()
        check_soft_deleted_row_is_refused()
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    check_command_is_declared()
    check_payload_is_one_boolean()
    check_expect_rows_error_is_declared_and_translated()
    check_sql_touches_nothing_else()
    check_seed_differs_from_every_default()
    check_against_postgres()

    for note in notes:
        print(f"  · {note}")
    print()
    if failures:
        print(f"FAILED — {len(failures)} break(s) in the narrow settings write (appointments#149):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — appointments v{MANIFEST.get('version')}: `{NARROW}` flips one switch and leaves "
        "the other twelve settings exactly as the salon left them"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
