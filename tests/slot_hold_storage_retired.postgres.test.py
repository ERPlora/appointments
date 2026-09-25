#!/usr/bin/env python3
"""appointments#187 — the storage of the retired slot holds is set aside, and nothing is lost.

WHAT IS LEFT. appointments#184 retired slot holds: no command writes `appointments_slot_hold`, no
query reads it, and the setting `appointments_settings.hold_minutes` left the Settings screen and
both settings SQL files. The table and the column stayed behind on purpose — dropping them is a
contract change of its own (ADR-0398: first stop using it, then remove it one release later) — and
v1.1.92 already shipped after the release of #184. So this is that second release.

WHAT THIS PINS, two halves:

  1. THE CONTRACT (no container). `migrations/postgres/011_drop_slot_hold_storage.sql` is declared
     with the object shape and `kind: "contract"` — the only declaration under which the runtime
     accepts a `DROP`, and it accepts it by TRANSLATING it into a rename to `_deprecated_*`. It is
     the last migration, it drops exactly the table and the column, and:
       - 🔴 no prose sits ABOVE a `DROP`: the runtime matches the verb at the start of the
         statement text and keeps a preceding comment inside it, so a header comment turns the
         rename into a real, irreversible `DROP` on a customer database (hub#1137);
       - the column is dropped WITHOUT `IF EXISTS`: a runtime older than hub#2108 turns
         `DROP COLUMN IF EXISTS c` into `RENAME COLUMN IF EXISTS …`, which Postgres rejects, and the
         module would not update. `006_slot_hold.sql` created the column on every hub, so the guard
         buys nothing and costs an update on the fleet that has not rolled out that image yet.

  2. THE DATABASE (real Postgres). A hub built up to `010`, with a hold row and a salon that had set
     `hold_minutes` to 30, runs `011` the way the runtime applies it:
       - the table and the column are gone under their names, and the row and the 30 are still
         there under `_deprecated_*`: SET ASIDE, not destroyed;
       - `appointments.settings.upsert` still writes the settings row afterwards (the set-aside
         column keeps its `NOT NULL DEFAULT`, so a write that no longer names it keeps working);
       - REVERTING is a rename back, executed here: the row and the 30 come back under their names.
     This battery refuses to pass by finding nothing: it first asserts that the table, the column
     and the seeded values exist BEFORE `011`.

Usage: tests/slot_hold_storage_retired.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container (override: ERPLORA_TEST_PG_CONTAINER). Creates a
  throwaway database and DROPS it at the end, pass or fail. Without the container the database half
  is SKIPPED — never counted as passed. The contract half runs regardless.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from module_migrations import (  # noqa: E402
    migration_entries,
    migration_sql,
    split_statements,
    strip_comments,
)

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text(encoding="utf-8"))
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")

RETIREMENT = "migrations/postgres/011_drop_slot_hold_storage.sql"
BEFORE_RETIREMENT = "migrations/postgres/010_auto_confirm_online.sql"
TABLE = "appointments_slot_hold"
SETTINGS = "appointments_settings"
COLUMN = "hold_minutes"

HUB = "hub-187"
USER = "user-187"
NOW = "2026-09-25T10:00:00+02:00"
HOLD_ID = "hold-187"
SETTINGS_ID = "settings-187"

# The revert of a `contract` retirement: rename back what the runtime set aside.
REVERT = (
    f"ALTER TABLE _deprecated_{TABLE} RENAME TO {TABLE};\n"
    f"ALTER TABLE {SETTINGS} RENAME COLUMN _deprecated_{COLUMN} TO {COLUMN};\n"
)

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def ok(label: str, condition: bool, detail: str = "") -> None:
    if not condition:
        fail(f"{label}{': ' + detail if detail else ''}")


# ── Half 1: the contract ───────────────────────────────────────────────────────────────────


def check_declaration() -> bool:
    raw = MANIFEST.get("migrations", {}).get("postgres", [])
    entries = [e for e in raw if isinstance(e, dict) and e.get("file") == RETIREMENT]
    if not entries:
        fail(
            f"migrations.postgres: {RETIREMENT!r} is not declared with the object shape — the "
            f"table {TABLE} and the column {SETTINGS}.{COLUMN} stay in every hub, read by nobody"
        )
        return False
    entry = entries[0]
    ok(
        f"{RETIREMENT}: kind",
        entry.get("kind") == "contract",
        f"is {entry.get('kind')!r}; only a `contract` may DROP, and it is what makes the runtime "
        "set the rows aside instead of destroying them",
    )
    ok(
        f"{RETIREMENT}: since",
        isinstance(entry.get("since"), str) and bool(entry.get("since")),
        "a contract names the release it ships in",
    )
    files = [rel for rel, _ in migration_entries()]
    ok(
        f"{RETIREMENT}: order",
        files[-1] == RETIREMENT,
        f"it must be the last migration, found {files[-1]!r} after it",
    )
    if not (MODULE_DIR / RETIREMENT).exists():
        fail(f"{RETIREMENT}: declared but not in the package")
        return False
    return True


def check_statements() -> None:
    sql = (MODULE_DIR / RETIREMENT).read_text(encoding="utf-8")
    statements = split_statements(sql)
    real = [" ".join(strip_comments(s).split()) for s in statements]
    real = [s for s in real if s]
    expected = [
        f"DROP TABLE IF EXISTS {TABLE}",
        f"ALTER TABLE {SETTINGS} DROP COLUMN {COLUMN}",
    ]
    ok(
        f"{RETIREMENT}: statements",
        [s.upper() for s in real] == [s.upper() for s in expected],
        f"expected exactly {expected}, found {real}",
    )
    for statement in statements:
        if not strip_comments(statement).strip():
            continue
        first = statement.lstrip().splitlines()[0]
        ok(
            f"{RETIREMENT}: prose above a DROP",
            not first.startswith("--") and not first.startswith("/*"),
            f"the statement starts with a comment ({first!r}): the runtime would miss the "
            "translation and destroy the rows — put the prose at the BOTTOM",
        )
    applied = migration_sql(RETIREMENT, "contract")
    ok(
        f"{RETIREMENT}: the table is set aside",
        f"RENAME TO _deprecated_{TABLE}" in applied,
        f"the runtime would run: {applied!r}",
    )
    ok(
        f"{RETIREMENT}: the column is set aside",
        f"RENAME COLUMN {COLUMN} TO _deprecated_{COLUMN}" in applied,
        f"the runtime would run: {applied!r}",
    )
    ok(
        f"{RETIREMENT}: no IF EXISTS on the column",
        not re.search(r"DROP\s+COLUMN\s+IF\s+EXISTS", strip_comments(sql), re.I),
        "a runtime older than hub#2108 turns it into `RENAME COLUMN IF EXISTS`, which Postgres "
        "rejects, and the module would not update",
    )


# ── Half 2: the database ───────────────────────────────────────────────────────────────────


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


class ScratchDb:
    def __init__(self) -> None:
        self.name = f"appointments187_{os.getpid()}_{uuid.uuid4().hex[:6]}"

    def psql(
        self, args: list[str], db: str | None = None, stdin: str | None = None
    ) -> str:
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
            "-X",
        ]
        if db:
            cmd += ["-d", db]
        res = subprocess.run(cmd + args, input=stdin, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(res.stderr.strip() or res.stdout.strip())
        return res.stdout

    def create(self, through: str) -> None:
        self.psql(["-c", f'DROP DATABASE IF EXISTS "{self.name}"'])
        self.psql(["-c", f'CREATE DATABASE "{self.name}"'])
        for rel, kind in migration_entries():
            self.run(migration_sql(rel, kind))
            if rel == through:
                return

    def run(self, sql: str) -> str:
        return self.psql([], db=self.name, stdin=sql)

    def scalar(self, sql: str) -> str:
        return self.psql(["-tAc", sql], db=self.name).strip()

    def drop(self) -> None:
        try:
            self.psql(["-c", f'DROP DATABASE IF EXISTS "{self.name}" WITH (FORCE)'])
        except RuntimeError as exc:
            print(f"  ! could not drop {self.name}: {exc}")


def table_exists(db: ScratchDb, table: str) -> bool:
    return (
        db.scalar(
            "SELECT COUNT(*) FROM information_schema.tables "
            f"WHERE table_schema = current_schema() AND table_name = '{table}'"
        )
        == "1"
    )


def column_exists(db: ScratchDb, table: str, column: str) -> bool:
    return (
        db.scalar(
            "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() "
            f"AND table_name = '{table}' AND column_name = '{column}'"
        )
        == "1"
    )


def literal(value) -> str:
    """Mirrors the runtime's bind: a JSON boolean lands in an INTEGER column as 0/1 (hub#208)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def run_settings_upsert(db: ScratchDb) -> None:
    """`appointments.settings.upsert` from an empty form, with the runtime's schema defaults."""
    spec = MANIFEST["commands"]["appointments.settings.upsert"]
    schema = json.loads((MODULE_DIR / spec["schema"]).read_text(encoding="utf-8"))
    params = {
        k: v["default"]
        for k, v in schema.get("properties", {}).items()
        if "default" in v
    }
    params.update(
        {"hub_id": HUB, "current_user_id": USER, "now": NOW, "new_id": SETTINGS_ID}
    )
    for rel in spec["sql"]:
        sql = (MODULE_DIR / rel).read_text(encoding="utf-8")
        sql = re.sub(
            r"(?<![:\w]):([a-z_][a-z0-9_]*)",
            lambda m: literal(params.get(m.group(1))),
            sql,
        )
        db.run(sql)


def check_against_postgres() -> None:
    if not docker_available():
        notes.append(f"SKIPPED database half: container {CONTAINER!r} is not running")
        return
    db = ScratchDb()
    try:
        db.create(through=BEFORE_RETIREMENT)
        db.run(
            f"INSERT INTO {SETTINGS} (id, hub_id, {COLUMN}, created_at) "
            f"VALUES ('{SETTINGS_ID}', '{HUB}', 30, '{NOW}');\n"
            f"INSERT INTO {TABLE} (id, hub_id, source, source_ref, start_datetime, end_datetime, "
            f"expires_at, created_at) VALUES ('{HOLD_ID}', '{HUB}', 'whatsapp', 'req-1', "
            f"'2026-09-26T10:00:00Z', '2026-09-26T11:00:00Z', '2026-09-25T10:15:00Z', '{NOW}');\n"
        )
        # The control: what the retirement must set aside is really there before it.
        ok(
            "before 011: the hold row exists",
            db.scalar(f"SELECT COUNT(*) FROM {TABLE}") == "1",
        )
        ok(
            "before 011: the salon's hold_minutes is 30",
            db.scalar(f"SELECT {COLUMN} FROM {SETTINGS} WHERE id = '{SETTINGS_ID}'")
            == "30",
        )

        db.run(migration_sql(RETIREMENT, "contract"))

        ok(f"after 011: {TABLE} is gone under its name", not table_exists(db, TABLE))
        ok(
            f"after 011: the hold row is kept in _deprecated_{TABLE}",
            table_exists(db, f"_deprecated_{TABLE}")
            and db.scalar(f"SELECT id FROM _deprecated_{TABLE}") == HOLD_ID,
        )
        ok(
            f"after 011: {SETTINGS}.{COLUMN} is gone",
            not column_exists(db, SETTINGS, COLUMN),
        )
        ok(
            f"after 011: the 30 is kept in _deprecated_{COLUMN}",
            column_exists(db, SETTINGS, f"_deprecated_{COLUMN}")
            and db.scalar(
                f"SELECT _deprecated_{COLUMN} FROM {SETTINGS} WHERE id = '{SETTINGS_ID}'"
            )
            == "30",
        )

        # The door that writes settings keeps working on a hub that already had a row …
        run_settings_upsert(db)
        ok(
            "after 011: settings.upsert updates the existing row",
            db.scalar(f"SELECT COUNT(*) FROM {SETTINGS} WHERE hub_id = '{HUB}'") == "1",
        )
        # … and on a hub that never saved settings (the INSERT branch, no hold_minutes named).
        db.run(f"DELETE FROM {SETTINGS};")
        run_settings_upsert(db)
        ok(
            "after 011: settings.upsert creates the row on a hub without settings",
            db.scalar(f"SELECT COUNT(*) FROM {SETTINGS} WHERE hub_id = '{HUB}'") == "1",
        )

        # Reverting is a rename back.
        db.run(f"UPDATE {SETTINGS} SET _deprecated_{COLUMN} = 30;")
        db.run(REVERT)
        ok(
            "revert: the hold row is back under its name",
            db.scalar(f"SELECT id FROM {TABLE}") == HOLD_ID,
        )
        ok(
            "revert: hold_minutes is back under its name",
            db.scalar(f"SELECT {COLUMN} FROM {SETTINGS} WHERE hub_id = '{HUB}'")
            == "30",
        )
    except RuntimeError as exc:
        fail(f"Postgres: {exc}")
    finally:
        db.drop()


def main() -> int:
    if check_declaration():
        check_statements()
    if not failures:
        check_against_postgres()
    for note in notes:
        print(note)
    if failures:
        print("FAIL slot_hold_storage_retired:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK slot_hold_storage_retired: the slot hold storage is set aside, not destroyed"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
