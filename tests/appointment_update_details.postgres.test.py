#!/usr/bin/env python3
"""Editing ONE appointment: the details write and the edit's whole chain — regression of
ERPlora/appointments#271 (and of #260, whose history line it keeps).

`appointments.appointments.update` (the edit the assistant, flows and API keys call) was a declarative
UPDATE that wrote the professional, the service, their names and the slot exactly as the caller sent
them. Since #271 it runs the WASM handler `update_appointment`: the professional, the service and the
slot take the agenda's road (`_reschedule_row`, judged by `reschedule`), and the customer's contact
and the notes are written by `appointments._update_details` (commands/appointment_update.sql).

What this battery holds, running each operation's `sql[]` in ONE transaction the way the runtime runs
a WASM operation:

  - the details write saves the contact and the notes and NOTHING else: not the professional, not the
    service, not its price, not the slot — and it leaves no history line;
  - it writes the notes of an appointment that already happened (no status filter);
  - a deleted appointment, or another hub's, is never written (tenancy);
  - an edit that hands the appointment over (the chain the handler emits: state assert, row move,
    details, drain) writes Carla AND the notes, and leaves ONE «staff_changed» line (#260).

Usage: tests/appointment_update_details.postgres.test.py   (exit 0 = green)
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

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_update_details_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
EDIT = "appointments.appointments.update"
DETAILS = "appointments._update_details"
DETAILS_FILE = "commands/appointment_update.sql"
# What the handler emits for an edit that moves the slot or hands the appointment over.
EDIT_CHAIN = [
    "appointments._reschedule_state_assert",
    "appointments._reschedule_row",
    DETAILS,
    "appointments._gate_clear",
]

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def files_of(command: str) -> list[str]:
    files = (MANIFEST.get("commands", {}).get(command) or {}).get("sql") or []
    return [files] if isinstance(files, str) else list(files)


def check_manifest() -> None:
    """The edit is the handler's; its details write is its own private command."""
    edit = MANIFEST.get("commands", {}).get(EDIT) or {}
    if (edit.get("handler") or {}).get("function") != "update_appointment":
        fail(f"{EDIT}: it does not run the handler `update_appointment`: {edit!r}")
    if edit.get("sql"):
        fail(f"{EDIT}: it still declares a declarative sql[] {edit['sql']!r}")
    if files_of(DETAILS) != [DETAILS_FILE]:
        fail(f"{DETAILS}: its sql[] is {files_of(DETAILS)!r}, expected [{DETAILS_FILE!r}]")
    for command in EDIT_CHAIN:
        if not files_of(command):
            fail(f"{command}: the handler emits it but it declares no sql[]")


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
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def _call_args(sql: str, start: int) -> tuple[list[str], int]:
    depth, args, buf, i, quoted = 0, [], "", start, False
    while i < len(sql):
        c = sql[i]
        if quoted:
            buf += c
            if c == "'":
                quoted = False
        elif c == "'":
            quoted = True
            buf += c
        elif c == "(":
            depth += 1
            if depth > 1:
                buf += c
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(buf)
                return args, i + 1
            buf += c
        elif c == "," and depth == 1:
            args.append(buf)
            buf = ""
        else:
            buf += c
        i += 1
    raise ValueError("unbalanced call")


def shim(sql: str) -> str:
    """Bridge functions (ADR-0007 §4a) — mirror of `hub/crates/db/src/lib.rs::shim_functions`."""
    forms = {
        "erp_dt": lambda a: f"(({a[0]})::timestamptz)",
        "erp_date": lambda a: f"(({a[0]})::date)",
    }
    for name, render in forms.items():
        while True:
            m = re.search(rf"\b{name}\(", sql)
            if not m:
                break
            args, end = _call_args(sql, m.end() - 1)
            sql = sql[: m.start()] + render(args) + sql[end:]
    return sql


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def rows(sql: str) -> list[dict]:
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({sql}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


# ── Scenarios ────────────────────────────────────────────────────────────────────────────

SEQ = [0]


def seed(
    id_: str,
    hub: str = HUB,
    staff: tuple[str, str] = ("s1", "Bea"),
    start: str = "2026-09-10T11:00:00+02:00",
    end: str = "2026-09-10T11:30:00+02:00",
    status: str = "confirmed",
    deleted: int = 0,
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, "
            "is_deleted, created_at, updated_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', '', '', "
            f"{literal(staff[0])}, {literal(staff[1])}, 's-corte', 'Corte', 2000, "
            f"{literal(start)}, {literal(end)}, 30, {literal(status)}, '', '', 0, 0, '', "
            f"{deleted}, '2026-09-01T00:00:00+02:00', '2026-09-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def system(hub: str) -> dict:
    SEQ[0] += 1
    return {
        "hub_id": hub,
        "current_user_id": "u-front",
        "now": f"2026-09-20T09:00:00.{SEQ[0]:06d}+02:00",
        "new_id": f"h-edit-{SEQ[0]}",
    }


def details(appointment_id: str, **changes) -> dict:
    """The binds the handler gives `_update_details`: the caller's contact and notes."""
    return {
        "appointment_id": appointment_id,
        "customer_name": "Ada Lovelace",
        "customer_phone": "+34600000001",
        "customer_email": "ada@example.com",
        "notes": "Prefers the window seat",
        "internal_notes": "pays cash",
        **changes,
    }


def run(commands: list[str], params: dict, hub: str = HUB) -> str | None:
    """Each operation in the chain gets its own system params (its own `:now`), as the runtime binds
    a WASM handler's operations; one transaction for the whole command. None = committed."""
    body = "\n".join(
        shim(bind((MODULE_DIR / f).read_text(), {**params, **system(hub)}))
        for c in commands
        for f in files_of(c)
    )
    try:
        psql([], db=DB, stdin=f"BEGIN;\n{body}\nCOMMIT;\n")
        return None
    except RuntimeError as e:
        return str(e)


def row(appointment_id: str, hub: str = HUB) -> dict:
    found = rows(
        "SELECT customer_name, customer_phone, customer_email, notes, internal_notes, staff_id, "
        "staff_name, service_id, service_name, service_price, start_datetime, end_datetime, "
        f"duration_minutes, updated_by FROM appointments_appointment WHERE id = {literal(appointment_id)} "
        f"AND hub_id = {literal(hub)}"
    )
    return found[0] if found else {}


def history_of(appointment_id: str) -> list[dict]:
    return rows(
        "SELECT hub_id, action, performed_by, old_value, new_value FROM appointments_history "
        f"WHERE appointment_id = {literal(appointment_id)} ORDER BY created_at, id"
    )


UNTOUCHED = {
    "staff_id": "s1",
    "staff_name": "Bea",
    "service_id": "s-corte",
    "service_name": "Corte",
    "service_price": 2000,
    "duration_minutes": 30,
}


def check_details_write_only_the_details() -> None:
    seed("a-notes")
    # Binds a caller could have smuggled in are NOT the write's: they must not reach the row.
    err = run(
        [DETAILS],
        details("a-notes", staff_id="s2", staff_name="Carla", service_id="s-x",
                service_price=1, start_datetime="2026-09-10T18:00:00+02:00"),
    )
    if err:
        fail(f"the details write was refused: {err}")
        return
    got = row("a-notes")
    for key, want in details("a-notes").items():
        if key != "appointment_id" and got.get(key) != want:
            fail(f"{DETAILS_FILE}: {key} = {got.get(key)!r}, expected {want!r}")
    for key, want in UNTOUCHED.items():
        if got.get(key) != want:
            fail(f"{DETAILS_FILE}: it rewrote {key} ({got.get(key)!r}, had {want!r})")
    if not str(got.get("start_datetime", "")).startswith("2026-09-10T11:00"):
        fail(f"{DETAILS_FILE}: it moved the slot ({got.get('start_datetime')!r})")
    if got.get("updated_by") != "u-front":
        fail(f"{DETAILS_FILE}: it does not stamp who edited ({got.get('updated_by')!r})")
    if history_of("a-notes"):
        fail(f"{DETAILS_FILE}: editing the notes left a history line: {history_of('a-notes')!r}")


def check_details_of_a_finished_appointment() -> None:
    seed("a-done", status="completed")
    err = run([DETAILS], details("a-done"))
    if err:
        fail(f"the notes of a finished appointment were refused: {err}")
    elif row("a-done").get("notes") != "Prefers the window seat":
        fail(f"{DETAILS_FILE}: the notes of a finished appointment were not written")


def check_deleted_and_other_hub() -> None:
    seed("a-deleted", deleted=1)
    err = run([DETAILS], details("a-deleted"))
    if err:
        fail(f"editing a deleted appointment raised instead of being a no-op: {err}")
    elif row("a-deleted").get("notes") != "":
        fail(f"{DETAILS_FILE}: it wrote a deleted appointment")

    # The neighbour hub calls the write with THIS hub's appointment id: nothing may be written.
    seed("a-mine")
    err = run([DETAILS], details("a-mine"), hub=OTHER_HUB)
    if err:
        fail(f"the neighbour's edit raised instead of being a no-op: {err}")
    elif row("a-mine").get("notes") != "":
        fail(f"{DETAILS_FILE}: it reached another hub's appointment ({row('a-mine')!r})")


def check_edit_that_hands_over() -> None:
    """The chain the handler emits for «same slot, Carla instead of Bea, and a note»."""
    seed("a-handover", start="2026-09-12T11:00:00+02:00", end="2026-09-12T11:30:00+02:00")
    params = {
        **details("a-handover"),
        "start_datetime": "2026-09-12T11:00:00+02:00",
        "end_datetime": "2026-09-12T11:30:00+02:00",
        "duration_minutes": 30,
        "channel": "staff",
        "staff_id": "s2",
        "staff_name": "Carla",
        "service_id": "",
        "service_name": "",
        "service_price": 0,
        "from_staff_id": "s1",
        "from_staff_name": "Bea",
        "from_service_id": "s-corte",
        "from_service_name": "Corte",
        "from_start_datetime": "2026-09-12T11:00:00+02:00",
    }
    err = run(EDIT_CHAIN, params)
    if err:
        fail(f"handing the appointment to Carla was refused: {err}")
        return
    got = row("a-handover")
    if (got.get("staff_id"), got.get("staff_name")) != ("s2", "Carla"):
        fail(f"the edit did not hand the appointment over ({got!r})")
    if (got.get("service_id"), got.get("service_price")) != ("s-corte", 2000):
        fail(f"the hand-over lost the service or its price ({got!r})")
    if got.get("notes") != "Prefers the window seat":
        fail(f"the edit moved the row but dropped the notes ({got!r})")
    lines = history_of("a-handover")
    if [line["action"] for line in lines] != ["staff_changed"]:
        fail(f"the edit must leave ONE «staff_changed» line (#260), got {lines!r}")
    left = scalar("SELECT count(*) FROM appointments__gate")
    if left != "0":
        fail(f"the edit left {left} row(s) in appointments__gate")


def check_against_postgres() -> None:
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
        check_details_write_only_the_details()
        check_details_of_a_finished_appointment()
        check_deleted_and_other_hub()
        check_edit_that_hands_over()
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    check_manifest()
    check_against_postgres()
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(
        "ok: an edit writes the details it owns, and moves or hands over only through the agenda's "
        "chain, with its history line"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
