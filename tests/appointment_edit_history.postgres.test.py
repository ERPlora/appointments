#!/usr/bin/env python3
"""Editing ONE appointment leaves its history line — regression of ERPlora/appointments#260.

`appointments.appointments.update` (the declarative edit the assistant, flows and API keys call)
rewrites the professional, the service and the slot of an appointment, and until #260 it wrote no
history at all: the trail kept saying «Booked» while the appointment had changed hands. The series
edit already says it since appointments#253 (`_history_series_move.sql`): «staff_changed», else
«service_changed», else «rescheduled», with what the appointment HAD in `old_value` and what it
has now in `new_value`. A single edit has to say it the SAME way — same actions, same JSON keys —
so the history component paints both identically.

What this battery holds, running the command's WHOLE `sql[]` in ONE transaction with ONE set of
binds, the way the runtime runs a declarative command:

  - a hand-over leaves ONE «staff_changed» line, from Bea to Carla, by the user who did it;
  - a service change leaves ONE «service_changed» line naming both services;
  - professional AND service → «staff_changed» (the professional first), the service in the line;
  - only the time → «rescheduled», with the new start;
  - notes only, or the same instant written with another offset → NO line;
  - an edit the overlap gate refuses rolls back with NO line;
  - a deleted appointment, or another hub's appointment, gets NO line (tenancy);
  - a name with a double quote keeps the line's JSON parseable.

Usage: tests/appointment_edit_history.postgres.test.py   (exit 0 = green)
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
DB = f"appointments_edit_history_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
COMMAND = "appointments.appointments.update"
HISTORY_FILE = "commands/_history_appointment_edit.sql"
UPDATE_FILE = "commands/appointment_update.sql"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def chain_files() -> list[str]:
    files = (MANIFEST.get("commands", {}).get(COMMAND) or {}).get("sql") or []
    return [files] if isinstance(files, str) else list(files)


def check_manifest() -> None:
    """The line is written by the command itself, BEFORE its UPDATE: once the UPDATE has run, the
    row no longer says what the appointment had, and a declarative command has no handler to read
    it beforehand."""
    files = chain_files()
    if HISTORY_FILE not in files:
        fail(
            f"{COMMAND}: its sql[] {files!r} has no history statement ({HISTORY_FILE})"
        )
        return
    if UPDATE_FILE not in files or files.index(HISTORY_FILE) > files.index(UPDATE_FILE):
        fail(
            f"{COMMAND}: {HISTORY_FILE} must run BEFORE {UPDATE_FILE} (sql = {files!r}): after the "
            "UPDATE the row has already forgotten the professional, service and time it had"
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
            f"{literal(start)}, {literal(end)}, 30, 'confirmed', '', '', 0, 0, '', {deleted}, "
            "'2026-09-01T00:00:00+02:00', '2026-09-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def edit(appointment_id: str, hub: str = HUB, **changes) -> str | None:
    """The WHOLE `sql[]` of the update command in ONE transaction, bound once — the payload the
    caller sends (the full set of fields, as the schema requires) plus the runtime's system
    params. Returns None when it committed, else the Postgres error."""
    SEQ[0] += 1
    params = {
        "appointment_id": appointment_id,
        "customer_name": "Ada",
        "customer_phone": "",
        "customer_email": "",
        "service_id": "s-corte",
        "service_name": "Corte",
        "staff_id": "s1",
        "staff_name": "Bea",
        "start_datetime": "2026-09-10T11:00:00+02:00",
        "end_datetime": "2026-09-10T11:30:00+02:00",
        "duration_minutes": 30,
        "notes": "",
        "internal_notes": "",
        "hub_id": hub,
        "current_user_id": "u-front",
        "now": f"2026-09-20T09:00:00.{SEQ[0]:06d}+02:00",
        "new_id": f"h-edit-{SEQ[0]}",
    }
    params.update(changes)
    body = "\n".join(
        shim(bind((MODULE_DIR / f).read_text(), params)) for f in chain_files()
    )
    try:
        psql([], db=DB, stdin=f"BEGIN;\n{body}\nCOMMIT;\n")
        return None
    except RuntimeError as e:
        return str(e)


def history_of(appointment_id: str) -> list[dict]:
    return rows(
        "SELECT hub_id, action, performed_by, old_value, new_value FROM appointments_history "
        f"WHERE appointment_id = {literal(appointment_id)} ORDER BY created_at, id"
    )


def parsed(raw) -> dict:
    return json.loads(raw) if isinstance(raw, str) else (raw or {})


def only_line(appointment_id: str, what: str) -> dict | None:
    lines = history_of(appointment_id)
    if len(lines) != 1:
        fail(f"{HISTORY_FILE}: {what} must leave ONE history line, got {lines!r}")
        return None
    return lines[0]


def check_staff_change() -> None:
    seed("a-staff")
    err = edit("a-staff", staff_id="s2", staff_name="Carla")
    if err:
        fail(f"handing an appointment to Carla was refused: {err}")
        return
    line = only_line("a-staff", "handing the appointment to Carla")
    if not line:
        return
    if line["action"] != "staff_changed":
        fail(
            f"{HISTORY_FILE}: a hand-over wrote {line['action']!r}, expected 'staff_changed'"
        )
    before, after = parsed(line["old_value"]), parsed(line["new_value"])
    if (before.get("staff_id"), before.get("staff_name")) != ("s1", "Bea"):
        fail(
            f"{HISTORY_FILE}: the line does not say who had it before (old={before!r})"
        )
    if (after.get("staff_id"), after.get("staff_name")) != ("s2", "Carla"):
        fail(f"{HISTORY_FILE}: the line does not say who has it now (new={after!r})")
    if (
        after.get("channel") != "staff"
        or after.get("start_datetime") != "2026-09-10T11:00:00+02:00"
    ):
        fail(f"{HISTORY_FILE}: the line lost the channel or the slot (new={after!r})")
    if line["performed_by"] != "u-front":
        fail(
            f"{HISTORY_FILE}: the line does not say who did it ({line['performed_by']!r})"
        )
    if line["hub_id"] != HUB:
        fail(f"{HISTORY_FILE}: the line was written for hub {line['hub_id']!r}")
    staff = scalar("SELECT staff_id FROM appointments_appointment WHERE id = 'a-staff'")
    if staff != "s2":
        fail(f"the edit did not hand the appointment over (staff_id = {staff!r})")


def check_service_change() -> None:
    seed(
        "a-service", start="2026-09-11T11:00:00+02:00", end="2026-09-11T11:30:00+02:00"
    )
    err = edit(
        "a-service",
        service_id="s-color",
        service_name="Corte y color",
        start_datetime="2026-09-11T11:00:00+02:00",
        end_datetime="2026-09-11T11:30:00+02:00",
    )
    if err:
        fail(f"changing the service was refused: {err}")
        return
    line = only_line("a-service", "changing the service")
    if not line:
        return
    if line["action"] != "service_changed":
        fail(
            f"{HISTORY_FILE}: a service change wrote {line['action']!r}, expected 'service_changed'"
        )
    before, after = parsed(line["old_value"]), parsed(line["new_value"])
    if (
        before.get("service_name") != "Corte"
        or after.get("service_name") != "Corte y color"
    ):
        fail(
            f"{HISTORY_FILE}: the line does not name both services (old={before!r}, new={after!r})"
        )
    if before.get("service_id") != "s-corte" or after.get("service_id") != "s-color":
        fail(
            f"{HISTORY_FILE}: the line does not carry both service ids (old={before!r}, new={after!r})"
        )


def check_staff_and_service_change() -> None:
    seed("a-both", start="2026-09-12T11:00:00+02:00", end="2026-09-12T11:30:00+02:00")
    err = edit(
        "a-both",
        staff_id="s2",
        staff_name="Carla",
        service_id="s-color",
        service_name="Corte y color",
        start_datetime="2026-09-12T11:00:00+02:00",
        end_datetime="2026-09-12T11:30:00+02:00",
    )
    if err:
        fail(f"changing professional and service was refused: {err}")
        return
    line = only_line("a-both", "changing professional AND service")
    if not line:
        return
    if line["action"] != "staff_changed":
        fail(
            f"{HISTORY_FILE}: professional + service wrote {line['action']!r}, expected 'staff_changed'"
        )
    if parsed(line["new_value"]).get("service_name") != "Corte y color":
        fail(f"{HISTORY_FILE}: the service change was lost from the line ({line!r})")


def check_time_change() -> None:
    seed("a-time", start="2026-09-13T11:00:00+02:00", end="2026-09-13T11:30:00+02:00")
    err = edit(
        "a-time",
        start_datetime="2026-09-13T16:00:00+02:00",
        end_datetime="2026-09-13T16:30:00+02:00",
    )
    if err:
        fail(f"moving the appointment was refused: {err}")
        return
    line = only_line("a-time", "moving only the time")
    if not line:
        return
    if line["action"] != "rescheduled":
        fail(
            f"{HISTORY_FILE}: a time change wrote {line['action']!r}, expected 'rescheduled'"
        )
    after = parsed(line["new_value"])
    if after.get("start_datetime") != "2026-09-13T16:00:00+02:00":
        fail(f"{HISTORY_FILE}: the line does not carry the new start (new={after!r})")
    if parsed(line["old_value"]).get("start_datetime") != "2026-09-13T11:00:00+02:00":
        fail(f"{HISTORY_FILE}: the line does not carry the start it had ({line!r})")


def check_length_change() -> None:
    """Same start, longer appointment: the slot changed, so the trail says so."""
    seed("a-length", start="2026-09-14T11:00:00+02:00", end="2026-09-14T11:30:00+02:00")
    err = edit(
        "a-length",
        start_datetime="2026-09-14T11:00:00+02:00",
        end_datetime="2026-09-14T12:00:00+02:00",
        duration_minutes=60,
    )
    if err:
        fail(f"lengthening the appointment was refused: {err}")
        return
    line = only_line("a-length", "lengthening the appointment")
    if line and line["action"] != "rescheduled":
        fail(
            f"{HISTORY_FILE}: a new length wrote {line['action']!r}, expected 'rescheduled'"
        )

    # Same end, earlier start: only the start tells the move.
    seed(
        "a-earlier", start="2026-09-14T15:00:00+02:00", end="2026-09-14T15:30:00+02:00"
    )
    err = edit(
        "a-earlier",
        start_datetime="2026-09-14T14:30:00+02:00",
        end_datetime="2026-09-14T15:30:00+02:00",
        duration_minutes=60,
    )
    if err:
        fail(f"starting the appointment earlier was refused: {err}")
        return
    line = only_line("a-earlier", "starting the appointment earlier")
    if line and line["action"] != "rescheduled":
        fail(
            f"{HISTORY_FILE}: an earlier start wrote {line['action']!r}, expected 'rescheduled'"
        )


def check_no_line_without_a_change() -> None:
    seed("a-notes", start="2026-09-15T11:00:00+02:00", end="2026-09-15T11:30:00+02:00")
    err = edit(
        "a-notes",
        start_datetime="2026-09-15T11:00:00+02:00",
        end_datetime="2026-09-15T11:30:00+02:00",
        notes="Prefers the window seat",
    )
    if err:
        fail(f"editing the notes was refused: {err}")
        return
    if history_of("a-notes"):
        fail(
            f"{HISTORY_FILE}: editing only the notes left a history line: {history_of('a-notes')!r}"
        )
    if (
        scalar("SELECT notes FROM appointments_appointment WHERE id = 'a-notes'")
        != "Prefers the window seat"
    ):
        fail("the notes-only edit did not save the notes")

    # The same instant written in UTC is not a move.
    seed("a-utc", start="2026-09-16T11:00:00+02:00", end="2026-09-16T11:30:00+02:00")
    err = edit(
        "a-utc",
        start_datetime="2026-09-16T09:00:00Z",
        end_datetime="2026-09-16T09:30:00Z",
        notes="same slot, other offset",
    )
    if err:
        fail(f"re-sending the same slot in UTC was refused: {err}")
        return
    if history_of("a-utc"):
        fail(
            f"{HISTORY_FILE}: the same instant written with another offset was recorded as a move: "
            f"{history_of('a-utc')!r}"
        )


def check_refused_edit_leaves_no_line() -> None:
    seed(
        "a-busy",
        staff=("s2", "Carla"),
        start="2026-09-17T11:00:00+02:00",
        end="2026-09-17T11:30:00+02:00",
    )
    seed(
        "a-refused", start="2026-09-17T11:00:00+02:00", end="2026-09-17T11:30:00+02:00"
    )
    err = edit(
        "a-refused",
        staff_id="s2",
        staff_name="Carla",
        start_datetime="2026-09-17T11:00:00+02:00",
        end_datetime="2026-09-17T11:30:00+02:00",
    )
    if err is None:
        fail("the overlap gate let Carla be double-booked: the scenario proves nothing")
        return
    if history_of("a-refused"):
        fail(
            f"{HISTORY_FILE}: an edit the overlap gate refused left a line: {history_of('a-refused')!r}"
        )


def check_deleted_and_other_hub() -> None:
    seed(
        "a-deleted",
        start="2026-09-18T11:00:00+02:00",
        end="2026-09-18T11:30:00+02:00",
        deleted=1,
    )
    err = edit(
        "a-deleted",
        staff_id="s2",
        staff_name="Carla",
        start_datetime="2026-09-18T11:00:00+02:00",
        end_datetime="2026-09-18T11:30:00+02:00",
    )
    if err:
        fail(f"editing a deleted appointment raised instead of being a no-op: {err}")
    elif history_of("a-deleted"):
        fail(
            f"{HISTORY_FILE}: it wrote a history line on a deleted appointment: {history_of('a-deleted')!r}"
        )

    # The neighbour hub calls the edit with THIS hub's appointment id: nothing may be written.
    seed("a-mine", start="2026-09-19T11:00:00+02:00", end="2026-09-19T11:30:00+02:00")
    err = edit(
        "a-mine",
        hub=OTHER_HUB,
        staff_id="s2",
        staff_name="Carla",
        start_datetime="2026-09-19T11:00:00+02:00",
        end_datetime="2026-09-19T11:30:00+02:00",
    )
    if err:
        fail(f"the neighbour's edit raised instead of being a no-op: {err}")
    elif history_of("a-mine"):
        fail(
            f"{HISTORY_FILE}: it wrote a history line on another hub's appointment: "
            f"{history_of('a-mine')!r}"
        )


def check_quotes_keep_json_valid() -> None:
    seed("a-quote", start="2026-09-21T11:00:00+02:00", end="2026-09-21T11:30:00+02:00")
    err = edit(
        "a-quote",
        staff_id="s3",
        staff_name='Eva "la rápida" \\ Pérez',
        start_datetime="2026-09-21T11:00:00+02:00",
        end_datetime="2026-09-21T11:30:00+02:00",
    )
    if err:
        fail(f"handing over to a quoted name was refused: {err}")
        return
    line = only_line("a-quote", "handing over to a quoted name")
    if not line:
        return
    try:
        json.loads(line["new_value"])
        json.loads(line["old_value"])
    except (TypeError, json.JSONDecodeError) as exc:
        fail(
            f"{HISTORY_FILE}: a name with a double quote broke the line's JSON ({exc})"
        )


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
        check_staff_change()
        check_service_change()
        check_staff_and_service_change()
        check_time_change()
        check_length_change()
        check_no_line_without_a_change()
        check_refused_edit_leaves_no_line()
        check_deleted_and_other_hub()
        check_quotes_keep_json_valid()
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
        "ok: editing one appointment leaves its history line, and only when something changed"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
