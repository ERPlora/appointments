#!/usr/bin/env python3
"""`appointments.blocked_times.upcoming` and `appointments.appointments.upcoming_for_staff` — the
two reads that let a BATCH and a SERIES apply the same rules as `create`.

Why they exist (appointments#10 / appointments#54): `reads.params` can only bind a top-level
`payload.<field>`, and `bulk_create` and `recurring.materialize` book across SEVERAL days. There is
no way to say «the blocks of each of these days» or «the appointments of each of these days», and
asking the caller for the window would be worse than useless: a narrow window silently drops the
holiday and the guard opens by itself. So these two read everything that has not ENDED yet — a
bound that comes from `:now`, which the runtime injects, not from anything the caller can shape.

The handler side is covered by `cargo test` (window intersection, the professional's block vs
somebody else's, skipped occurrences). This file covers the half `cargo test` CANNOT see: that the
SQL actually SELECTS the right rows out of a real Postgres. A read that returns nothing is a guard
that never fires, and the Rust tests would stay green all the way down — the exact trap
appointments#16 was opened about.

The contract this file pins:

  1. MANIFEST. Both queries exist, are NOT paginated `list`s (the handler wants the rows, not a
     page), and `bulk_create` / `recurring.materialize` declare both as `required` reads.
  2. REAL POSTGRES. Against a scratch database built from this module's own migrations: a block or
     an appointment that is still ahead comes back whatever DAY it falls on (that is the whole
     point), one that already ended does not, another professional's appointment does not, a
     cancelled or deleted row does not, an appointment with no professional DOES (it takes
     everybody's slot), and ANOTHER HUB's rows never leak.

Usage: tests/upcoming_reads.postgres.test.py   (exit 0 = green)
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

BLOCKS = "appointments.blocked_times.upcoming"
BOOKED = "appointments.appointments.upcoming_for_staff"
# appointments#267: a series reads her agenda one PAGE at a time — her whole agenda ahead ran the
# WASM handler out of its instruction budget past ~4 300 bookings.
PAGE = "appointments.appointments.upcoming_for_staff_from"
PAGE_ROWS = 2000
BATCH = "appointments.appointments.bulk_create"
SERIES = "appointments.recurring.materialize"
READERS = (BATCH, SERIES)
# What each reader reads her bookings with.
AGENDA_OF = {BATCH: BOOKED, SERIES: PAGE}

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_upcoming_reads_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"

# "Now" for the reads under test.
NOW = "2026-08-20T09:00:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Layer 1: manifest wiring ─────────────────────────────────────────────────────────────


def check_manifest() -> dict[str, dict] | None:
    out: dict[str, dict] = {}
    for name in (BLOCKS, BOOKED, PAGE):
        q = MANIFEST.get("queries", {}).get(name)
        if not isinstance(q, dict):
            fail(f"{name}: not declared in module.json")
            continue
        if "list" in q:
            fail(
                f"{name}: must be a plain query — the handler reads the rows, not a page"
            )
        sql_rel = q.get("sql")
        if not sql_rel or not (MODULE_DIR / sql_rel).exists():
            fail(f"{name}.sql: {sql_rel!r} is not in the package")
            continue
        out[name] = q

    for command in READERS:
        reads = {
            r.get("query"): r
            for r in (MANIFEST.get("commands", {}).get(command) or {}).get("reads", [])
            if isinstance(r, dict)
        }
        agenda = AGENDA_OF[command]
        for name in (BLOCKS, agenda):
            read = reads.get(name)
            if read is None:
                fail(f"{command}.reads: missing {name!r} — the guard would never run")
            elif read.get("required") is not True:
                fail(
                    f"{command}.reads[{name}]: must be `required` — a guard whose input can go "
                    "missing is a guard that opens"
                )
        booked = reads.get(agenda) or {}
        if (booked.get("params") or {}).get("staff_id") != "payload.staff_id":
            fail(
                f"{command}.reads[{agenda}].params.staff_id: must bind the payload's professional"
            )
        if agenda == PAGE:
            if (booked.get("params") or {}).get("from") != "payload.from":
                fail(
                    f"{command}.reads[{PAGE}].params.from: must bind the window's start"
                )
            if BOOKED in reads:
                fail(f"{command}.reads: still reads her WHOLE agenda ({BOOKED})")
        if (reads.get(BLOCKS) or {}).get("params"):
            fail(
                f"{command}.reads[{BLOCKS}]: takes no params — it is the day-independent read"
            )

    return out if len(out) == 3 else None


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
def shim_dateadd(sql: str) -> str:
    """`erp_dateadd(x, n, unit)` → `((x)::timestamptz + ((n) || ' ' || unit)::interval)`, with
    the arguments split on the top-level commas, as the hub's translator does."""
    while (at := sql.find("erp_dateadd(")) >= 0:
        i, depth, args, arg = at + len("erp_dateadd("), 1, [], ""
        while depth:
            ch = sql[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            if depth == 1 and ch == ",":
                args.append(arg.strip())
                arg = ""
            elif depth:
                arg += ch
            i += 1
        x, n, unit = args + [arg.strip()]
        sql = (
            sql[:at]
            + f"(({x})::timestamptz + (({n}) || ' ' || {unit})::interval)"
            + sql[i:]
        )
    return sql


def shim(sql: str) -> str:
    sql = shim_dateadd(sql)
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


def appointment(
    id_: str,
    hub: str,
    staff: str | None,
    start: str,
    end: str,
    status: str = "confirmed",
    deleted: int = 0,
) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, is_deleted, "
            "created_at) VALUES "
            f"({literal(id_)}, {literal(hub)}, {literal(id_)}, 'c1', 'Ada', '', '', "
            f"{literal(staff)}, '', 's-corte', 'Corte', 2000, {literal(start)}, {literal(end)}, "
            f"30, {literal(status)}, '', '', 0, 0, '', {deleted}, '2026-08-01T00:00:00+02:00')",
        ],
        db=DB,
    )


def check_page(sql_rel: str, base: dict) -> None:
    """appointments#267 — `upcoming_for_staff_from`: her agenda ahead from the window's start,
    ordered by INSTANT and cut at one page. Runs on top of the rows `check_against_postgres`
    planted for `upcoming_for_staff` (a-today, a-next-month, a-unassigned, a-other-hub, …)."""

    def ids(params: dict) -> list[str]:
        return [
            r["id"] for r in run_query(sql_rel, {**base, "staff_id": "s1", **params})
        ]

    # Without a window start it is `upcoming_for_staff`, in start order.
    got = ids({"from": None})
    if got != ["a-today", "a-next-month", "a-unassigned"]:
        fail(f"{PAGE} without `from` returned {got}")
    # A `from` that is not a date is no window start either (the handler ignores it too).
    got = ids({"from": "next week"})
    if got != ["a-today", "a-next-month", "a-unassigned"]:
        fail(f"{PAGE} with a `from` that is not a date returned {got}")
    # Nor is a text shaped like a date that the calendar does not have: the handler's `parse_dt`
    # refuses it and books from today, so the read must answer from `:now` too — not fail the
    # whole command on a cast (an assistant asking for «February 30th» got a database error).
    for not_a_day in ("2026-02-30", "2026-13-01", "2026-04-31"):
        try:
            got = ids({"from": not_a_day})
        except RuntimeError as err:
            fail(
                f"{PAGE} with `from` = {not_a_day!r} failed instead of ignoring it: {err}"
            )
            continue
        if got != ["a-today", "a-next-month", "a-unassigned"]:
            fail(f"{PAGE} with `from` = {not_a_day!r} returned {got}")

    # A window that starts before now still reads nothing that has ended: a booking of hers that
    # ended this morning would only eat a row of the page.
    appointment(
        "a-ended-this-morning",
        HUB,
        "s1",
        "2026-08-20T07:00:00+02:00",
        "2026-08-20T07:30:00+02:00",
    )
    got = ids({"from": "2026-08-01"})
    if got != ["a-today", "a-next-month", "a-unassigned"]:
        fail(f"{PAGE} from before now returned {got}")

    # The window starts 2026-09-15; a day of margin covers any offset the rows are written in.
    appointment(
        "a-two-days-before",
        HUB,
        "s1",
        "2026-09-13T11:00:00+02:00",
        "2026-09-13T11:30:00+02:00",
    )
    appointment(
        "a-day-before",
        HUB,
        "s1",
        "2026-09-14T10:00:00+02:00",
        "2026-09-14T10:30:00+02:00",
    )
    # 08:00Z and 09:30Z: as TEXT «…T09:30:00Z» sorts before «…T10:00:00+02:00»; as instants the
    # +02:00 one is first. A page cut in text order would drop the wrong row.
    appointment(
        "a-offset", HUB, "s1", "2026-09-15T10:00:00+02:00", "2026-09-15T10:30:00+02:00"
    )
    appointment("a-z", HUB, "s1", "2026-09-15T09:30:00Z", "2026-09-15T10:00:00Z")
    # Same instant: the id breaks the tie, so a page always ends on the same row.
    appointment(
        "a-tie-b", HUB, "s1", "2026-09-20T10:00:00+02:00", "2026-09-20T10:30:00+02:00"
    )
    appointment(
        "a-tie-a", HUB, None, "2026-09-20T10:00:00+02:00", "2026-09-20T10:30:00+02:00"
    )
    in_window = [
        "a-day-before",
        "a-offset",
        "a-next-month",
        "a-z",
        "a-unassigned",
        "a-tie-a",
        "a-tie-b",
    ]
    got = ids({"from": "2026-09-15"})
    if got != in_window:
        fail(f"{PAGE} from 2026-09-15 returned {got}; want {in_window}")

    # A professional with a clear diary: only the global-agenda rows.
    got = ids({"from": "2026-09-15", "staff_id": "s-nobody"})
    if got != ["a-unassigned", "a-tie-a"]:
        fail(
            f"{PAGE}: a clear diary must return only the global-agenda rows, got {got}"
        )

    # One page at most: 2 005 more bookings of hers, one an hour from 2026-10-01.
    psql(
        [
            "-c",
            "INSERT INTO appointments_appointment (id, hub_id, appointment_number, customer_id, "
            "customer_name, customer_phone, customer_email, staff_id, staff_name, service_id, "
            "service_name, service_price, start_datetime, end_datetime, duration_minutes, status, "
            "notes, internal_notes, reminder_sent, booked_online, cancellation_reason, is_deleted, "
            "created_at) "
            f"SELECT 'bulk-' || lpad(g::text, 4, '0'), {literal(HUB)}, 'bulk-' || g, 'c1', 'Ada', "
            "'', '', 's1', '', 's-corte', 'Corte', 2000, "
            "to_char(timestamp '2026-10-01 00:00' + g * interval '1 hour', "
            '\'YYYY-MM-DD"T"HH24:MI:SS"Z"\'), '
            "to_char(timestamp '2026-10-01 00:30' + g * interval '1 hour', "
            '\'YYYY-MM-DD"T"HH24:MI:SS"Z"\'), '
            "30, 'confirmed', '', '', 0, 0, '', 0, '2026-08-01T00:00:00+02:00' "
            "FROM generate_series(1, 2005) g",
        ],
        db=DB,
    )
    got = ids({"from": "2026-09-15"})
    want = in_window + [
        f"bulk-{g:04d}" for g in range(1, PAGE_ROWS - len(in_window) + 1)
    ]
    if got != want:
        fail(
            f"{PAGE}: one page must be the {PAGE_ROWS} earliest of her bookings; got {len(got)} "
            f"rows ending {got[-3:]}, want {len(want)} ending {want[-3:]}"
        )

    # Tenancy: the neighbour's page holds its own row only, whatever this hub piles up.
    got = ids({"from": "2026-09-15", "hub_id": OTHER_HUB})
    if got != ["a-other-hub"]:
        fail(f"{PAGE}: the neighbour hub must see only its own row, got {got}")


def check_against_postgres(queries: dict[str, dict]) -> None:
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

        base = {"hub_id": HUB, "current_user_id": "u-owner", "now": NOW}

        # ── blocked_times.upcoming ──
        # Ahead, whatever the day: that is the whole point — a batch books next month too.
        block(
            "b-today",
            HUB,
            None,
            "2026-08-20T00:00:00+02:00",
            "2026-08-21T00:00:00+02:00",
        )
        block(
            "b-next-month",
            HUB,
            "s1",
            "2026-09-14T00:00:00+02:00",
            "2026-09-21T00:00:00+02:00",
        )
        block(
            "b-other-staff",
            HUB,
            "s2",
            "2026-09-01T09:00:00+02:00",
            "2026-09-01T13:00:00+02:00",
        )
        # Not ahead / not ours.
        block(
            "b-past",
            HUB,
            None,
            "2026-07-01T00:00:00+02:00",
            "2026-07-08T00:00:00+02:00",
        )
        block(
            "b-deleted",
            HUB,
            None,
            "2026-09-01T00:00:00+02:00",
            "2026-09-02T00:00:00+02:00",
            1,
        )
        block(
            "b-other-hub",
            OTHER_HUB,
            None,
            "2026-09-01T00:00:00+02:00",
            "2026-09-02T00:00:00+02:00",
        )

        got = {r["id"] for r in run_query(queries[BLOCKS]["sql"], base)}
        # Another professional's block comes back on purpose: this read takes no `staff_id`, and
        # the handler is the one that knows whose booking it is (`blocked_refusal`).
        want = {"b-today", "b-next-month", "b-other-staff"}
        if got != want:
            missing, extra = sorted(want - got), sorted(got - want)
            fail(
                f"{BLOCKS} returned {sorted(got)}; missing {missing}, unexpected {extra}"
            )

        # ── appointments.upcoming_for_staff ──
        appointment(
            "a-today",
            HUB,
            "s1",
            "2026-08-20T11:00:00+02:00",
            "2026-08-20T11:30:00+02:00",
        )
        appointment(
            "a-next-month",
            HUB,
            "s1",
            "2026-09-15T11:00:00+02:00",
            "2026-09-15T11:30:00+02:00",
        )
        # No professional = the global agenda; it takes anybody's slot.
        appointment(
            "a-unassigned",
            HUB,
            None,
            "2026-09-16T11:00:00+02:00",
            "2026-09-16T11:30:00+02:00",
        )
        # Must NOT come back.
        appointment(
            "a-other-staff",
            HUB,
            "s2",
            "2026-09-15T11:00:00+02:00",
            "2026-09-15T11:30:00+02:00",
        )
        appointment(
            "a-past",
            HUB,
            "s1",
            "2026-07-01T11:00:00+02:00",
            "2026-07-01T11:30:00+02:00",
        )
        appointment(
            "a-cancelled",
            HUB,
            "s1",
            "2026-09-17T11:00:00+02:00",
            "2026-09-17T11:30:00+02:00",
            status="cancelled",
        )
        appointment(
            "a-no-show",
            HUB,
            "s1",
            "2026-09-18T11:00:00+02:00",
            "2026-09-18T11:30:00+02:00",
            status="no_show",
        )
        appointment(
            "a-deleted",
            HUB,
            "s1",
            "2026-09-19T11:00:00+02:00",
            "2026-09-19T11:30:00+02:00",
            deleted=1,
        )
        appointment(
            "a-other-hub",
            OTHER_HUB,
            "s1",
            "2026-09-15T11:00:00+02:00",
            "2026-09-15T11:30:00+02:00",
        )

        got = {
            r["id"]
            for r in run_query(queries[BOOKED]["sql"], {**base, "staff_id": "s1"})
        }
        want = {"a-today", "a-next-month", "a-unassigned"}
        if got != want:
            missing, extra = sorted(want - got), sorted(got - want)
            fail(
                f"{BOOKED} for s1 returned {sorted(got)}; missing {missing}, unexpected {extra}"
            )

        # Tenancy: the neighbour sees ITS appointment and never ours.
        got = {
            r["id"]
            for r in run_query(
                queries[BOOKED]["sql"], {**base, "hub_id": OTHER_HUB, "staff_id": "s1"}
            )
        }
        if got != {"a-other-hub"}:
            fail(
                f"{BOOKED}: the neighbour hub must see only its own row, got {sorted(got)}"
            )

        # A professional with a clear diary answers with the unassigned rows and nothing of hers.
        got = {
            r["id"]
            for r in run_query(queries[BOOKED]["sql"], {**base, "staff_id": "s-nobody"})
        }
        if got != {"a-unassigned"}:
            fail(
                f"{BOOKED}: a clear diary must return only the global-agenda rows, got {sorted(got)}"
            )

        check_page(queries[PAGE]["sql"], base)
    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])


def main() -> int:
    queries = check_manifest()
    if queries and len(queries) == 3:
        check_against_postgres(queries)
    for note in notes:
        print(f"note: {note}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {BLOCKS} + {BOOKED} + {PAGE} — manifest wiring + real Postgres")
    return 0


if __name__ == "__main__":
    sys.exit(main())
