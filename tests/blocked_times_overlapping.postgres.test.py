#!/usr/bin/env python3
"""`appointments.blocked_times.overlapping` — the read that makes a blocked slot actually refuse.

Why this file exists (appointments#13 / appointments#10 / appointments#16): until PR #60, `create`
guarded the OVERLAP and nothing else. A booking could land on top of a public holiday, on top of the
salon's closure or on a professional's training block, because blocked time was only consulted by
`queries/availability_check.sql` — which is ADVISORY: the UI calls it before submitting and it stops
exactly nothing. Now the runtime pre-loads this query as an authoritative read (ADR-0069) and the
WASM handler refuses with `appointments.blocked`.

The handler side is covered by `cargo test` (window intersection, the professional's block vs
somebody else's, deleted rows, touching edges). This file covers the half `cargo test` CANNOT see:
that the SQL actually SELECTS the right rows out of a real Postgres. A read that returns nothing is
a guard that never fires, and the Rust tests would stay green all the way down — which is exactly
the "tests that prove nothing" trap appointments#16 was opened about.

The contract this file pins:

  1. MANIFEST. The query exists, is gated by `appointments.view_schedule`, is NOT a paginated
     `list` (the handler wants the rows, not a page), and `create` declares it as a `required`
     read with the params the runtime knows how to bind (`payload.*` literals only).

  2. REAL POSTGRES. Against a scratch database built from this module's own migrations, the query
     returns the blocks that can cover the requested day and NOT the ones that cannot: the
     hub-wide block (`staff_id` NULL) reaches everybody, another professional's block is invisible
     to this booking, a deleted block is gone, a multi-day holiday that merely SPANS the day is
     caught (the naive `date(start) = date(:start)` would miss it — that is the bug this shape
     exists to avoid), a block on another day is out, and ANOTHER HUB's block never leaks.

Usage: tests/blocked_times_overlapping.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  scratch database and DROPS it at the end, pass or fail. Without the container the Postgres layer
  is SKIPPED, never passed.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

QUERY = "appointments.blocked_times.overlapping"
PERMISSION = "appointments.view_schedule"
CREATE = "appointments.appointments.create"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_blocked_overlap_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"

# The booking under test: 2026-08-20, 11:00 local (+02:00).
START = "2026-08-20T11:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest wiring ─────────────────────────────────────────────────────────────


def check_manifest() -> dict | None:
    q = MANIFEST.get("queries", {}).get(QUERY)
    if not isinstance(q, dict):
        fail(f"{QUERY}: not declared in module.json")
        return None
    if q.get("permission") != PERMISSION:
        fail(f"{QUERY}.permission is {q.get('permission')!r}, expected {PERMISSION!r}")
    if "list" in q:
        fail(f"{QUERY}: must be a plain query — the handler reads the rows, not a page")
    sql_rel = q.get("sql")
    if not sql_rel or not (MODULE_DIR / sql_rel).exists():
        fail(f"{QUERY}.sql: {sql_rel!r} is not in the package")
        return None

    create = MANIFEST.get("commands", {}).get(CREATE, {})
    read = next(
        (r for r in create.get("reads", []) if r.get("query") == QUERY),
        None,
    )
    if read is None:
        fail(f"{CREATE}.reads: missing {QUERY!r} — the blocked guard would never run")
    else:
        if read.get("required") is not True:
            fail(
                f"{CREATE}.reads[{QUERY}]: must be `required` — a guard whose input can go "
                "missing is a guard that opens"
            )
        params = read.get("params") or {}
        if params.get("start_datetime") != "payload.start_datetime":
            fail(
                f"{CREATE}.reads[{QUERY}].params.start_datetime: must bind the payload's start"
            )
        if params.get("staff_id") != "payload.staff_id":
            fail(
                f"{CREATE}.reads[{QUERY}].params.staff_id: must bind the payload's professional"
            )
    return q


# ── Layer 2: real Postgres ───────────────────────────────────────────────────────────────


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


# Bridge functions (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs`.
def shim(sql: str) -> str:
    sql = re.sub(r"\berp_dt\(([^()]*)\)", r"((\1)::timestamptz)", sql)
    sql = re.sub(r"\berp_date\(([^()]*)\)", r"((\1)::date)", sql)
    return sql


def run_query(sql_rel: str, params: dict) -> list[dict]:
    body = shim(bind((MODULE_DIR / sql_rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def block(
    id_: str, hub: str, staff: str | None, start: str, end: str, deleted: int = 0
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_blocked_time (id, hub_id, title, block_type, start_datetime, "
            "end_datetime, all_day, staff_id, reason, is_recurring, recurrence_rule, is_deleted, "
            "created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'other', {literal(start)}, "
            f"{literal(end)}, 0, {literal(staff)}, '', 0, '', {deleted}, "
            "'2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def check_against_postgres(q: dict) -> None:
    if failures:
        return
    if not docker_available():
        notes.append(f"SKIPPED Postgres layer: container {CONTAINER!r} is not running")
        return

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for entry in MANIFEST.get("migrations", {}).get("postgres", []):
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())

        # Must come back for a booking of s1 on 2026-08-20.
        block(
            "b-hub-wide",
            HUB,
            None,
            "2026-08-20T00:00:00+02:00",
            "2026-08-21T00:00:00+02:00",
        )
        block(
            "b-mine",
            HUB,
            "s1",
            "2026-08-20T10:30:00+02:00",
            "2026-08-20T12:00:00+02:00",
        )
        # A holiday week that SPANS the day without starting or ending on it. `date(start) =
        # date(:start)` would drop it and the salon would take bookings during its own holidays.
        block(
            "b-spanning",
            HUB,
            None,
            "2026-08-17T00:00:00+02:00",
            "2026-08-25T00:00:00+02:00",
        )

        # Must NOT come back.
        block(
            "b-other-staff",
            HUB,
            "s2",
            "2026-08-20T10:30:00+02:00",
            "2026-08-20T12:00:00+02:00",
        )
        block(
            "b-deleted",
            HUB,
            "s1",
            "2026-08-20T10:30:00+02:00",
            "2026-08-20T12:00:00+02:00",
            deleted=1,
        )
        block(
            "b-other-day",
            HUB,
            "s1",
            "2026-08-25T10:30:00+02:00",
            "2026-08-25T12:00:00+02:00",
        )
        block(
            "b-other-hub",
            OTHER_HUB,
            None,
            "2026-08-20T00:00:00+02:00",
            "2026-08-21T00:00:00+02:00",
        )

        base = {"hub_id": HUB, "current_user_id": "u-owner", "now": START}
        got = {
            r["id"]
            for r in run_query(
                q["sql"], {**base, "staff_id": "s1", "start_datetime": START}
            )
        }
        want = {"b-hub-wide", "b-mine", "b-spanning"}
        if got != want:
            missing, extra = sorted(want - got), sorted(got - want)
            fail(
                f"{QUERY} for staff s1 returned {sorted(got)}; missing {missing}, unexpected {extra}"
            )

        # Without a professional (global agenda) only the hub-wide blocks apply: a block that
        # belongs to one person must not close the whole salon.
        got = {
            r["id"]
            for r in run_query(
                q["sql"], {**base, "staff_id": "", "start_datetime": START}
            )
        }
        want = {"b-hub-wide", "b-spanning"}
        if got != want:
            fail(
                f"{QUERY} with no professional returned {sorted(got)}, expected {sorted(want)}"
            )

        # Tenancy: the neighbour sees ITS block and never ours.
        got = {
            r["id"]
            for r in run_query(
                q["sql"],
                {
                    **base,
                    "hub_id": OTHER_HUB,
                    "staff_id": "s1",
                    "start_datetime": START,
                },
            )
        }
        if got != {"b-other-hub"}:
            fail(
                f"{QUERY}: the neighbour hub must see only its own block, got {sorted(got)}"
            )

        # A day with nothing blocked answers with no rows — and that is not an error.
        got = run_query(
            q["sql"],
            {**base, "staff_id": "s1", "start_datetime": "2026-09-15T11:00:00+02:00"},
        )
        if got:
            fail(f"{QUERY}: a clear day must return no rows, got {got!r}")
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    q = check_manifest()
    if q is not None:
        check_against_postgres(q)
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {QUERY} — manifest wiring + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
