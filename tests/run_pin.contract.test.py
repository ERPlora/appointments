#!/usr/bin/env python3
"""A statement that finds «the row this run just wrote» by `x.updated_at = :now` must run in the
SAME command as the UPDATE that wrote it — regression of ERPlora/appointments#196.

The pin (`a.updated_at = :now`, the verifactu#27 pattern) is how this module's history lines and
its overlap gate say «only if the UPDATE really applied»: the UPDATE stamps `updated_at = :now`,
and the statement after it looks for exactly that stamp. It only works while both statements see
the SAME `:now`.

The runtime guarantees that WITHIN one command, never across two: a declarative command binds its
params once for its whole `sql[]`, but the operations a WASM handler returns are bound one by one,
each with a fresh `:now` (`crates/runtime/src/commands.rs`, `system_params` inside the loop over
`output.operations`). When `_history_reschedule` and `_history_cancel` were operations of their
own, their pin matched nothing and every move and every cancellation vanished from the history
without an error — and `_appointment_overlap_assert`, a separate operation of the same WASM chain,
stayed green whatever the row overlapped.

So the rule this battery holds for every command in the manifest: a file that READS the pin needs
an earlier file of its own `sql[]` that WRITES it. A standalone command that reads the pin is the
bug, whoever emits it.

Usage: tests/run_pin.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# `a.updated_at = :now` / `me.updated_at = :now` — the pin read back through a table alias.
READS_PIN = re.compile(r"\b[a-z_]+\.updated_at\s*=\s*:now\b")
# An UPDATE that stamps the run: `SET … updated_at = :now` (unqualified, in the SET list).
WRITES_PIN = re.compile(
    r"\bUPDATE\b[\s\S]*?(?<![.\w])updated_at\s*=\s*:now\b", re.IGNORECASE
)

failures: list[str] = []


def strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def files_of(command: dict) -> list[str]:
    files = command.get("sql") or []
    return [files] if isinstance(files, str) else list(files)


def check_every_pin_reader_follows_its_writer() -> int:
    readers = 0
    for name, command in sorted((MANIFEST.get("commands") or {}).items()):
        if not isinstance(command, dict):
            continue
        files = files_of(command)
        for i, rel in enumerate(files):
            sql = strip_comments((MODULE_DIR / rel).read_text())
            if not READS_PIN.search(sql):
                continue
            readers += 1
            earlier = [strip_comments((MODULE_DIR / f).read_text()) for f in files[:i]]
            if not any(WRITES_PIN.search(e) for e in earlier):
                failures.append(
                    f"{name}: {rel} reads the run pin (`updated_at = :now`) but no earlier "
                    f"statement of the same command writes it (sql = {files!r}). A WASM handler's "
                    "operations each get their own `:now`, so the pin can only hold inside one "
                    "command (appointments#196)."
                )
    return readers


def check_control_catches_a_standalone_reader() -> None:
    """The positive: a standalone command with only the history file must be flagged."""
    reader = strip_comments((MODULE_DIR / "commands/_history_confirm.sql").read_text())
    writer = strip_comments(
        (MODULE_DIR / "commands/appointment_confirm.sql").read_text()
    )
    if not READS_PIN.search(reader):
        failures.append("control: READS_PIN no longer recognises _history_confirm.sql")
    if not WRITES_PIN.search(writer):
        failures.append(
            "control: WRITES_PIN no longer recognises appointment_confirm.sql"
        )
    if WRITES_PIN.search(reader):
        failures.append(
            "control: WRITES_PIN mistakes the history INSERT for the UPDATE"
        )


def main() -> int:
    check_control_catches_a_standalone_reader()
    readers = check_every_pin_reader_follows_its_writer()
    if readers == 0:
        failures.append(
            "no statement reads the run pin: the battery is checking nothing"
        )
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print(f"ok: {readers} pin readers, each after the UPDATE of its own command")
    return 0


if __name__ == "__main__":
    sys.exit(main())
