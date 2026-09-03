#!/usr/bin/env python3
"""`appointments__gate` — every refusal has to name ITS OWN gate (appointments#103).

`appointments__gate` was created (migration 003) with a single anonymous column check,
`CHECK (ok = 1)`, which Postgres auto-names `appointments__gate_ok_check`. Both of this module's
gates — `appointment_no_overlap` (the double-booking guard of `reschedule`/`update`,
appointments#20) and `appointment_reschedulable` (the terminal-state guard of `reschedule`,
appointments#21) — therefore refused with the SAME primary message, and the name of the gate that
actually fired travelled only in the DETAIL field of the wire protocol:

    ERROR:   new row for relation "appointments__gate" violates check constraint "appointments__gate_ok_check"
    DETAIL:  Failing row contains (appointment_no_overlap, 0).

DETAIL never reaches the caller: a refusal arrives as `sqlx::Error::Database` wrapping
`PgDatabaseError`, whose `Display` writes only the PRIMARY message (sqlx-postgres
`src/error.rs`), and whose `message()` does not carry DETAIL either. So any code branching on the
text to say WHICH invariant tripped could never match, and the two gates were indistinguishable
from the caller's side — the log's, the assistant's, or a screen's.

Migration 008 moves each gate's identity from the ROW into its own CONSTRAINT NAME, which IS part
of the primary message, and adds `appointments__gate_is_declared` so a gate nobody registered
here still fails CLOSED instead of slipping through once the anonymous catch-all is gone.

This file pins that contract directly against the table, the way the migration guarantees it —
not through a command's `sql[]` chain, since both gates already have handler-level coverage
(`cargo test`) for WHEN they fire; what was missing is proof of WHAT the caller is told once one
does.

Usage: tests/gate_constraints.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  scratch database and DROPS it at the end, pass or fail. Without the container the Postgres layer
  is SKIPPED, never passed.
"""

import json
import os
import pathlib
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_gate_constraints_test_{os.getpid()}"

GATES = ("appointment_no_overlap", "appointment_reschedulable")

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


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


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def as_the_caller_sees_it(pg_stderr: str) -> str:
    """What the RUNTIME hands the caller: `PgDatabaseError::Display` writes only the PRIMARY
    message, never the DETAIL field where psql prints the failing row. A battery that greps
    psql's whole stderr would prove nothing about what the caller can actually see — keep only
    the `ERROR:` line."""
    for line in pg_stderr.splitlines():
        line = line.strip()
        if line.startswith("ERROR:"):
            return line[len("ERROR:") :].strip()
    return " ".join(pg_stderr.split())


def check_contains(label: str, needle: str, haystack: str) -> None:
    if needle in haystack:
        print(f"  ok: {label} names `{needle}`")
    else:
        one_line = " ".join(haystack.split())[:220]
        fail(f"{label} - `{needle}` is not in the refusal text: {one_line}")
        print(f"  FAIL: {label} - `{needle}` is not in the refusal text: {one_line}")


def load_migrations() -> None:
    for entry in MANIFEST["migrations"]["postgres"]:
        rel = entry if isinstance(entry, str) else entry["file"]
        psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())


def gate_insert(gate: str, ok: int) -> None:
    psql(
        [],
        db=DB,
        stdin=f"INSERT INTO appointments__gate (gate, ok) VALUES ({literal(gate)}, {ok});",
    )


# -- The tests -----------------------------------------------------------------------------


def test_every_gate_names_itself_and_not_the_other() -> None:
    """Postgres does not promise an evaluation order between constraints, so this pins the
    ACTUAL behaviour rather than assuming it: for a row naming gate X, the refusal must contain
    X's own constraint name and must NOT contain the other gate's."""
    print("\ngate table: every gate refuses under its own name")
    for gate in GATES:
        other = next(g for g in GATES if g != gate)
        try:
            gate_insert(gate, 0)
            fail(f"gate `{gate}` accepted ok = 0")
            print(f"  FAIL: gate `{gate}` accepted ok = 0")
        except RuntimeError as exc:
            seen = as_the_caller_sees_it(str(exc))
            check_contains(f"the `{gate}` refusal", gate, seen)
            # The relation name has to stay in the text too: it is what a screen not yet taught
            # this specific gate still keys on.
            check_contains(f"the `{gate}` refusal", "appointments__gate", seen)
            if other in seen:
                fail(
                    f"the `{gate}` refusal also names `{other}` — the two are not distinguishable"
                )
                print(f"  FAIL: the `{gate}` refusal also names `{other}`")


def test_undeclared_gate_fails_closed() -> None:
    """The whitelist is what lets the anonymous catch-all retire without opening a hole: a gate
    nobody registered here must still be refused, never silently accepted."""
    print("\ngate table: a gate nobody declared fails CLOSED")
    try:
        gate_insert("a_gate_nobody_declared", 0)
        fail("an undeclared gate was accepted - the table fails OPEN")
        print("  FAIL: an undeclared gate was accepted - the table fails OPEN")
    except RuntimeError as exc:
        check_contains(
            "the undeclared gate",
            "appointments__gate_is_declared",
            as_the_caller_sees_it(str(exc)),
        )


def test_a_passing_gate_still_inserts() -> None:
    """The happy path is untouched: `ok = 1` for a declared gate still writes its row."""
    print("\ngate table: a passing gate still inserts")
    for gate in GATES:
        gate_insert(gate, 1)
    count = psql(["-tAc", "SELECT count(*) FROM appointments__gate"], db=DB).strip()
    if count != str(len(GATES)):
        fail(f"expected {len(GATES)} passing rows, got {count}")
        print(f"  FAIL: expected {len(GATES)} passing rows, got {count}")
    else:
        print(f"  ok: {count} passing row(s) inserted")
    psql([], db=DB, stdin="DELETE FROM appointments__gate;")


def main() -> int:
    if not docker_available():
        print(f"SKIPPED: no Postgres in container {CONTAINER!r}")
        return 0

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        load_migrations()
        test_every_gate_names_itself_and_not_the_other()
        test_undeclared_gate_fails_closed()
        test_a_passing_gate_still_inserts()
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])

    print()
    if failures:
        print(f"FAILED - {len(failures)} assertion(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS - every appointments__gate refusal names itself (appointments#103)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
