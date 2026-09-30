#!/usr/bin/env python3
"""Editing a series «this and all following» — the SQL side (appointments#15).

`cargo test` proves what the handler DECIDES: which occurrences move, that the past is frozen, that
a cancelled one stays cancelled and an invoiced one is locked, and that the count of a bounded
series is split instead of doubled. What it cannot see is whether the statements it emits actually
run, and whether the DOOR they go through is really shut.

That distinction is the whole point. `_recurring_move_occurrence.sql` carries its guard in the
`WHERE`, not in the handler: `status IN ('pending','confirmed')` and no `converted_sale_id`. A
handler that got it wrong would still be stopped there — but only if the clause is right, and a
guard nobody proved rejects anything is a guard that opens (appointments#16, and the same lesson as
`tenancy-scoping-tests-that-prove-nothing`).

So this file covers, against a scratch Postgres built from this module's own migrations:

  1. MANIFEST + MIGRATION. `appointments.recurring.update` is declared with its closed `scope`
     enum, its two `required` reads, and migration 007 is in the shipped list.
  2. REAL POSTGRES.
     - migration 007 applies and `split_from_id` exists;
     - `_recurring_split` inserts the new half with the trail back to the old one;
     - `_recurring_close` writes the `UNTIL` without deactivating or deleting the old half;
     - `_recurring_move_occurrence` MOVES a `pending`/`confirmed` occurrence…
     - …and REFUSES to touch one that is `completed`, `cancelled`, soft-deleted, already turned
       into a sale, or belongs to another hub — each one checked separately, because a `WHERE`
       that is too tight and one that is too loose fail in opposite directions;
     - the occurrences read hands back the columns the move needs (`id`, `converted_sale_id`).

Usage: tests/recurring_series_split.postgres.test.py   (exit 0 = green)
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

COMMAND = "appointments.recurring.update"
MIGRATION = "migrations/postgres/007_recurring_split.sql"
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_series_split_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"
NOW = "2026-08-20T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest + migration ────────────────────────────────────────────────────────


def check_manifest() -> None:
    if MIGRATION not in MANIFEST.get("migrations", {}).get("postgres", []):
        fail(
            f"migrations.postgres: {MIGRATION!r} is not shipped — split_from_id would not exist"
        )

    cmd = MANIFEST.get("commands", {}).get(COMMAND)
    if not isinstance(cmd, dict):
        fail(f"{COMMAND}: not declared in module.json")
        return
    if cmd.get("transaction") is not True:
        fail(
            f"{COMMAND}: must be transactional — a half-split series is two truths at once"
        )

    schema_rel = cmd.get("schema")
    if not schema_rel or not (MODULE_DIR / schema_rel).exists():
        fail(f"{COMMAND}.schema: {schema_rel!r} is not in the package")
    else:
        schema = json.loads((MODULE_DIR / schema_rel).read_text())
        scope = (schema.get("properties") or {}).get("scope") or {}
        # A CLOSED set. «all» arriving as a typo and rewriting a past that is already invoiced is
        # exactly what must fail validation instead of falling into a default.
        if scope.get("enum") != ["this_and_following"]:
            fail(
                f"{schema_rel}: scope must be a closed enum, got {scope.get('enum')!r}"
            )
        if schema.get("additionalProperties") is not False:
            fail(f"{schema_rel}: additionalProperties must be false")
        # appointments#236: and the series' professional, the selector her agenda and her days
        # are read by — without it the moves would be judged on nobody's agenda.
        if set(schema.get("required") or []) != {
            "recurring_id",
            "scope",
            "from_occurrence_date",
            "staff_id",
        }:
            fail(
                f"{schema_rel}: required must name the series, the scope, the cut and the "
                "professional"
            )

    reads = {r.get("query"): r for r in cmd.get("reads") or [] if isinstance(r, dict)}
    for needed in ("appointments.recurring.get", "appointments.recurring.occurrences"):
        read = reads.get(needed)
        if read is None:
            fail(
                f"{COMMAND}.reads: missing {needed!r} — the split would be decided from the payload"
            )
        elif read.get("required") is not True:
            fail(
                f"{COMMAND}.reads[{needed}]: must be `required`. Moving «the following ones» "
                "without knowing what is on the books is moving an unknown set"
            )

    # A `required` read keyed by a payload field the schema does NOT require is fed a null key on
    # every edit that leaves it out — and a query whose params demand a string refuses it, which
    # aborts the WHOLE command with `read_unavailable`. Seen on the real hub: after
    # appointments#252 keyed `services.services.get` by `payload.service_id`, an edit that only
    # changes the TIME (the screen sends no service then) was refused. The handler already refuses
    # a service change whose catalogue read is missing (`catalog_unavailable`), so that read does
    # not need to abort anything. Only a query proven to answer a null key may stay required.
    null_key_tolerant = {
        # appointments#248: no params schema, and its SQL compares `:service_id`, so a null key
        # answers no rows instead of failing — `services.services.get` declares a schema that
        # demands a string.
        "staff.services.eligible_for_service",
    }
    schema_required = set()
    if schema_rel and (MODULE_DIR / schema_rel).exists():
        schema_required = set(
            json.loads((MODULE_DIR / schema_rel).read_text()).get("required") or []
        )
    for read in cmd.get("reads") or []:
        if not isinstance(read, dict) or read.get("required") is not True:
            continue
        optional_keys = [
            src
            for src in (read.get("params") or {}).values()
            if isinstance(src, str)
            and src.startswith("payload.")
            and src.split(".", 1)[1] not in schema_required
        ]
        if optional_keys and read.get("query") not in null_key_tolerant:
            fail(
                f"{COMMAND}.reads[{read.get('query')}]: `required` but keyed by {optional_keys} "
                "that the payload may leave out — every edit without it would be aborted "
                "(read_unavailable)"
            )

    # The read has to hand back what the move needs, or the handler cannot address a row.
    occ_sql = (
        MODULE_DIR / MANIFEST["queries"]["appointments.recurring.occurrences"]["sql"]
    ).read_text()
    # appointments#236: `staff_id` too — an occurrence handed to another professional cannot be
    # judged on the series' professional's agenda. appointments#253: and who does it and what
    # service it is, by name — the history line of a move says what the occurrence HAD.
    for column in (
        "id",
        "converted_sale_id",
        "start_datetime",
        "staff_id",
        "staff_name",
        "service_id",
        "service_name",
    ):
        if not re.search(rf"\b{column}\b", occ_sql.split("FROM")[0]):
            fail(
                f"recurring_occurrences.sql: does not select {column} — the split cannot use it"
            )

    move = (MODULE_DIR / "commands/_recurring_move_occurrence.sql").read_text()
    if "updated_at = :now" not in move:
        fail(
            "_recurring_move_occurrence.sql: must pin the run with updated_at = :now, or the "
            "history statement would record a move that did not happen"
        )

    # Every move leaves its history line, as the SECOND statement of the same command: the line
    # finds the row by `updated_at = :now`, and the runtime mints a fresh `:now` for every operation
    # a WASM handler returns, so an operation of its own would never match (appointments#196).
    move_sql = (
        MANIFEST.get("commands", {}).get("appointments._recurring_move_occurrence") or {}
    ).get("sql")
    # appointments#253: its OWN history statement, not the one of a single reschedule — a series
    # move can hand the appointment to another professional or change its service, and the line
    # has to say so instead of «rescheduled».
    if move_sql != [
        "commands/_recurring_move_occurrence.sql",
        "commands/_history_series_move.sql",
    ]:
        fail(
            "appointments._recurring_move_occurrence: must run the move then its history line "
            f"(commands/_history_series_move.sql) in the same command, got {move_sql!r}"
        )

    check_pattern_manifest(move)


def check_pattern_manifest(move_sql: str) -> None:
    """appointments#90 — changing the PATTERN (frequency / day_of_week).

    Occurrences land on DIFFERENT days, so there is no 1:1 with what is already booked: what no
    longer fits is cancelled. The whole point of the issue is that the cancel must go through the
    SAME door as the move, not a new laxer one — `_cancel_row` would have let an `in_progress` or
    an already invoiced appointment through, because its WHERE only knows `cancelled`/`completed`.
    """
    schema_rel = (MANIFEST.get("commands", {}).get(COMMAND) or {}).get("schema")
    if schema_rel and (MODULE_DIR / schema_rel).exists():
        props = (
            json.loads((MODULE_DIR / schema_rel).read_text()).get("properties") or {}
        )
        frequency = props.get("frequency") or {}
        if frequency.get("enum") != ["daily", "weekly", "biweekly", "monthly"]:
            fail(
                f"{schema_rel}: frequency must be the same closed enum as recurring_create, "
                f"got {frequency.get('enum')!r}"
            )
        dow = props.get("day_of_week") or {}
        if dow.get("minimum") != 0 or dow.get("maximum") != 6:
            fail(f"{schema_rel}: day_of_week must be bounded to 0..6, got {dow!r}")
        # ADR-0073: the binder applies JSON Schema defaults BEFORE the handler, so a default here
        # would make the key never arrive absent — and «leave the pattern alone» would be dead code.
        for key in ("frequency", "day_of_week"):
            if "default" in (props.get(key) or {}):
                fail(
                    f"{schema_rel}: {key} must NOT declare a default (ADR-0073) — absent means "
                    "«do not touch the pattern», and a default would erase that state"
                )

    cancel_rel = "commands/_recurring_cancel_occurrence.sql"
    cancel_cmd = MANIFEST.get("commands", {}).get(
        "appointments._recurring_cancel_occurrence"
    )
    if not isinstance(cancel_cmd, dict):
        fail(
            "appointments._recurring_cancel_occurrence: not declared in module.json — a pattern "
            "change would leave the bookings that no longer fit sitting on the old days"
        )
        return
    if cancel_cmd.get("permission") != "appointments.change_appointment":
        fail(
            "_recurring_cancel_occurrence: must need change_appointment, like every other "
            "sub-step of the split"
        )
    # Its history line is the SECOND statement of the same command, never an operation of its own:
    # it finds the row by `updated_at = :now`, and the runtime mints a fresh `:now` for every
    # operation a WASM handler returns (appointments#196).
    if cancel_cmd.get("sql") != [cancel_rel, "commands/_history_cancel.sql"]:
        fail(
            f"_recurring_cancel_occurrence: must run {cancel_rel!r} then its history line, got "
            f"{cancel_cmd.get('sql')!r}"
        )
    if not (MODULE_DIR / cancel_rel).exists():
        fail(f"{cancel_rel}: not in the package")
        return

    cancel = (MODULE_DIR / cancel_rel).read_text()
    if "updated_at = :now" not in cancel:
        fail(
            f"{cancel_rel}: must pin the run with updated_at = :now, or _history_cancel would "
            "record a cancellation that did not happen"
        )
    # THE SAME DOOR, literally: the two guards that decide what a split may touch have to be the
    # same clause in both statements, or one of them is a second, laxer entrance.
    for clause in (
        "status IN ('pending', 'confirmed')",
        "converted_sale_id IS NULL OR converted_sale_id = ''",
    ):
        if clause not in move_sql:
            fail(
                f"_recurring_move_occurrence.sql: expected guard {clause!r} is gone — this test "
                "compares the two doors and can no longer see the reference one"
            )
        if clause not in cancel:
            fail(f"{cancel_rel}: does not carry the guard {clause!r} of the move door")

    # And the edit-in-place branch has to write the pattern, or a cut at the first occurrence would
    # save the new time with the OLD frequency.
    edit = (MODULE_DIR / "commands/_recurring_edit.sql").read_text()
    for column in ("frequency", "day_of_week"):
        if not re.search(rf"{column}\s*=\s*:{column}", edit):
            fail(
                f"_recurring_edit.sql: does not write {column} — cutting at the first occurrence "
                "would keep the old pattern"
            )


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
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def run_command(sql_rel: str, params: dict) -> None:
    psql([], db=DB, stdin=bind((MODULE_DIR / sql_rel).read_text(), params))


def scalar(sql: str) -> str:
    return psql(["-t", "-A", "-c", sql], db=DB).strip()


def seed_series(series_id: str, hub: str = HUB) -> None:
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


def seed_occurrence(
    id_: str,
    hub: str,
    series: str,
    day: str,
    status: str = "confirmed",
    sale: str | None = None,
    deleted: int = 0,
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, "
            "converted_sale_id, recurring_id, occurrence_date, is_deleted, created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', '', '', 's1', 'Bea', "
            f"'s-corte', 'Corte', 2000, '{day}T11:00:00+02:00', '{day}T11:30:00+02:00', 30, "
            f"{literal(status)}, '', '', 0, 0, '', {literal(sale)}, {literal(series)}, "
            f"{literal(day)}, {deleted}, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


OCCURRENCE_COLUMNS = (
    "id",
    "staff_id",
    "staff_name",
    "service_id",
    "service_name",
    "start_datetime",
)


def occurrence_had(appointment_id: str, hub: str, series: str) -> dict:
    """What the handler learns about an occurrence: the row the REAL occurrences read hands back
    for it (appointments#253), or nothing when that hub's read does not see it."""
    sql = bind(
        (MODULE_DIR / MANIFEST["queries"]["appointments.recurring.occurrences"]["sql"]).read_text(),
        {"hub_id": hub, "recurring_id": series},
    )
    columns = ", ".join(f"COALESCE(CAST(q.{c} AS TEXT), '')" for c in OCCURRENCE_COLUMNS)
    out = psql(
        ["-t", "-A", "-F", "\t", "-c", f"SELECT {columns} FROM ({sql.rstrip().rstrip(';')}) q"],
        db=DB,
    )
    for line in out.splitlines():
        row = dict(zip(OCCURRENCE_COLUMNS, line.split("\t")))
        if row.get("id") == appointment_id:
            return row
    return {}


def move(
    appointment_id: str,
    hub: str = HUB,
    staff_id: str = "",
    staff_name: str = "",
    service: tuple[str, str, int] = ("", "", 0),
    series: str = "r1",
) -> None:
    """The WHOLE `sql[]` of `_recurring_move_occurrence`, bound ONCE — the way the runtime runs
    one operation: the move and then its history line, sharing `:now` (appointments#196). An
    empty `staff_id` is what the handler sends when the edit changes no professional, and an
    empty service (id, name, price) when it changes no service (appointments#252). The `from_*`
    are what the handler copies from the occurrences read (appointments#253)."""
    had = occurrence_had(appointment_id, hub, series)
    params = {
        **{f"from_{c}": had.get(c, "") for c in OCCURRENCE_COLUMNS if c != "id"},
        "staff_id": staff_id,
        "staff_name": staff_name,
        "service_id": service[0],
        "service_name": service[1],
        "service_price": service[2],
        "hub_id": hub,
        "appointment_id": appointment_id,
        "recurring_id": "r2",
        "start_datetime": "2026-08-24T12:00:00+02:00",
        "end_datetime": "2026-08-24T12:30:00+02:00",
        "duration_minutes": 30,
        "current_user_id": "u1",
        "channel": "staff",
        "new_id": f"h-{appointment_id}",
        "now": NOW,
    }
    for rel in MANIFEST["commands"]["appointments._recurring_move_occurrence"]["sql"]:
        run_command(rel, params)


def rescheduled_lines(appointment_id: str) -> str:
    return scalar(
        "SELECT count(*) FROM appointments_history WHERE action = 'rescheduled' "
        f"AND appointment_id = {literal(appointment_id)}"
    )


def moved(appointment_id: str) -> bool:
    return scalar(
        f"SELECT start_datetime FROM appointments_appointment WHERE id = {literal(appointment_id)}"
    ).startswith("2026-08-24T12:00")


def cancel_for_pattern(appointment_id: str, hub: str = HUB) -> None:
    """appointments#90 — the statement a pattern change emits for what no longer fits."""
    run_command(
        "commands/_recurring_cancel_occurrence.sql",
        {
            "hub_id": hub,
            "appointment_id": appointment_id,
            "reason": "series_pattern_changed",
            "current_user_id": "u1",
            "now": NOW,
        },
    )


def cancelled(appointment_id: str) -> bool:
    return (
        scalar(
            "SELECT status || '/' || cancellation_reason FROM appointments_appointment "
            f"WHERE id = {literal(appointment_id)}"
        )
        == "cancelled/series_pattern_changed"
    )


def check_cancel_door() -> None:
    """The cancel side of the split (appointments#90) — the SAME door as the move.

    Reusing `_cancel_row` would have been the easy way and the wrong one: its WHERE only knows
    `cancelled`/`completed`, so a pattern change would have cancelled an appointment that is
    already IN PROGRESS or already turned into a sale. Each case is checked on its own, because a
    WHERE that is too loose and one that is too tight fail in opposite directions.
    """
    for day, status in (("2026-10-05", "pending"), ("2026-10-06", "confirmed")):
        oid = f"o-cancel-{status}"
        seed_occurrence(oid, HUB, "r1", day, status=status)
        cancel_for_pattern(oid)
        if not cancelled(oid):
            fail(
                f"_recurring_cancel_occurrence.sql: a {status} occurrence was NOT cancelled — "
                "the bookings the new pattern leaves behind would stay on the old days"
            )
        # The history statement of the module hangs off this exact stamp; without it the audit
        # trail would show a cancellation that never happened (or miss one that did).
        if (
            scalar(
                f"SELECT updated_at FROM appointments_appointment WHERE id = {literal(oid)}"
            )
            != NOW
        ):
            fail(f"_recurring_cancel_occurrence.sql: did not pin the run on {oid}")

    blocked = [
        ("completed", dict(status="completed")),
        ("cancelled", dict(status="cancelled")),
        ("no_show", dict(status="no_show")),
        ("in_progress", dict(status="in_progress")),
        ("already a sale", dict(sale="sale-1")),
        ("soft-deleted", dict(deleted=1)),
    ]
    for index, (label, kwargs) in enumerate(blocked):
        oid = f"o-nocancel-{label.replace(' ', '-')}"
        seed_occurrence(oid, HUB, "r1", f"2026-10-{10 + index:02d}", **kwargs)
        cancel_for_pattern(oid)
        if cancelled(oid):
            fail(
                f"_recurring_cancel_occurrence.sql: it CANCELLED an occurrence that is {label} — "
                "the door is wider than the one the move goes through"
            )

    # …and never a neighbour's. Same shape as the move: our hub_id against their row.
    seed_occurrence("o-cancel-neighbour", OTHER_HUB, "r1", "2026-10-20")
    cancel_for_pattern("o-cancel-neighbour")
    if cancelled("o-cancel-neighbour"):
        fail("_recurring_cancel_occurrence.sql: it reached another hub's appointment")


def keep(appointment_id: str, series: str, hub: str = HUB) -> None:
    run_command(
        "commands/_recurring_keep_occurrence.sql",
        {
            "hub_id": hub,
            "appointment_id": appointment_id,
            "recurring_id": series,
            "current_user_id": "u1",
            "now": NOW,
        },
    )


def series_of(appointment_id: str) -> str:
    return scalar(
        "SELECT recurring_id || ' ' || start_datetime FROM appointments_appointment "
        f"WHERE id = {literal(appointment_id)}"
    )


def check_keep_door() -> None:
    """appointments#236 — the occurrence a series edit could NOT move (closed, blocked, taken,
    outside her hours) stays on its slot but follows the NEW half of the series, so `materialize`
    of the new half does not book the same customer twice that day. Same door as the move: only
    a plan (`pending|confirmed`), never an invoiced one, never another hub's — and the slot is not
    touched, nor does it leave a «rescheduled» line (it did not move).
    """
    for day, status in (("2026-11-02", "pending"), ("2026-11-03", "confirmed")):
        oid = f"o-keep-{status}"
        seed_occurrence(oid, HUB, "r1", day, status=status)
        keep(oid, "r1-new")
        if series_of(oid) != f"r1-new {day}T11:00:00+02:00":
            fail(
                f"_recurring_keep_occurrence.sql: a {status} occurrence did not follow the new "
                f"half on its own slot (got {series_of(oid)!r})"
            )
        if rescheduled_lines(oid) != "0":
            fail("_recurring_keep_occurrence.sql: it left a «rescheduled» line for a stay")

    blocked = [
        ("completed", dict(status="completed")),
        ("cancelled", dict(status="cancelled")),
        ("in_progress", dict(status="in_progress")),
        ("already a sale", dict(sale="sale-1")),
        ("soft-deleted", dict(deleted=1)),
    ]
    for index, (label, kwargs) in enumerate(blocked):
        oid = f"o-nokeep-{label.replace(' ', '-')}"
        seed_occurrence(oid, HUB, "r1", f"2026-11-{10 + index:02d}", **kwargs)
        keep(oid, "r1-new")
        if series_of(oid).split(" ")[0] != "r1":
            fail(
                f"_recurring_keep_occurrence.sql: it reassigned an occurrence that is {label} — "
                "the door is wider than the one the move goes through"
            )

    seed_occurrence("o-keep-neighbour", OTHER_HUB, "r1", "2026-11-20")
    keep("o-keep-neighbour", "r1-new")
    if series_of("o-keep-neighbour").split(" ")[0] != "r1":
        fail("_recurring_keep_occurrence.sql: it reached another hub's appointment")


def staff_of(table: str, row_id: str) -> str:
    return scalar(
        f"SELECT COALESCE(staff_id, '') || ' ' || staff_name FROM {table} "
        f"WHERE id = {literal(row_id)}"
    )


def check_staff_handover() -> None:
    """appointments#248 — handing «this and following» to another professional: the moved
    occurrence goes to her (id AND name), an empty professional keeps whoever it has, and the
    in-place edit writes the template's professional, repairing one created without it."""
    seed_occurrence("o-hand", HUB, "r1", "2026-12-07")
    move("o-hand", staff_id="s2", staff_name="Carla")
    if staff_of("appointments_appointment", "o-hand") != "s2 Carla":
        fail(
            "_recurring_move_occurrence.sql: the occurrence did not follow the new professional "
            f"(got {staff_of('appointments_appointment', 'o-hand')!r})"
        )
    seed_occurrence("o-stay", HUB, "r1", "2026-12-08")
    move("o-stay")
    if staff_of("appointments_appointment", "o-stay") != "s1 Bea":
        fail(
            "_recurring_move_occurrence.sql: a move that changes no professional reassigned it "
            f"(got {staff_of('appointments_appointment', 'o-stay')!r})"
        )
    seed_occurrence("o-hand-sold", HUB, "r1", "2026-12-09", sale="sale-9")
    move("o-hand-sold", staff_id="s2", staff_name="Carla")
    if staff_of("appointments_appointment", "o-hand-sold") != "s1 Bea":
        fail("_recurring_move_occurrence.sql: it handed over an occurrence already turned into a sale")

    def hand_series(series_id: str) -> None:
        """`_recurring_edit` as THIS hub runs it, handing the series to Carla."""
        run_command(
            "commands/_recurring_edit.sql",
            {
                "hub_id": HUB,
                "recurring_id": series_id,
                "time": "11:00",
                "duration_minutes": 30,
                "frequency": "weekly",
                "day_of_week": None,
                "staff_id": "s2",
                "staff_name": "Carla",
                "service_id": "s-corte",
                "service_name": "Corte",
                "current_user_id": "u1",
                "now": NOW,
            },
        )

    seed_series("r-hand")
    psql(["-c", "UPDATE appointments_recurring SET staff_id = NULL, staff_name = '' WHERE id = 'r-hand'"], db=DB)
    hand_series("r-hand")
    if staff_of("appointments_recurring", "r-hand") != "s2 Carla":
        fail(
            "_recurring_edit.sql: the series did not become the new professional's "
            f"(got {staff_of('appointments_recurring', 'r-hand')!r})"
        )
    # The in-place edit now writes WHO does the series: its `hub_id` is the only thing between
    # this hub and a neighbour's series whose id it happens to name.
    seed_series("r-hand-neighbour", OTHER_HUB)
    hand_series("r-hand-neighbour")
    if staff_of("appointments_recurring", "r-hand-neighbour") != "s1 Bea":
        fail(
            "_recurring_edit.sql: it reached another hub's series "
            f"(got {staff_of('appointments_recurring', 'r-hand-neighbour')!r})"
        )


def service_of(table: str, row_id: str) -> str:
    price = ", ' ', service_price" if table == "appointments_appointment" else ""
    return scalar(
        f"SELECT concat(COALESCE(service_id, ''), ' ', service_name{price}) FROM {table} "
        f"WHERE id = {literal(row_id)}"
    )


def check_service_change() -> None:
    """appointments#252 — changing the service of «this and following»: the moved occurrence
    takes the new service (id, name AND price), an empty service keeps the one it has, a sold one
    is never touched, and neither the move nor the in-place edit reaches another hub's row."""
    colour = ("s-color", "Corte y color", 4500)
    seed_occurrence("o-colour", HUB, "r1", "2026-12-14")
    move("o-colour", service=colour)
    if service_of("appointments_appointment", "o-colour") != "s-color Corte y color 4500":
        fail(
            "_recurring_move_occurrence.sql: the occurrence did not take the new service "
            f"(got {service_of('appointments_appointment', 'o-colour')!r})"
        )
    seed_occurrence("o-colour-stay", HUB, "r1", "2026-12-15")
    move("o-colour-stay")
    if service_of("appointments_appointment", "o-colour-stay") != "s-corte Corte 2000":
        fail(
            "_recurring_move_occurrence.sql: a move that changes no service rewrote it "
            f"(got {service_of('appointments_appointment', 'o-colour-stay')!r})"
        )
    seed_occurrence("o-colour-sold", HUB, "r1", "2026-12-16", sale="sale-10")
    move("o-colour-sold", service=colour)
    if service_of("appointments_appointment", "o-colour-sold") != "s-corte Corte 2000":
        fail("_recurring_move_occurrence.sql: it changed the service of an occurrence already turned into a sale")
    # The neighbour's appointment with the id this hub names: its `hub_id` is the only guard.
    seed_occurrence("o-colour-neighbour", OTHER_HUB, "r1", "2026-12-14")
    move("o-colour-neighbour", hub=HUB, service=colour)
    if service_of("appointments_appointment", "o-colour-neighbour") != "s-corte Corte 2000":
        fail("_recurring_move_occurrence.sql: it changed the service of another hub's appointment")

    def recolour_series(series_id: str) -> None:
        """`_recurring_edit` as THIS hub runs it, moving the series to «Corte y color»."""
        run_command(
            "commands/_recurring_edit.sql",
            {
                "hub_id": HUB,
                "recurring_id": series_id,
                "time": "11:00",
                "duration_minutes": 60,
                "frequency": "weekly",
                "day_of_week": None,
                "staff_id": "s1",
                "staff_name": "Bea",
                "service_id": "s-color",
                "service_name": "Corte y color",
                "current_user_id": "u1",
                "now": NOW,
            },
        )

    seed_series("r-colour")
    recolour_series("r-colour")
    if service_of("appointments_recurring", "r-colour") != "s-color Corte y color":
        fail(
            "_recurring_edit.sql: the series did not take the new service "
            f"(got {service_of('appointments_recurring', 'r-colour')!r})"
        )
    seed_series("r-colour-neighbour", OTHER_HUB)
    recolour_series("r-colour-neighbour")
    if service_of("appointments_recurring", "r-colour-neighbour") != "s-corte Corte":
        fail(
            "_recurring_edit.sql: it reached another hub's series "
            f"(got {service_of('appointments_recurring', 'r-colour-neighbour')!r})"
        )


def history_of(appointment_id: str) -> list[dict]:
    """Every history line of an appointment, with its JSON parsed — by Postgres first, so a line
    whose value is not valid JSON fails here and not in the screen."""
    out = scalar(
        "SELECT COALESCE(json_agg(json_build_object('hub_id', hub_id, 'action', action, "
        "'old', old_value::json, 'new', new_value::json) ORDER BY created_at, id), '[]') "
        f"FROM appointments_history WHERE appointment_id = {literal(appointment_id)}"
    )
    return json.loads(out)


def check_series_move_history() -> None:
    """appointments#253 — the line a series move leaves says WHAT changed and from what.

    Handing the series to Carla left, on each appointment, «rescheduled» with the time it already
    had: nobody could tell from the history that another professional does it now, nor who did it
    before. The line compares what the occurrence HAD (the `from_*` the handler copies from the
    occurrences read) with what the row has after the move.
    """
    seed_occurrence("o-hist-staff", HUB, "r1", "2026-12-21")
    had = occurrence_had("o-hist-staff", HUB, "r1")
    if (had.get("staff_name"), had.get("service_id"), had.get("service_name")) != (
        "Bea",
        "s-corte",
        "Corte",
    ):
        fail(
            "recurring_occurrences.sql: the read does not hand back who does the occurrence and "
            f"its service by name (got {had!r}) — the history would say it had nobody"
        )
    move("o-hist-staff", staff_id="s2", staff_name="Carla")
    lines = history_of("o-hist-staff")
    if [line["action"] for line in lines] != ["staff_changed"]:
        fail(
            "_history_series_move.sql: handing the occurrence to Carla must leave ONE "
            f"«staff_changed» line (got {[line['action'] for line in lines]!r})"
        )
    else:
        line = lines[0]
        before = (line["old"] or {})
        after = (line["new"] or {})
        if (before.get("staff_id"), before.get("staff_name")) != ("s1", "Bea"):
            fail(f"_history_series_move.sql: the line does not say who did it before (old={before!r})")
        if (after.get("staff_id"), after.get("staff_name")) != ("s2", "Carla"):
            fail(f"_history_series_move.sql: the line does not say who does it now (new={after!r})")
        if before.get("start_datetime") != "2026-12-21T11:00:00+02:00" or after.get(
            "start_datetime"
        ) != "2026-08-24T12:00:00+02:00":
            fail(
                "_history_series_move.sql: the line lost the slot it had or the one it landed on "
                f"(old={before!r}, new={after!r})"
            )
        if line["hub_id"] != HUB:
            fail(f"_history_series_move.sql: the line was written for hub {line['hub_id']!r}")

    colour = ("s-color", "Corte y color", 4500)
    seed_occurrence("o-hist-service", HUB, "r1", "2026-12-22")
    move("o-hist-service", service=colour)
    lines = history_of("o-hist-service")
    if [line["action"] for line in lines] != ["service_changed"]:
        fail(
            "_history_series_move.sql: changing the service must leave ONE «service_changed» "
            f"line (got {[line['action'] for line in lines]!r})"
        )
    elif ((lines[0]["old"] or {}).get("service_name"), (lines[0]["new"] or {}).get("service_name")) != (
        "Corte",
        "Corte y color",
    ):
        fail(f"_history_series_move.sql: the line does not say which service it was and is ({lines[0]!r})")

    # Both at once: the professional is what the receptionist is asked about, so it wins the
    # action — and the service still travels in the values.
    seed_occurrence("o-hist-both", HUB, "r1", "2026-12-23")
    move("o-hist-both", staff_id="s2", staff_name="Carla", service=colour)
    lines = history_of("o-hist-both")
    if [line["action"] for line in lines] != ["staff_changed"]:
        fail(
            "_history_series_move.sql: a move that changes professional AND service must leave "
            f"ONE «staff_changed» line (got {[line['action'] for line in lines]!r})"
        )
    elif ((lines[0]["old"] or {}).get("service_name"), (lines[0]["new"] or {}).get("service_name")) != (
        "Corte",
        "Corte y color",
    ):
        fail(f"_history_series_move.sql: the service change was lost from the line ({lines[0]!r})")

    seed_occurrence("o-hist-time", HUB, "r1", "2026-12-24")
    move("o-hist-time")
    if [line["action"] for line in history_of("o-hist-time")] != ["rescheduled"]:
        fail(
            "_history_series_move.sql: a move that changes only the time must stay «rescheduled» "
            f"(got {[line['action'] for line in history_of('o-hist-time')]!r})"
        )

    # A name is free text: a double quote or a backslash in it must not break the line's JSON.
    seed_occurrence("o-hist-quote", HUB, "r1", "2026-12-25")
    try:
        move("o-hist-quote", staff_id="s3", staff_name='Carla "la rubia" \\ B')
        history_of("o-hist-quote")
    except (RuntimeError, ValueError) as exc:
        fail(f"_history_series_move.sql: a name with a double quote broke the line's JSON ({exc})")

    # A move that does not happen leaves no line of any kind.
    seed_occurrence("o-hist-sold", HUB, "r1", "2026-12-28", sale="sale-11")
    move("o-hist-sold", staff_id="s2", staff_name="Carla")
    if history_of("o-hist-sold"):
        fail("_history_series_move.sql: it recorded a hand-over of an occurrence that did not move")

    # The neighbour's appointment this hub names, stamped by its own hub on the same `:now`: the
    # UPDATE does not reach it, and only the line's `hub_id` keeps it from getting OUR history.
    seed_occurrence("o-hist-neighbour", OTHER_HUB, "r1", "2026-12-21")
    psql(
        ["-c", f"UPDATE appointments_appointment SET updated_at = {literal(NOW)} WHERE id = 'o-hist-neighbour'"],
        db=DB,
    )
    move("o-hist-neighbour", hub=HUB, staff_id="s2", staff_name="Carla")
    if history_of("o-hist-neighbour"):
        fail("_history_series_move.sql: it wrote a history line on another hub's appointment")


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

        seed_series("r1")

        # ── the split itself ────────────────────────────────────────────────────────────
        run_command(
            "commands/_recurring_close.sql",
            {
                "hub_id": HUB,
                "recurring_id": "r1",
                "end_date": "2026-08-23",
                "current_user_id": "u1",
                "now": NOW,
            },
        )
        if (
            scalar("SELECT end_date FROM appointments_recurring WHERE id = 'r1'")
            != "2026-08-23"
        ):
            fail("_recurring_close.sql: the UNTIL was not written")
        # The old half keeps its appointments: it is history, not rubbish.
        if (
            scalar(
                "SELECT is_active || '/' || is_deleted FROM appointments_recurring WHERE id = 'r1'"
            )
            != "1/0"
        ):
            fail(
                "_recurring_close.sql: it deactivated or deleted the old half — it must only stop looking forward"
            )

        run_command(
            "commands/_recurring_split.sql",
            {
                "new_id": "r2",
                "hub_id": HUB,
                "customer_id": "c1",
                "customer_name": "Ada",
                "service_id": "s-corte",
                "service_name": "Corte",
                "staff_id": "s1",
                "staff_name": "Bea",
                "frequency": "weekly",
                "day_of_week": None,
                "time": "12:00",
                "duration_minutes": 30,
                "start_date": "2026-08-24",
                "end_date": None,
                "max_occurrences": None,
                "split_from_id": "r1",
                "current_user_id": "u1",
                "now": NOW,
            },
        )
        if (
            scalar("SELECT split_from_id FROM appointments_recurring WHERE id = 'r2'")
            != "r1"
        ):
            fail(
                "_recurring_split.sql: the new half does not say where it came from (migration 007)"
            )
        if scalar("SELECT time FROM appointments_recurring WHERE id = 'r2'") != "12:00":
            fail("_recurring_split.sql: the new half did not take the new time")

        # ── the door: what moves ────────────────────────────────────────────────────────
        # One per day: two occurrences of the same series cannot share an `occurrence_date`
        # (the unique index of migration 005 says so, and it is right — that IS the duplicate it
        # exists to stop). Writing the fixture the other way is how this test found that out.
        for day, status in (("2026-08-24", "pending"), ("2026-08-25", "confirmed")):
            seed_occurrence(f"o-{status}", HUB, "r1", day, status=status)
            move(f"o-{status}")
            if not moved(f"o-{status}"):
                fail(
                    f"_recurring_move_occurrence.sql: a {status} occurrence did NOT move — the WHERE is too tight"
                )
            if (
                scalar(
                    f"SELECT recurring_id FROM appointments_appointment WHERE id = 'o-{status}'"
                )
                != "r2"
            ):
                fail(
                    f"_recurring_move_occurrence.sql: the {status} occurrence stayed on the old half"
                )
            # appointments#196: the move leaves ITS line, pinned to this run and to no other.
            if rescheduled_lines(f"o-{status}") != "1":
                fail(
                    f"_history_series_move.sql: a moved {status} occurrence has "
                    f"{rescheduled_lines(f'o-{status}')} «rescheduled» lines, expected exactly 1"
                )

        # ── the door: what must NOT move ────────────────────────────────────────────────
        # Each one on its own: a WHERE that is too loose and one that is too tight fail in
        # opposite directions, and a single mixed case would hide either.
        blocked = [
            ("completed", dict(status="completed")),
            ("cancelled", dict(status="cancelled")),
            ("no_show", dict(status="no_show")),
            ("in_progress", dict(status="in_progress")),
            ("already a sale", dict(sale="sale-1")),
            ("soft-deleted", dict(deleted=1)),
        ]
        for label, kwargs in blocked:
            oid = f"o-blocked-{label.replace(' ', '-')}"
            seed_occurrence(
                oid,
                HUB,
                "r1",
                f"2026-09-{7 + blocked.index((label, kwargs)):02d}",
                **kwargs,
            )
            move(oid)
            if moved(oid):
                fail(
                    f"_recurring_move_occurrence.sql: it MOVED an occurrence that is {label} — the door is open"
                )
            # …and a move that did not happen leaves NO trail: the history line hangs off the
            # `updated_at = :now` stamp the UPDATE did not write (appointments#196).
            if rescheduled_lines(oid) != "0":
                fail(
                    f"_history_series_move.sql: it recorded a move of an occurrence that is {label} "
                    "and did NOT move — the history line is not pinned to the run"
                )

        # …and never a neighbour's, whatever its state.
        seed_occurrence(
            "o-neighbour", OTHER_HUB, "r1", "2026-08-24"
        )  # same day, other hub
        move("o-neighbour")  # with OUR hub_id, which is how a tenancy leak would look
        if moved("o-neighbour"):
            fail("_recurring_move_occurrence.sql: it reached another hub's appointment")

        check_cancel_door()
        check_keep_door()
        check_staff_handover()
        check_service_change()
        check_series_move_history()
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
        f"ok: {COMMAND} — manifest wiring + migration 007 + the move door against real Postgres"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
