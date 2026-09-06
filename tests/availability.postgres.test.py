#!/usr/bin/env python3
"""The availability engine must PARSE on Postgres with no `:staff_id` (appointments#35).

Why this file exists: `queries/availability_slots.sql` and `queries/availability_check.sql` gate
the staff filter with the sentinel `(:staff_id IS NOT NULL AND b.staff_id = :staff_id)` /
`(:staff_id IS NULL OR a.staff_id = :staff_id)`. Postgres fixes a parameter's type at its FIRST
appearance and `IS [NOT] NULL` contributes none, so with the bind absent — which both files
document as the normal call, "ausente = agenda global" — the parameter travels untyped (OID 0,
`DynNull` in `hub/crates/db/src/lib.rs`) and Postgres answers
`could not determine data type of parameter` (42P08) **at prepare time**. The whole availability
engine (free slots + the pre-booking check) was unreachable for the global agenda. Since ADR-0154
the module only ships a `postgres` dialect, so there is no engine where it worked.

With a real staff id the SAME sql prepares fine (the type arrives in the Parse message), which is
why only the global path broke and why nothing louder ever happened. Same family that killed every
list in Hub Cloud on 2026-07-05 (`crates/runtime/src/queries.rs`), and the very idiom this module
already uses correctly in `queries/appointments_list.sql`.

`erplora validate` only WARNS about it (`null-untyped`), and no module repo runs `validate` in CI
anyway (ERPlora/pm#107). So the gate is here, against a real Postgres.

What it does: builds a scratch database from THIS module's own migrations, lowers `:name` to `$n`
and rewrites the ERPlora SQL bridge functions exactly like the runtime does, and asks Postgres to
PREPARE each query **with every bind left untyped** — the shape of the call with the optional
binds absent. Zero mocks.

Usage: tests/availability.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: ERPLORA_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail. If Docker or the container is
  missing the check is SKIPPED, never passed.
"""

import json
import os
import pathlib
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")

# The two queries of the availability engine, both driven by the optional `:staff_id`.
QUERIES = ["appointments.availability.own_slots", "appointments.availability.own_rules"]

# Bridge functions of ERPlora SQL (ADR-0007 §4a). MUST mirror `BRIDGE_FUNCTIONS` +
# `render_bridge_fn` in `hub/crates/db/src/lib.rs`: an unrewritten `erp_*` would look to Postgres
# like a missing function and this test would fail for the wrong reason.
BRIDGE_FUNCTIONS = [
    "erp_now",
    "erp_lpad",
    "erp_pad",
    "erp_dt",
    "erp_date",
    "erp_dateadd",
    "erp_month_start",
    "erp_dow_mon0",
    "erp_extract",
    "erp_datediff_days",
    "erp_timefmt",
]


def scan_args(sql, open_idx):
    """Balanced arguments of the `(` at `open_idx` → (list of raw args, index after the `)`)."""
    depth, start, i, in_string, args = 0, open_idx + 1, open_idx, False, []
    while i < len(sql):
        c = sql[i]
        if in_string:
            in_string = c != "'"
            i += 1
            continue
        if c == "'":
            in_string = True
            i += 1
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(sql[start:i])
                return args, i + 1
        elif c == "," and depth == 1:
            args.append(sql[start:i])
            start = i + 1
        i += 1
    raise AssertionError("unbalanced parentheses")


def render_bridge(name, raw_args):
    """The native Postgres expression a bridge call lowers to, or None on wrong arity."""
    a = [shim_functions(x.strip()) for x in raw_args]
    if name == "erp_now":
        return "now()" if (not raw_args or (len(a) == 1 and not a[0])) else None
    if name == "erp_pad" and len(a) == 2:
        return f"lpad(({a[0]})::text, {a[1]}, '0')"
    if name == "erp_lpad" and len(a) == 3:
        return f"lpad(({a[0]})::text, {a[1]}, {a[2]})"
    if name == "erp_dt" and len(a) == 1:
        return f"(({a[0]})::timestamptz)"
    if name == "erp_date" and len(a) == 1:
        return f"(({a[0]})::date)"
    if name == "erp_dateadd" and len(a) == 3:
        return f"(({a[0]})::timestamptz + (({a[1]}) || ' ' || {a[2]})::interval)"
    if name == "erp_month_start" and len(a) == 1:
        return f"date_trunc('month', ({a[0]})::timestamptz)"
    if name == "erp_dow_mon0" and len(a) == 1:
        return f"((EXTRACT(ISODOW FROM ({a[0]})::timestamptz)::int) - 1)"
    if name == "erp_extract" and len(a) == 2:
        part = raw_args[0].strip().strip("'").lower()
        if part not in ("hour", "minute", "second", "epoch"):
            return None
        return f"(EXTRACT({part} FROM ({a[1]})::timestamptz)::bigint)"
    if name == "erp_datediff_days" and len(a) == 2:
        return f"(EXTRACT(EPOCH FROM (({a[0]})::timestamptz - ({a[1]})::timestamptz)) / 86400.0)"
    if name == "erp_timefmt" and len(a) == 2:
        return f"(lpad(({a[0]})::text, 2, '0') || ':' || lpad(({a[1]})::text, 2, '0'))"
    return None


def shim_functions(sql):
    """Rewrite every `erp_*(...)` call to its native Postgres expression (recursive, UTF-8 safe)."""
    if not any(f in sql.lower() for f in BRIDGE_FUNCTIONS):
        return sql
    out, i, in_string = [], 0, False
    while i < len(sql):
        c = sql[i]
        if in_string:
            out.append(c)
            in_string = c != "'"
            i += 1
            continue
        if c == "'":
            in_string = True
            out.append(c)
            i += 1
            continue
        previous_is_ident = i > 0 and (sql[i - 1].isalnum() or sql[i - 1] == "_")
        rewritten = False
        if not previous_is_ident:
            for name in BRIDGE_FUNCTIONS:
                if sql[i : i + len(name)].lower() != name:
                    continue
                after = sql[i + len(name) : i + len(name) + 1]
                if after and (after.isalnum() or after == "_"):
                    continue  # `erp_padx` is not `erp_pad`
                j = i + len(name)
                while j < len(sql) and sql[j].isspace():
                    j += 1
                if j >= len(sql) or sql[j] != "(":
                    continue
                args, end = scan_args(sql, j)
                replacement = render_bridge(name, args)
                if replacement is None:
                    continue
                out.append(replacement)
                i = end
                rewritten = True
                break
        if rewritten:
            continue
        out.append(c)
        i += 1
    return "".join(out)


def translate(sql):
    """Lower `:name` to `$n` like the runtime does (`hub/crates/db/src/lib.rs::translate`).

    Index by order of FIRST appearance, a repeated name reuses its index, `::` is the Postgres
    cast (never a bind), and a `:name` inside a string literal or a comment stays verbatim — the
    runtime emits comments untouched and a bind that only lives in one would become a phantom `$n`.
    """
    sql = shim_functions(sql)
    out, names, i, in_string = [], [], 0, False
    while i < len(sql):
        c = sql[i]
        if in_string:
            out.append(c)
            in_string = c != "'"
            i += 1
            continue
        if c == "'":
            in_string = True
            out.append(c)
            i += 1
            continue
        if sql[i : i + 2] == "--":
            j = sql.find("\n", i)
            j = len(sql) if j < 0 else j
            out.append(sql[i:j])
            i = j
            continue
        if sql[i : i + 2] == "/*":
            j = sql.find("*/", i + 2)
            j = len(sql) if j < 0 else j + 2
            out.append(sql[i:j])
            i = j
            continue
        if sql[i : i + 2] == "::":
            out.append("::")
            i += 2
            continue
        if c == ":":
            j = i + 1
            while j < len(sql) and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            name = sql[i + 1 : j]
            if name:
                if name not in names:
                    names.append(name)
                out.append(f"${names.index(name) + 1}")
                i = j
                continue
        out.append(c)
        i += 1
    return "".join(out), names


def docker_available():
    try:
        r = subprocess.run(
            ["docker", "exec", CONTAINER, "pg_isready", "-U", "postgres"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        return r.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def psql(db, sql):
    return subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            CONTAINER,
            "psql",
            "-U",
            "postgres",
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-X",
        ],
        input=sql,
        capture_output=True,
        text=True,
    )


def main():
    targets = []
    for name in QUERIES:
        spec = MANIFEST["queries"][name]
        targets.append((name, spec["sql"]))

    if not docker_available():
        print(f"SKIPPED: no Postgres in container {CONTAINER} (nothing was verified)")
        return 0

    db = f"appointments_availability_{uuid.uuid4().hex[:8]}"
    subprocess.run(
        ["docker", "exec", CONTAINER, "createdb", "-U", "postgres", db], check=True
    )
    try:
        for entry in MANIFEST["migrations"]["postgres"]:
            rel = entry if isinstance(entry, str) else entry["file"]
            r = psql(db, (MODULE_DIR / rel).read_text())
            if r.returncode != 0:
                print(f"FAIL: migration {rel} does not apply\n{r.stderr}")
                return 1

        failed = 0
        for name, rel in targets:
            sql, _names = translate((MODULE_DIR / rel).read_text())
            r = psql(db, f"PREPARE stmt AS {sql};\nDEALLOCATE stmt;\n")
            if r.returncode != 0:
                error = " ".join(
                    x for x in r.stderr.splitlines() if x.startswith("ERROR")
                )
                print(
                    f"FAIL: Postgres cannot prepare {name} [{rel}] with untyped binds\n    {error}"
                )
                failed += 1
        if failed:
            return 1
        print("OK: Postgres prepares both availability queries with every bind untyped")
        return 0
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", db]
        )


if __name__ == "__main__":
    sys.exit(main())
