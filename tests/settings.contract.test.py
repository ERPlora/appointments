#!/usr/bin/env python3
"""`settings` block contract test (appointments#45, ADR-0082).

Why this file exists: `appointments.settings.upsert`, its JSON Schema and the singleton table
`appointments_settings` have been in the published contract for a long time, but without a
declarative `settings` block in `module.json` the shell never paints the Settings tab, so a
salon owner had no screen to flip `allow_overlapping` (or anything else) from. This test pins
that the block exists AND that it points at pieces that are really in the package: a `settings`
block whose `get`/`set`/`schema` do not resolve is a tab that opens on an error, which is worse
than no tab.

Layers, one file:

  1. SHAPE. `settings` is an object with `schema`, `get`, `set` (the three the shell needs to
     paint the generic form: load the JSON Schema, read the singleton row, upsert the snapshot),
     each of them resolving to a file / query / command declared by THIS module.

  2. ROUND-TRIP. Every property of the form schema is a column the `get` query returns and a bind
     the `set` command SQL consumes — the shell persists the FULL snapshot (one key per property),
     so a property the SQL does not bind is silently dropped on save and a column the query does
     not select is painted with the default forever.

  3. AUTHORITY. `appointments.appointments.create` declares a REQUIRED `reads` of
     `appointments.settings.get`, so the WASM handler resolves `allow_overlapping` /
     `default_duration` from the table (ADR-0069) instead of trusting `payload.settings` — the
     toggle the new tab exposes has to be the one the create path honours.

  4. CANONICAL JSON SCHEMA (when reachable). `module.json` validated against the hub's own
     `schemas/module.schema.json`, which knows the `settings` block since ADR-0082.

Usage: tests/settings.contract.test.py   (exit 0 = green)
"""

import json
import os
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: shape ───────────────────────────────────────────────────────────────────────


def settings_block() -> dict | None:
    block = MANIFEST.get("settings")
    if block is None:
        fail(
            "module.json declares no `settings` block (ADR-0082): the shell paints no Settings "
            "tab, so `appointments.settings.upsert` is unreachable from the UI"
        )
        return None
    if not isinstance(block, dict):
        fail(f"settings: expected an object, got {type(block).__name__}")
        return None
    for key in ("schema", "get", "set"):
        if not isinstance(block.get(key), str) or not block[key]:
            fail(
                f"settings.{key}: missing or not a string — the shell needs it to paint the form"
            )
    for key in ("title", "icon", "component"):
        if key in block and not isinstance(block[key], str):
            fail(f"settings.{key}: expected a string")
    return block


def check_targets(block: dict) -> tuple[dict, dict, dict]:
    """Returns (form schema, get query spec, set command spec) — empty dicts when unresolved."""
    module_id = MANIFEST.get("id")
    schema_rel = block.get("schema")
    schema: dict = {}
    if isinstance(schema_rel, str):
        path = MODULE_DIR / schema_rel
        if not path.exists():
            fail(f"settings.schema: {schema_rel!r} is not in the package")
        else:
            schema = json.loads(path.read_text())
            if (
                not isinstance(schema.get("properties"), dict)
                or not schema["properties"]
            ):
                fail(
                    f"settings.schema: {schema_rel!r} declares no `properties` — an empty form"
                )

    get_name = block.get("get")
    queries = MANIFEST.get("queries", {})
    get_spec = queries.get(get_name, {}) if isinstance(get_name, str) else {}
    if isinstance(get_name, str):
        if get_name not in queries:
            fail(f"settings.get: {get_name!r} is not declared in `queries`")
        elif not get_name.startswith(f"{module_id}."):
            fail(f"settings.get: {get_name!r} does not belong to this module")
        elif "list" in get_spec:
            fail(
                f"settings.get: {get_name!r} is a paginated `list` — the form reads a plain singleton row"
            )
        elif not (MODULE_DIR / str(get_spec.get("sql"))).exists():
            fail(
                f"queries.{get_name}.sql: {get_spec.get('sql')!r} is not in the package"
            )

    set_name = block.get("set")
    commands = MANIFEST.get("commands", {})
    set_spec = commands.get(set_name, {}) if isinstance(set_name, str) else {}
    if isinstance(set_name, str):
        if set_name not in commands:
            fail(f"settings.set: {set_name!r} is not declared in `commands`")
        elif not set_name.startswith(f"{module_id}."):
            fail(f"settings.set: {set_name!r} does not belong to this module")
        else:
            if set_spec.get("schema") != schema_rel:
                fail(
                    f"commands.{set_name}.schema ({set_spec.get('schema')!r}) is not the form schema "
                    f"({schema_rel!r}) — the shell sends the form snapshot to this command, so both "
                    "must validate the same shape"
                )
            for rel in set_spec.get("sql", []):
                if not (MODULE_DIR / rel).exists():
                    fail(f"commands.{set_name}.sql: {rel!r} is not in the package")
    return schema, get_spec, set_spec


# ── Layer 2: the form round-trips through the SQL ────────────────────────────────────────

BIND_RE = re.compile(r"(?<![:\w]):([a-z_][a-z0-9_]*)")


def selected_columns(sql: str) -> set[str]:
    """Output column names of a plain `SELECT a, b AS c, t.d FROM …` (good enough for a singleton
    settings query; anything fancier should be a real parser, not this)."""
    m = re.search(r"SELECT\s+(.*?)\s+FROM\s", sql, re.S | re.I)
    if not m:
        return set()
    cols = set()
    for part in m.group(1).split(","):
        part = part.strip()
        alias = re.search(r"\bAS\s+([a-z_][a-z0-9_]*)\s*$", part, re.I)
        name = alias.group(1) if alias else part.split(".")[-1]
        cols.add(name.strip())
    return cols


def check_round_trip(schema: dict, get_spec: dict, set_spec: dict) -> None:
    props = set((schema.get("properties") or {}).keys())
    if not props or not get_spec or not set_spec:
        return
    get_sql = (MODULE_DIR / get_spec["sql"]).read_text()
    missing_in_get = sorted(props - selected_columns(get_sql))
    if missing_in_get:
        fail(
            f"settings.get: the query never returns {missing_in_get} — the form would paint the "
            "schema default for them forever"
        )
    set_sql = "\n".join(
        (MODULE_DIR / rel).read_text() for rel in set_spec.get("sql", [])
    )
    binds = set(BIND_RE.findall(set_sql))
    missing_in_set = sorted(props - binds)
    if missing_in_set:
        fail(
            f"settings.set: the command SQL never binds {missing_in_set} — saving the form drops "
            "them silently"
        )


# ── Layer 3: the create path reads the same settings the tab edits ───────────────────────


def check_create_reads_settings(block: dict) -> None:
    get_name = block.get("get")
    create = MANIFEST.get("commands", {}).get("appointments.appointments.create", {})
    for read in create.get("reads", []):
        if isinstance(read, dict) and read.get("query") == get_name:
            if read.get("required") is not True:
                fail(
                    "commands.appointments.appointments.create.reads: the settings read is not "
                    "`required: true` — a failed read would leave the handler guessing "
                    "`allow_overlapping` from the payload"
                )
            return
        if read == get_name:
            fail(
                "commands.appointments.appointments.create.reads: the settings read uses the "
                "string form, which can never be `required` (hub#701)"
            )
            return
    fail(
        f"commands.appointments.appointments.create: declares no `reads` of {get_name!r} — the "
        "handler still resolves `allow_overlapping` from `payload.settings` (handler/src/lib.rs), "
        "so the toggle the Settings tab exposes is not the one `create` honours"
    )


# ── Layer 4: canonical JSON Schema ───────────────────────────────────────────────────────


def check_against_canonical_schema() -> None:
    try:
        import jsonschema
    except ImportError:
        notes.append("SKIPPED canonical schema: `jsonschema` is not installed")
        return
    override = os.environ.get("ERPLORA_MODULE_SCHEMA")
    path = (
        pathlib.Path(override)
        if override
        else MODULE_DIR.parents[2] / "hub" / "schemas" / "module.schema.json"
    )
    if not path.exists():
        notes.append(
            "SKIPPED canonical schema: hub/schemas/module.schema.json not found"
        )
        return
    schema = json.loads(path.read_text())
    if "settings" not in (schema.get("properties") or {}):
        notes.append(
            f"SKIPPED canonical schema: {path} predates ADR-0082 (no `settings`)"
        )
        return
    notes.append(f"canonical schema applied: {path}")
    validator = jsonschema.Draft202012Validator(schema)
    for err in sorted(
        validator.iter_errors(MANIFEST), key=lambda e: list(e.absolute_path)
    ):
        where = "/".join(str(p) for p in err.absolute_path) or "<root>"
        fail(f"[schema] {where}: {err.message}")


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    block = settings_block()
    if block is not None:
        schema, get_spec, set_spec = check_targets(block)
        check_round_trip(schema, get_spec, set_spec)
        check_create_reads_settings(block)
        check_against_canonical_schema()

    for note in notes:
        print(f"  · {note}")
    print()
    if failures:
        print(f"FAILED — {len(failures)} violation(s) of the `settings` contract:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — appointments v{MANIFEST.get('version')} declares a `settings` tab: "
        f"{block['schema']} · get {block['get']} · set {block['set']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
