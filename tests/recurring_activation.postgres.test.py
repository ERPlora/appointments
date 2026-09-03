#!/usr/bin/env python3
"""Desactivar una serie sin borrarla (appointments#110, resto declarado de #91/#109).

WHY THIS FILE EXISTS. The series screen already offers edit, materialize and delete
(appointments#91/#109). Deactivate was left out on purpose, not out of laziness: the column
already existed (`appointments_recurring.is_active`, migration 001) but nothing wrote it outside
of `recurring_delete.sql` (which sets it to 0 *alongside* `is_deleted = 1` — that is deleting, not
pausing), and `recurring_list.sql` filtered `is_active = 1` in hard code. A "deactivate" button
without fixing the list is a trap, not a feature: the row would vanish from the only screen that
could bring it back.

WHAT IS CHECKED, in two layers:

  1. MANIFEST. `appointments.recurring.activate` and `.deactivate` exist, are transactional,
     share `schemas/recurring_id.json` (the same shape as `delete` — no new field needed, this is
     a state transition like `confirm`/`start`/`complete`, not a generic setter), and refuse a
     missing/deleted id with the same `appointments.recurring_not_found` error `materialize`
     already uses for the same row. And `recurring_list.sql` no longer hides inactive rows — the
     regression this file exists to prevent (root CLAUDE.md, «cero regresiones»).
  2. REAL POSTGRES. Against a scratch database built from this module's own migrations:
     - deactivating an active series flips `is_active` to 0 and leaves it reachable in
       `appointments.recurring.list` (it used to disappear);
     - reactivating flips it back, and does not touch `is_deleted` either way;
     - a neighbour series (another hub) and a soft-deleted series are never touched — the `WHERE`
       is the last line of defence, and a guard nobody proved rejects anything is a guard that
       opens (appointments#16).

Usage: tests/recurring_activation.postgres.test.py   (exit 0 = green)
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

DEACTIVATE = "appointments.recurring.deactivate"
ACTIVATE = "appointments.recurring.activate"
LIST_QUERY = "appointments.recurring.list"
NOT_FOUND_ERROR = "appointments.recurring_not_found"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_recurring_activation_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-08-20T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest ────────────────────────────────────────────────────────────────────


def check_transition(name: str) -> None:
    cmd = MANIFEST.get("commands", {}).get(name)
    if not isinstance(cmd, dict):
        fail(f"{name}: not declared in module.json")
        return
    if cmd.get("transaction") is not True:
        fail(f"{name}: must be transactional")
    if cmd.get("permission") != "appointments.change_appointment":
        fail(
            f"{name}.permission: expected appointments.change_appointment, got {cmd.get('permission')!r}"
        )
    schema_rel = cmd.get("schema")
    if schema_rel != "schemas/recurring_id.json":
        fail(
            f"{name}.schema: expected schemas/recurring_id.json (a state transition takes only "
            f"the id, like confirm/start/complete/delete), got {schema_rel!r}"
        )
    expect = cmd.get("expect_rows") or {}
    if expect.get("op") != "min" or expect.get("n") != 1:
        fail(f"{name}.expect_rows: must require at least 1 row, got {expect!r}")
    if expect.get("error") != NOT_FOUND_ERROR:
        fail(
            f"{name}.expect_rows.error: expected {NOT_FOUND_ERROR!r}, got {expect.get('error')!r}"
        )
    sql_rel = (cmd.get("sql") or [None])[0]
    if not sql_rel or not (MODULE_DIR / sql_rel).exists():
        fail(f"{name}.sql: {sql_rel!r} is not in the package")


def check_manifest() -> None:
    if NOT_FOUND_ERROR not in MANIFEST.get("errors", {}):
        fail(f"errors: {NOT_FOUND_ERROR!r} is not declared")
    check_transition(DEACTIVATE)
    check_transition(ACTIVATE)

    q = MANIFEST.get("queries", {}).get(LIST_QUERY) or {}
    filters = (q.get("list") or {}).get("filters") or {}
    if "is_active" not in filters:
        fail(
            f"{LIST_QUERY}.list.filters: lost the is_active filter — callers that only want the "
            "active ones would have no way left to ask"
        )

    list_sql_rel = q.get("sql")
    if not list_sql_rel or not (MODULE_DIR / list_sql_rel).exists():
        fail(f"{LIST_QUERY}.sql: {list_sql_rel!r} is not in the package")
        return
    list_sql = (MODULE_DIR / list_sql_rel).read_text()
    # The regression this file exists to catch: a hard `is_active = 1` in the WHERE makes a
    # deactivated series invisible and unreachable — the trap #91 explicitly refused to ship.
    if re.search(r"is_active\s*=\s*1", list_sql):
        fail(
            f"{list_sql_rel}: still hard-filters is_active = 1 — a deactivated series would "
            "disappear from the only screen that can reactivate it"
        )


# ── Layer 2: real Postgres ──────────────────────────────────────────────────────────────


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
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def run_command(sql_rel: str, params: dict) -> None:
    psql([], db=DB, stdin=bind((MODULE_DIR / sql_rel).read_text(), params))


def run_query(sql_rel: str, params: dict) -> list[dict]:
    body = bind((MODULE_DIR / sql_rel).read_text(), params).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def seed_series(
    series_id: str, hub: str = HUB, deleted: int = 0, active: int = 1
) -> None:
    run_command(
        "commands/recurring_create.sql",
        {
            "new_id": series_id,
            "hub_id": hub,
            "customer_id": "c1",
            "customer_name": "Ada",
            "service_id": "s-corte",
            "service_name": "Corte",
            "staff_id": "s1",
            "staff_name": "Bea",
            "frequency": "weekly",
            "day_of_week": None,
            "time": "11:00",
            "duration_minutes": 30,
            "start_date": "2026-08-03",
            "end_date": None,
            "max_occurrences": None,
            "current_user_id": "u1",
            "now": NOW,
        },
    )
    if deleted:
        psql(
            [
                "-c",
                f"UPDATE appointments_recurring SET is_deleted = 1 WHERE id = '{series_id}'",
            ],
            db=DB,
        )
    if not active:
        psql(
            [
                "-c",
                f"UPDATE appointments_recurring SET is_active = 0 WHERE id = '{series_id}'",
            ],
            db=DB,
        )


def check_against_postgres(
    deactivate_sql: str, activate_sql: str, list_sql: str
) -> None:
    if failures:
        return
    if not docker_available():
        notes.append(f"SKIPPED Postgres layer: container {CONTAINER!r} is not running")
        return

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for rel in MANIFEST.get("migrations", {}).get("postgres", []):
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())

        seed_series("r1", HUB)
        seed_series("r-neighbour", OTHER_HUB)
        seed_series("r-gone", HUB, deleted=1)

        run_command(
            deactivate_sql,
            {"recurring_id": "r1", "hub_id": HUB, "current_user_id": "u1", "now": NOW},
        )

        row = scalar(f"SELECT is_active FROM appointments_recurring WHERE id = 'r1'")
        if row != "0":
            fail(f"deactivate: is_active is {row!r} after deactivating, expected 0")
        deleted_flag = scalar(
            "SELECT is_deleted FROM appointments_recurring WHERE id = 'r1'"
        )
        if deleted_flag != "0":
            fail(
                f"deactivate: is_deleted moved to {deleted_flag!r} — deactivating must not delete"
            )

        # The regression #91 refused to ship: the deactivated series must still show up in the list.
        listed = {r["id"] for r in run_query(list_sql, {"hub_id": HUB})}
        if "r1" not in listed:
            fail("recurring_list.sql: a deactivated series disappeared from the list")

        # Neighbours are never touched.
        neighbour = scalar(
            "SELECT is_active FROM appointments_recurring WHERE id = 'r-neighbour'"
        )
        if neighbour != "1":
            fail(f"deactivate: touched another hub's series (is_active={neighbour!r})")

        # A soft-deleted series is not resurrected by activate — the WHERE must exclude it.
        run_command(
            activate_sql,
            {
                "recurring_id": "r-gone",
                "hub_id": HUB,
                "current_user_id": "u1",
                "now": NOW,
            },
        )
        gone_active = scalar(
            "SELECT is_active FROM appointments_recurring WHERE id = 'r-gone'"
        )
        if gone_active != "1":
            fail(
                f"activate: a soft-deleted series' is_active is {gone_active!r} — the delete "
                "already set it to 1 alongside is_deleted, and activate must leave a deleted row "
                "alone either way (it must not be reachable from the list to begin with)"
            )
        gone_deleted = scalar(
            "SELECT is_deleted FROM appointments_recurring WHERE id = 'r-gone'"
        )
        if gone_deleted != "1":
            fail(
                f"activate: is_deleted moved to {gone_deleted!r} on a soft-deleted row it must not touch"
            )

        run_command(
            activate_sql,
            {"recurring_id": "r1", "hub_id": HUB, "current_user_id": "u1", "now": NOW},
        )
        reactivated = scalar(
            "SELECT is_active FROM appointments_recurring WHERE id = 'r1'"
        )
        if reactivated != "1":
            fail(
                f"activate: is_active is {reactivated!r} after reactivating, expected 1"
            )
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    check_manifest()
    if not failures:
        deactivate_sql = MANIFEST["commands"][DEACTIVATE]["sql"][0]
        activate_sql = MANIFEST["commands"][ACTIVATE]["sql"][0]
        list_sql = MANIFEST["queries"][LIST_QUERY]["sql"]
        check_against_postgres(deactivate_sql, activate_sql, list_sql)
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {DEACTIVATE} / {ACTIVATE} — manifest wiring + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
