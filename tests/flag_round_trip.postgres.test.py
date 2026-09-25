#!/usr/bin/env python3
"""appointments#79 — a row this module HANDS BACK must be a row this module ACCEPTS.

WHY THIS FILE EXISTS. `appointments.settings.get` returned the flags as the INTEGER they are
stored as, while `appointments.settings.upsert` declared them `boolean`, so the most ordinary
operation an API has — read the row, change one field, save it back — died in validation:

    POST /api/query   {"name":"appointments.settings.get"}
    → {"allow_overlapping":0, "allow_customer_cancellation":1, "send_reminders":1, …}

    POST /api/command {"name":"appointments.settings.upsert","payload":<the same row>}
    → 422  /allow_customer_cancellation: 1 is not of type "boolean"

The screen never noticed: the shell paints the Settings tab FROM the schema, so the form always
sent booleans. Everything that reads before it writes ate it — the assistant, the flows, the
public API, any configuration script. The textbook «works through the UI, fails through the door
next to it».

THE CONVENTION THIS FILE PINS (appointments#79, criterion 4). One idea, one type at each boundary:

  * AT REST the flag is `INTEGER` 0/1. That is the hub's row contract (§2.5 / ADR-0007) and it does
    not move: the portable DDL has no BOOLEAN, and money and counters share the same column type.
  * ON THE WIRE the flag is a JSON `boolean`, in BOTH directions. The write schemas already said
    so; the reads now say the same by projecting `col <> 0`, so a read's output validates against
    the write's schema.

Both halves are already first-class in the runtime, which is why this costs nothing at the edges
(`hub/crates/db/src/lib.rs`):

  * WRITING — `Json::Bool(b) => q.bind(if *b { 1_i64 } else { 0_i64 })` (line 263, hub#208 /
    ADR-0154): a JSON boolean lands in an INTEGER column as 0/1. No `CASE WHEN` needed.
  * READING — `"BOOL" => row.try_get::<bool, _>(i)` (line 497): a boolean SQL expression comes back
    as a JSON `true`/`false`, while an INTEGER column always comes back as a JSON number.

And the WASM handler is indifferent to the change: `as_bool` (handler/src/lib.rs:129) already
accepts `Bool`, `Number` and `String`, so a read that starts answering `true` instead of `1` is
read the same by every guard that consumes it.

WHY NOT THE OTHER TWO EXITS. The issue floated «let the schemas accept 0/1 as well as true/false».
That keeps the asymmetry instead of removing it, and it costs more than it looks: the Settings tab
is GENERATED from the schema, so a property that is no longer plainly `boolean` stops being a
toggle. Declaring the flags `integer, enum [0,1]` instead has the same effect on the form. The
form is the reason `boolean` is the right side to keep.

WHAT IS CHECKED, in two layers:

  1. THE GUARD (no container, always runs). Every property that any command schema declares
     `boolean` is a flag. No query may hand that name back as the bare INTEGER column — that is
     precisely the defect, and it is a PATTERN, so it is checked for every query of the manifest
     and not only for the two the issue happened to name. A new query added tomorrow with a raw
     flag in its SELECT fails here (root CLAUDE.md, «cero regresiones»: the fix ships the rule,
     not only the patch).

  2. THE ROUND-TRIP (real Postgres). Against a throwaway database built from this module's own
     migrations: run the REAL write SQL, read it back with the REAL query, serialise the row the
     way the runtime does (`row_to_json`: int8 → number, bool → true/false) and validate that row
     against the write command's JSON Schema. Green means read → edit → save actually works.

It refuses to skip its own assertion. Without `jsonschema` the round-trip layer FAILS instead of
excusing itself — a validation test that skips is a green light for nothing (module-toolkit#50).
The gate hands over a python that has it through `ERPLORA_PYTHON`.

Usage: tests/flag_round_trip.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  throwaway database and DROPS it at the end, pass or fail. Without the container the Postgres
  layer is SKIPPED — never counted as passed. The guard layer runs regardless.
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
DB = f"appointments_flag_round_trip_test_{os.getpid()}"
HUB = "hub-under-test"

NOW = "2026-08-20T09:00:00+02:00"

SETTINGS_GET = "appointments.settings.get"
SETTINGS_UPSERT = "appointments.settings.upsert"
BLOCKED_LIST = "appointments.blocked_times.list"
BLOCKED_CREATE = "appointments.blocked_times.create"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── manifest helpers ─────────────────────────────────────────────────────────────────────


def sql_of(command: str, index: int = 0) -> str:
    return MANIFEST["commands"][command]["sql"][index]


def query_sql(name: str) -> str:
    return MANIFEST["queries"][name]["sql"]


def schema_of(command: str) -> dict:
    rel = MANIFEST["commands"][command]["schema"]
    return json.loads((MODULE_DIR / rel).read_text())


def flag_properties() -> dict[str, list[str]]:
    """Every property some command schema declares `boolean`, and who declares it."""
    flags: dict[str, list[str]] = {}
    for name, spec in MANIFEST.get("commands", {}).items():
        rel = spec.get("schema")
        if not isinstance(rel, str):
            continue
        path = MODULE_DIR / rel
        if not path.exists():
            continue
        schema = json.loads(path.read_text())
        for prop, decl in (schema.get("properties") or {}).items():
            if isinstance(decl, dict) and decl.get("type") == "boolean":
                flags.setdefault(prop, []).append(name)
    return flags


# ── SELECT-list parsing ──────────────────────────────────────────────────────────────────

# A bare column reference: `all_day` or `bt.all_day`, and nothing else.
BARE_COLUMN_RE = re.compile(r"^(?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*$", re.I)


def _strip_noise(sql: str) -> str:
    """Line comments and single-quoted literals out of the way, so neither a `--` nor a
    `', '` can be mistaken for SQL structure while scanning parentheses."""
    sql = re.sub(r"--[^\n]*", " ", sql)
    return re.sub(r"'(?:[^']|'')*'", "''", sql)


def output_select(sql: str) -> str | None:
    """The SELECT list the query actually ANSWERS with: the last one at parenthesis depth 0.

    It has to be that one and not the first. Half these queries open with a `WITH cfg AS (SELECT
    …)`, whose columns are internal plumbing the caller never sees — reading the first SELECT
    would audit the CTE and never look at the row that leaves the module, which is a guard that
    reports on the wrong statement. Everything nested (a CTE body, a `CASE WHEN EXISTS (SELECT
    1 …)`, a subquery in FROM) sits at depth > 0 and is skipped for the same reason.
    """
    clean = _strip_noise(sql)
    depth, start = 0, None
    for match in re.finditer(r"\(|\)|\bSELECT\b", clean, re.I):
        token = match.group(0)
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
        elif depth == 0:
            start = match.end()
    if start is None:
        return None
    # Cut at the FROM that closes this SELECT list — again at depth 0, so a `FROM` inside a
    # function call or a subquery in the list does not end it early.
    depth = 0
    for match in re.finditer(r"\(|\)|\bFROM\b", clean[start:], re.I):
        token = match.group(0)
        if token == "(":
            depth += 1
        elif token == ")":
            depth -= 1
        elif depth == 0:
            return clean[start : start + match.start()]
    return clean[start:]


def select_items(sql: str) -> dict[str, str]:
    """Output column name → the expression that produces it.

    Splits on top-level commas only, so `COALESCE(MAX(x), 0) AS x` stays in one piece.
    """
    body = output_select(sql)
    if body is None:
        return {}
    items: dict[str, str] = {}
    depth, current = 0, ""
    for char in body:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        if char == "," and depth == 0:
            _add_item(items, current)
            current = ""
        else:
            current += char
    _add_item(items, current)
    return items


def _add_item(items: dict[str, str], raw: str) -> None:
    """Records output name → the expression WITHOUT its alias clause.

    Dropping the `AS x` matters: the check below asks whether the expression is a bare column,
    and `all_day AS all_day` is not literally bare while being exactly the defect. Keeping the
    alias in made the guard pass on every aliased column — it caught `all_day` and missed
    `bt.all_day AS all_day`, which is the same bug wearing a hat.
    """
    expr = " ".join(raw.split())
    if not expr:
        return
    alias = re.search(r"\bAS\s+([a-z_][a-z0-9_]*)$", expr, re.I)
    if alias:
        name = alias.group(1)
        expr = expr[: alias.start()].strip()
    else:
        name = expr.split(".")[-1]
    items[name.strip()] = expr


# ── Layer 1: the guard ───────────────────────────────────────────────────────────────────


def check_no_query_returns_a_raw_flag() -> None:
    """A flag leaves this module as a JSON boolean. A bare INTEGER column cannot do that."""
    flags = flag_properties()
    if not flags:
        fail(
            "no command schema declares a `boolean` property — either the schemas changed shape "
            "or this guard is looking in the wrong place; it must never pass by finding nothing"
        )
        return
    notes.append(
        f"flags under contract: {', '.join(sorted(flags))} "
        f"({len(MANIFEST.get('queries', {}))} queries scanned)"
    )
    for name, spec in sorted(MANIFEST.get("queries", {}).items()):
        rel = spec.get("sql")
        if not isinstance(rel, str):
            continue
        path = MODULE_DIR / rel
        if not path.exists():
            fail(f"queries.{name}.sql: {rel!r} is not in the package")
            continue
        for column, expr in select_items(path.read_text()).items():
            if column not in flags:
                continue
            if BARE_COLUMN_RE.match(expr):
                fail(
                    f"queries.{name} ({rel}): projects {column!r} as the bare INTEGER column, so "
                    f"it answers 0/1 — but {', '.join(flags[column])} declares {column!r} as "
                    f"`boolean`, so the row it hands back cannot be sent back in. Project it as a "
                    f"boolean: `{column} <> 0 AS {column}`"
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
    """Mirrors the runtime's bind: a JSON boolean reaches an INTEGER column as 0/1 (hub#208)."""
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


def run_sql_file(rel: str, params: dict) -> None:
    psql([], db=DB, stdin=bind((MODULE_DIR / rel).read_text(), params))


def run_query(rel: str, params: dict) -> list[dict]:
    """The rows AS THE RUNTIME HANDS THEM OVER: `row_to_json` maps int8 → JSON number and
    bool → JSON true/false, exactly like `crates/db/src/lib.rs` does per column type."""
    body = bind((MODULE_DIR / rel).read_text(), params).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


# ── Layer 2: the round-trip ──────────────────────────────────────────────────────────────


def validate(payload: dict, schema: dict, what: str) -> None:
    import jsonschema

    errors = sorted(
        jsonschema.Draft202012Validator(schema).iter_errors(payload),
        key=lambda e: list(e.absolute_path),
    )
    for err in errors:
        where = "/".join(str(p) for p in err.absolute_path) or "<root>"
        fail(f"{what}: /{where}: {err.message}")


def check_settings_round_trip() -> None:
    """Save the form the way the shell does, read it back, save THAT."""
    run_sql_file(
        sql_of(SETTINGS_UPSERT),
        {
            "new_id": "set-1",
            "hub_id": HUB,
            "default_duration": 45,
            "min_booking_notice": 30,
            "max_advance_booking": 60,
            "allow_overlapping": False,
            "send_reminders": True,
            "reminder_hours_before": 24,
            "allow_customer_cancellation": True,
            "cancellation_notice_hours": 12,
            "calendar_start_hour": 9,
            "calendar_end_hour": 19,
            "slot_interval": 15,
            "auto_confirm_online": True,
            "current_user_id": "u-1",
            "now": NOW,
        },
    )
    rows = run_query(query_sql(SETTINGS_GET), {"hub_id": HUB})
    if len(rows) != 1:
        fail(f"{SETTINGS_GET}: expected the singleton row, got {len(rows)}")
        return
    row = dict(rows[0])
    notes.append(f"{SETTINGS_GET} → {json.dumps(row, sort_keys=True)}")
    # The shell sends the snapshot back without the id — it is not in the form schema.
    row.pop("id", None)
    validate(row, schema_of(SETTINGS_UPSERT), f"{SETTINGS_GET} → {SETTINGS_UPSERT}")


def check_blocked_times_round_trip() -> None:
    """Read a blocked time out of the list and recreate it — the same row, back in."""
    run_sql_file(
        sql_of(BLOCKED_CREATE),
        {
            "new_id": "blk-1",
            "hub_id": HUB,
            "title": "Festivo local",
            "block_type": "holiday",
            "start_datetime": "2026-08-24T00:00:00+02:00",
            "end_datetime": "2026-08-24T23:59:00+02:00",
            "all_day": True,
            "staff_id": None,
            "reason": "",
            "is_recurring": False,
            "recurrence_rule": "",
            "current_user_id": "u-1",
            "now": NOW,
        },
    )
    rows = run_query(
        query_sql(BLOCKED_LIST),
        {"hub_id": HUB, "from_datetime": "2026-08-01T00:00:00+02:00"},
    )
    if len(rows) != 1:
        fail(f"{BLOCKED_LIST}: expected the row just created, got {len(rows)}")
        return
    row = dict(rows[0])
    notes.append(f"{BLOCKED_LIST} → {json.dumps(row, sort_keys=True)}")
    row.pop("id", None)
    validate(row, schema_of(BLOCKED_CREATE), f"{BLOCKED_LIST} → {BLOCKED_CREATE}")


def check_against_postgres() -> None:
    if not docker_available():
        notes.append(
            f"SKIPPED Postgres layer: container {CONTAINER!r} is not running "
            "(the guard layer above still ran)"
        )
        return
    try:
        import jsonschema  # noqa: F401
    except ImportError:
        fail(
            "`jsonschema` is not importable, so the round-trip cannot be validated. This layer "
            "REFUSES to skip: hand over an interpreter that has it (ERPLORA_PYTHON), because a "
            "validation test that excuses itself is a green light for nothing"
        )
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
        check_settings_round_trip()
        check_blocked_times_round_trip()
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


# ── Runner ───────────────────────────────────────────────────────────────────────────────


def main() -> int:
    check_no_query_returns_a_raw_flag()
    check_against_postgres()

    for note in notes:
        print(f"  · {note}")
    print()
    if failures:
        print(
            f"FAILED — {len(failures)} break(s) in the flag round-trip (appointments#79):"
        )
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        f"PASS — appointments v{MANIFEST.get('version')}: every flag crosses the wire as a JSON "
        "boolean, and what the reads hand back validates against the writes that take it"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
