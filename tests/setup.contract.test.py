#!/usr/bin/env python3
"""`setup` block contract test (appointments#30) — the checklist item this module declares.

Why this file exists: since hub#369 (ADR-0222) the `setup` block is NOT "something the Hub only
transports" any more. `crates/runtime/src/setup_status.rs` runs it, and `Manifest::load` — the
first thing `installer::install` does — now parses it into `SetupDef`. A malformed `setup` is a
malformed manifest, and a malformed manifest is a module that cannot be installed on ANY hub
(the exact shape of tables#28, where one wrong JSON type closed the door on a published module).
So the block gets a test, and the test runs the real query against a real Postgres.

Four layers, one file:

  1. SHAPE (always, zero dependencies). Mirrors `SetupDef`/`SetupCheck` of the runtime: the
     required keys, the "exactly one of truthy|equals" rule, the reserved `order`, the `key` that
     must NOT be declared (the core derives it as `<module_id>.setup`), and the route pointing at
     a navigation entry that actually exists — a checklist item whose CTA lands on a dead route is
     worse than no item at all.

  2. CANONICAL JSON SCHEMA (when reachable). Validates `module.json` against the hub's own
     `schemas/module.schema.json` instead of re-implementing it. A checkout older than hub#369
     does not know `countries`/`order` and, being `additionalProperties: false`, would fail a
     correct manifest — that is reported as SKIPPED (stale), never as a pass. Point
     `ERPLORA_MODULE_SCHEMA` at a post-hub#369 schema to get the real check.

  3. I18N. `title`/`description` are English canonical (ADR-0055) and the Spanish translation
     travels in `locales/es.json` under `setup.title` / `setup.description` — the keys `SetupDef`
     documents.

  4. REAL POSTGRES. The declared query is applied to a scratch database built from this module's
     own migrations, and driven with this module's own command SQL: an empty hub is NOT
     configured, a schedule with no hours is NOT configured, one weekly time slot IS, and
     removing it goes back to pending. This is what proves the query exists, returns exactly one
     row, and carries the column `configured_when` evaluates. Zero mocks.

Usage: tests/setup.contract.test.py   (exit 0 = green)
  Postgres layer uses the `erplora-test-pg-5433` container by default
  (override: APPOINTMENTS_TEST_PG_CONTAINER). It creates a scratch database and DROPS it at the
  end, pass or fail. If Docker or the container is missing, that layer is SKIPPED, never passed.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST_PATH = MODULE_DIR / "module.json"
MANIFEST = json.loads(MANIFEST_PATH.read_text())

CONTAINER = os.environ.get("APPOINTMENTS_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_setup_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-next-door"
USER = "u-owner"
NOW = "2026-08-07T09:00:00+02:00"

# The slot the core reserved for this module in `architecture/hub/setup-status.md` §6: 100 is
# `tables` ("your tables"), 101 is `appointments` ("your agenda"). The scale belongs to the core;
# a module takes the slot it was assigned instead of picking one.
RESERVED_ORDER = 101

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: the shape the runtime deserializes ──────────────────────────────────────────


def setup_block() -> dict | None:
    setup = MANIFEST.get("setup")
    if setup is None:
        fail(
            "module.json declares no `setup` block: the module contributes no item to "
            "`hub.setup.status`, so a hub that has installed it is never told to set its agenda up"
        )
        return None
    if not isinstance(setup, dict):
        fail(f"setup: expected an object, got {type(setup).__name__}")
        return None
    return setup


def check_shape(setup: dict) -> None:
    for key in ("query", "configured_when", "title", "route"):
        if key not in setup:
            fail(f"setup.{key}: missing, and the contract requires it")

    for key, kind in (
        ("query", str),
        ("title", str),
        ("route", str),
        ("description", str),
        ("icon", str),
        ("permission", str),
    ):
        if key in setup and not isinstance(setup[key], str):
            fail(f"setup.{key}: expected a string, got {type(setup[key]).__name__}")

    if "params" in setup and not isinstance(setup["params"], dict):
        fail("setup.params: expected an object")

    # `required` maps to 🔴 functional / 🟡 recommended — never ⛔, which is a core-owned list.
    # A number or a string here would abort `Manifest::load`.
    if "required" in setup and not isinstance(setup["required"], bool):
        fail(
            f"setup.required: expected a boolean, got {type(setup['required']).__name__}"
        )

    # The core derives the item key as `<module_id>.setup`. Letting a manifest declare its own
    # would let it rename itself out of the ⛔ list of hub#370.
    if "key" in setup:
        fail(
            "setup.key: must NOT be declared — the core derives it as `appointments.setup`"
        )

    order = setup.get("order")
    if order is None:
        fail(
            f"setup.order: missing — the core reserved slot {RESERVED_ORDER} for this module"
        )
    elif isinstance(order, bool) or not isinstance(order, int):
        fail(f"setup.order: expected an integer, got {type(order).__name__}")
    elif order != RESERVED_ORDER:
        fail(f"setup.order: {order} is not the slot {RESERVED_ORDER} the core reserved")

    countries = setup.get("countries")
    if countries is not None:
        if not isinstance(countries, list):
            fail("setup.countries: expected an array")
        else:
            for i, code in enumerate(countries):
                if not isinstance(code, str) or not re.fullmatch(r"[A-Za-z]{2}", code):
                    fail(
                        f"setup.countries[{i}]: {code!r} is not an ISO-3166-1 alpha-2 code"
                    )

    checks = setup.get("configured_when")
    if not isinstance(checks, list):
        fail("setup.configured_when: expected an array")
    elif not checks:
        fail(
            "setup.configured_when: empty means 'having a row is enough' — say what makes the "
            "agenda configured instead of leaving it implicit"
        )
    else:
        for i, check in enumerate(checks):
            path = f"setup.configured_when[{i}]"
            if not isinstance(check, dict):
                fail(f"{path}: expected an object")
                continue
            if not isinstance(check.get("field"), str) or not check["field"]:
                fail(f"{path}.field: missing or not a string")
            declared = [k for k in ("truthy", "equals") if k in check]
            if len(declared) != 1:
                # `passes()` in setup_status.rs returns false when neither is present: a
                # half-written check never ticks the item, it just makes it unreachable.
                fail(
                    f"{path}: needs exactly one of `truthy`/`equals`, found {declared or 'none'}"
                )
            if "truthy" in check and not isinstance(check["truthy"], bool):
                fail(f"{path}.truthy: expected a boolean")
            for extra in sorted(set(check) - {"field", "truthy", "equals"}):
                fail(f"{path}.{extra}: not part of the check contract")


def check_permission(setup: dict) -> None:
    """The `permission` of `setup` is the permission to CONFIGURE, and the item is only offered to
    whoever holds it. If a role can be offered the item but cannot read the query behind it, the
    runtime omits the item (best-effort) and the checklist silently loses an entry — so the two
    permissions have to line up."""
    perm = setup.get("permission")
    if not perm:
        return
    if perm not in MANIFEST.get("permissions", []):
        fail(f"setup.permission: {perm!r} is not declared in `permissions`")

    query = MANIFEST.get("queries", {}).get(setup.get("query"), {})
    read_perm = query.get("permission")
    if not read_perm:
        return
    for role, granted in (MANIFEST.get("role_permissions") or {}).items():
        if not isinstance(granted, list) or "*" in granted:
            continue
        if perm in granted and read_perm not in granted:
            fail(
                f"role_permissions.{role}: holds {perm!r} (so it is offered the item) but not "
                f"{read_perm!r} (so its check fails and the item is silently omitted)"
            )


def check_route(setup: dict) -> None:
    """The route is the screen that completes the item. `/m/:moduleId/:navId?` is the shell's
    module route, so the navId has to be a navigation entry this manifest actually declares."""
    route = setup.get("route")
    if not isinstance(route, str) or not route.startswith("/"):
        fail(f"setup.route: {route!r} is not an absolute path")
        return

    module_id = MANIFEST.get("id")
    if not route.startswith(f"/m/{module_id}"):
        # A module item may legitimately point at a core screen (verifactu → /settings), but this
        # one is the module's own agenda.
        fail(f"setup.route: {route!r} does not point at this module (/m/{module_id}/…)")
        return

    rest = route[len(f"/m/{module_id}") :].strip("/").split("?")[0]
    if not rest:
        return
    nav_ids = [n.get("id") for n in MANIFEST.get("navigation", [])]
    if rest not in nav_ids:
        fail(
            f"setup.route: navId {rest!r} is not one of the declared navigation entries "
            f"{nav_ids} — the CTA would land on a dead route"
        )


def check_query_is_declared(setup: dict) -> dict:
    """The query is the module's OWN read query, and its SQL has to be in the package."""
    name = setup.get("query")
    queries = MANIFEST.get("queries", {})
    if name not in queries:
        fail(f"setup.query: {name!r} is not declared in `queries`")
        return {}
    if not str(name).startswith(f"{MANIFEST.get('id')}."):
        fail(f"setup.query: {name!r} does not belong to this module")
    spec = queries[name]
    sql = spec.get("sql")
    if not sql or not (MODULE_DIR / sql).exists():
        fail(f"queries.{name}.sql: declares {sql!r}, which is not in the package")
        return {}
    if "list" in spec:
        fail(
            f"setup.query: {name!r} declares a `list` block — the paginated engine answers with an "
            "envelope, and the setup check reads the FIRST ROW of a plain query"
        )
    return spec


# ── Layer 2: the canonical JSON Schema ───────────────────────────────────────────────────


def canonical_schema_path() -> pathlib.Path | None:
    override = os.environ.get("ERPLORA_MODULE_SCHEMA")
    if override:
        return pathlib.Path(override)
    sibling = MODULE_DIR.parents[2] / "hub" / "schemas" / "module.schema.json"
    return sibling if sibling.exists() else None


def check_against_canonical_schema() -> None:
    try:
        import jsonschema
    except ImportError:
        notes.append("SKIPPED canonical schema: `jsonschema` is not installed")
        return

    path = canonical_schema_path()
    if path is None or not path.exists():
        notes.append(
            "SKIPPED canonical schema: hub/schemas/module.schema.json not found "
            "(set ERPLORA_MODULE_SCHEMA)"
        )
        return

    schema = json.loads(path.read_text())
    setup_schema = (schema.get("properties") or {}).get("setup") or {}
    known = set((setup_schema.get("properties") or {}).keys())
    if not {"order", "countries"} <= known:
        # Pre-hub#369 and `additionalProperties: false`: validating against it would paint a
        # correct manifest red. Stale is reported, not passed.
        notes.append(
            f"SKIPPED canonical schema: {path} predates hub#369 (its `setup` knows neither "
            "`order` nor `countries`) — point ERPLORA_MODULE_SCHEMA at a newer one"
        )
        return

    validator = jsonschema.Draft202012Validator(schema)
    notes.append(f"canonical schema applied: {path}")
    for err in sorted(
        validator.iter_errors(MANIFEST), key=lambda e: list(e.absolute_path)
    ):
        where = "/".join(str(p) for p in err.absolute_path) or "<root>"
        fail(f"[schema] {where}: {err.message}")


# ── Layer 3: English canonical + its Spanish translation ─────────────────────────────────


def check_i18n(setup: dict) -> None:
    title = setup.get("title", "")
    description = setup.get("description", "")
    if title and not re.fullmatch(r"[\x20-\x7e]+", title):
        fail(
            f"setup.title: {title!r} carries non-ASCII text — the manifest value is the ENGLISH "
            "canonical fallback (ADR-0055)"
        )

    for lang in ("en", "es"):
        path = MODULE_DIR / "locales" / f"{lang}.json"
        if not path.exists():
            fail(f"locales/{lang}.json: missing")
            continue
        block = json.loads(path.read_text()).get("setup")
        if not isinstance(block, dict):
            fail(
                f"locales/{lang}.json: no `setup` block — SetupDef documents the translation as "
                "`setup.title` / `setup.description`"
            )
            continue
        for key, canonical in (("title", title), ("description", description)):
            value = block.get(key)
            if not isinstance(value, str) or not value.strip():
                fail(f"locales/{lang}.json: setup.{key} is missing")
                continue
            if lang == "en" and value != canonical:
                fail(
                    f"locales/en.json: setup.{key} ({value!r}) does not match the manifest "
                    f"({canonical!r}) — English is the source, not a variant"
                )
            if lang == "es" and canonical and value == canonical:
                fail(
                    f"locales/es.json: setup.{key} is still the English text — it is untranslated"
                )


# ── Layer 4: the query, against a real Postgres ──────────────────────────────────────────


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
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def bind(sql: str, params: dict) -> str:
    """Replace `:name` placeholders the way the runtime's adapter does: a bind the caller did not
    provide arrives as NULL (the adapter's sentinel), never as a literal `:name`."""

    def sub(match: re.Match) -> str:
        return literal(params.get(match.group(1)))

    return re.sub(r"(?<![:\w]):([a-z_][a-z0-9_]*)", sub, sql)


def run_setup_query(sql_path: pathlib.Path, params: dict) -> list[dict]:
    """Run the query the way `queries::execute` does (system params bound) and read the rows back
    as JSON, so the Python evaluator sees the same value shapes the runtime's `passes()` sees."""
    sql = bind((MODULE_DIR / sql_path).read_text(), params).strip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(t) FROM ({sql}) t"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def truthy(value) -> bool:
    """Mirror of `truthy()` in setup_status.rs: loosely false is null, empty, 0, false — and the
    STRINGS "0"/"false" too, because a flag crossing a text column arrives spelled out."""
    if value is None or value is False:
        return False
    if value is True:
        return True
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        s = value.strip()
        return s not in ("", "0") and s.lower() != "false"
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def as_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value)


def is_configured(rows: list[dict], checks: list[dict]) -> bool:
    """Configured ⇔ there is a row AND every check passes (ADR-0063)."""
    if not rows:
        return False
    row = rows[0]
    for check in checks:
        value = row.get(check["field"])
        if "truthy" in check:
            if truthy(value) != check["truthy"]:
                return False
        elif "equals" in check:
            if as_text(value) != as_text(check["equals"]):
                return False
        else:
            return False
    return True


def run_command(name: str, params: dict) -> None:
    """Run a declared command's whole `sql[]` chain in ONE transaction, like `execute_tx_gated`."""
    spec = MANIFEST["commands"][name]
    statements = [(MODULE_DIR / rel).read_text() for rel in spec.get("sql", [])]
    body = "\n".join(bind(s, params) for s in statements)
    psql(["-c", f"BEGIN; {body} COMMIT;"], db=DB)


def check_query_against_postgres(setup: dict, spec: dict) -> None:
    if not spec:
        return
    if not docker_available():
        notes.append(
            f"SKIPPED Postgres layer: container {CONTAINER!r} is not running "
            "(APPOINTMENTS_TEST_PG_CONTAINER overrides it)"
        )
        return

    sql_path = pathlib.Path(spec["sql"])
    checks = setup.get("configured_when") or []
    base = {"hub_id": HUB, "current_user_id": USER, "now": NOW}

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for rel in MANIFEST.get("migrations", {}).get("postgres", []):
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())

        # 1. A hub that just installed the module. The query has to ANSWER (one row), carry every
        #    column `configured_when` reads, and say "not configured".
        rows = run_setup_query(sql_path, base)
        if len(rows) != 1:
            fail(
                f"{setup['query']}: returned {len(rows)} rows on a fresh hub — the setup check "
                "reads the FIRST row and a status query answers with exactly one"
            )
        if rows:
            for check in checks:
                if check["field"] not in rows[0]:
                    fail(
                        f"{setup['query']}: the row has no column {check['field']!r} "
                        f"(columns: {sorted(rows[0])}) — the check can never pass"
                    )
        if is_configured(rows, checks):
            fail(
                "a freshly installed hub reports the agenda as CONFIGURED — nothing was set up yet"
            )

        # 2. A schedule with no hours in it. A named agenda that says nothing about when the salon
        #    works does not let anyone operate the day, so it must not tick the item.
        schedule_id = str(uuid.uuid4())
        run_command(
            "appointments.schedules.create",
            {
                **base,
                "new_id": schedule_id,
                "name": "Salon hours",
                "description": "",
                "is_default": 1,
            },
        )
        if is_configured(run_setup_query(sql_path, base), checks):
            fail("an empty schedule (no time slots) reports the agenda as CONFIGURED")

        # 3. The salon declares when it works: Monday 09:00-14:00. THIS is what the availability
        #    engine reads to stop offering slots while the salon is closed.
        slot_id = str(uuid.uuid4())
        run_command(
            "appointments.timeslots.create",
            {
                **base,
                "new_id": slot_id,
                "schedule_id": schedule_id,
                "day_of_week": 0,
                "start_time": "09:00",
                "end_time": "14:00",
            },
        )
        if not is_configured(run_setup_query(sql_path, base), checks):
            fail(
                "one weekly time slot on an active schedule still reports the agenda as PENDING"
            )

        # 4. The item heals both ways: withdraw the hours and it goes back to pending instead of
        #    staying green on data that is gone.
        psql(
            [
                "-c",
                f"UPDATE appointments_schedule_timeslot SET is_deleted = 1 WHERE id = {literal(slot_id)}",
            ],
            db=DB,
        )
        if is_configured(run_setup_query(sql_path, base), checks):
            fail("a deleted time slot still reports the agenda as CONFIGURED")
        psql(
            [
                "-c",
                f"UPDATE appointments_schedule_timeslot SET is_deleted = 0 WHERE id = {literal(slot_id)}",
            ],
            db=DB,
        )

        # 5. Row contract: another hub's hours are not this hub's hours.
        if is_configured(
            run_setup_query(sql_path, {**base, "hub_id": OTHER_HUB}), checks
        ):
            fail(
                f"hub {OTHER_HUB!r} reads as configured off {HUB!r}'s rows — the query leaks across hubs"
            )

        notes.append(f"postgres layer ran on {CONTAINER} ({DB})")
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}" WITH (FORCE)'])


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    setup = setup_block()
    if setup is not None:
        check_shape(setup)
        check_permission(setup)
        check_route(setup)
        spec = check_query_is_declared(setup)
        check_i18n(setup)
        check_against_canonical_schema()
        if not failures:
            check_query_against_postgres(setup, spec)

    for note in notes:
        print(f"  · {note}")
    print()

    if failures:
        print(f"FAILED — {len(failures)} violation(s) of the `setup` contract:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — appointments v{MANIFEST.get('version')} declares a `setup` item the runtime can "
        "run: {} → {}".format(
            setup["query"], ", ".join(c["field"] for c in setup["configured_when"])
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
