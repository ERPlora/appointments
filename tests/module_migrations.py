"""The migration guard of the hub, in miniature — shared by this module's Postgres batteries.

Every battery here builds a scratch database from `module.json`'s own migrations. Two things about
that list are NOT obvious, and getting either wrong makes a battery answer about a database the
fleet never has:

  1. **An entry has two shapes** (`MigrationEntry`, hub#542). The bare path —
     `"migrations/postgres/001_init.sql"`, which is what most of the published catalogue uses and
     means `expand`— or the object `{file, kind, since}`, the ONLY way to declare a `contract` and
     therefore the only legitimate way to write a `DROP`. A loop that assumes the string shape
     crashes on the object one.

  2. **A `contract` is REWRITTEN before it reaches the database.**
     `migration_guard::set_aside_instead_of_dropping` turns `DROP TABLE t` into
     `ALTER TABLE t RENAME TO _deprecated_t`, so the rows are set aside, not destroyed. A battery
     that applies the file raw DESTROYS what the hub only sets aside.

🔴 Ported character for character from `crates/runtime/src/migration_guard.rs`, flaws included. In
particular the translation matches `DROP TABLE ` at the START of the statement text while the
splitter keeps a preceding comment INSIDE the statement it precedes — so prose above a `DROP`
makes the translation miss in silence (ERPlora/hub#1137). A mirror that quietly behaves better
than the thing it mirrors is how a battery comes out green over a migration that destroys data in
production; `slot_hold_storage_retired.postgres.test.py` is what refuses the prose.

Copied from `ERPlora/kitchen` (`tests/module_migrations.py`): each module is its own repository, so
the mirror travels with the battery that needs it.

This file is not a battery: it runs inside the ones that import it.
"""

import json
import pathlib

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text(encoding="utf-8"))


def migration_entries(manifest: dict | None = None) -> list[tuple[str, str]]:
    """The manifest's Postgres migrations as `(file, kind)`, both shapes of `MigrationEntry`."""
    entries = (manifest or MANIFEST)["migrations"]["postgres"]
    out: list[tuple[str, str]] = []
    for entry in entries:
        if isinstance(entry, str):
            out.append((entry, "expand"))
        else:
            out.append((entry["file"], entry.get("kind", "expand")))
    return out


def strip_comments(sql: str) -> str:
    """Drop SQL comments before anything is read. A string literal is data, not a comment."""
    out = ""
    in_string = False
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if in_string:
            out += ch
            if ch == "'":
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            out += ch
        elif ch == "-" and i + 1 < n and sql[i + 1] == "-":
            i += 1
            while i + 1 < n and sql[i + 1] != "\n":
                i += 1
            if i + 1 < n:
                out += "\n"
                i += 1
        elif ch == "/" and i + 1 < n and sql[i + 1] == "*":
            i += 2
            while i < n and not (sql[i - 1] == "*" and sql[i] == "/"):
                i += 1
            out += " "
        else:
            out += ch
        i += 1
    return out


def split_statements(sql: str) -> list[str]:
    """Split on `;` respecting literals AND comments.

    A `;` inside `-- …` is prose, not SQL. The comment is KEPT inside the statement it precedes,
    which is exactly what makes the leading-prose trap possible.
    """
    out: list[str] = []
    current = ""
    in_string = False
    i, n = 0, len(sql)
    while i < n:
        ch = sql[i]
        if in_string:
            current += ch
            if ch == "'":
                in_string = False
            i += 1
            continue
        if ch == "'":
            in_string = True
            current += ch
        elif ch == "-" and i + 1 < n and sql[i + 1] == "-":
            current += ch
            i += 1
            while i < n:
                current += sql[i]
                if sql[i] == "\n":
                    break
                i += 1
        elif ch == "/" and i + 1 < n and sql[i + 1] == "*":
            current += ch
            i += 1
            prev = " "
            while i < n:
                current += sql[i]
                if prev == "*" and sql[i] == "/":
                    break
                prev = sql[i]
                i += 1
        elif ch == ";":
            if current.strip():
                out.append(current.strip())
            current = ""
        else:
            current += ch
        i += 1
    if current.strip():
        out.append(current.strip())
    return out


def _strip_if_exists(rest: str) -> tuple[str, str]:
    if rest.upper().startswith("IF EXISTS "):
        return "IF EXISTS ", rest[len("IF EXISTS ") :].strip()
    return "", rest


def set_aside_instead_of_dropping(statement: str) -> str:
    """`DROP TABLE t` → `ALTER TABLE t RENAME TO _deprecated_t`; same idea for `DROP COLUMN`.

    🔴 The match is on the START of the statement text, and `split_statements` keeps a preceding
    comment inside it — so prose above a `DROP` makes this miss, exactly as the runtime does.
    """
    upper = statement.upper()

    at = upper.find(" DROP COLUMN ")
    if at != -1:
        head = statement[:at].rstrip()
        guard, column = _strip_if_exists(statement[at + len(" DROP COLUMN ") :].strip())
        column = (column.split() or [column])[0].rstrip(";")
        return f"{head} RENAME COLUMN {guard}{column} TO _deprecated_{column}"

    if upper.startswith("DROP TABLE "):
        guard, table = _strip_if_exists(statement[len("DROP TABLE ") :].strip())
        table = (table.split() or [table])[0].rstrip(";")
        return f"ALTER TABLE {guard}{table} RENAME TO _deprecated_{table}"

    return statement


def as_the_runtime_applies(sql: str, kind: str) -> str:
    """The SQL the hub really executes. Only a `contract` is rewritten; the rest runs as written."""
    if kind != "contract":
        return sql
    return ";\n".join(set_aside_instead_of_dropping(s) for s in split_statements(sql)) + ";"


def migration_sql(rel: str, kind: str) -> str:
    """The text of one declared migration, already translated the way the runtime would apply it."""
    return as_the_runtime_applies(
        (MODULE_DIR / rel).read_text(encoding="utf-8"), kind
    )
