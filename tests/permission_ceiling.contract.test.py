#!/usr/bin/env python3
"""Permission CEILING of the Tier-2 handler (ERPlora/hub#459) — an internal op may not demand
MORE permission than the command that pushes it.

The runtime resolves a handler's `Operation::sql("appointments._x", …)` against this manifest with
three rules — kind=sql, it exists, same module — and does NOT re-check the permission of the
destination. So a command anybody with `add_appointment` may call can reach SQL whose declared
permission is `change_appointment`: the ceiling leaks, and with elevation live that is a back door
to the manager level.

`appointments` was the ONE module publishing such a crossing: `appointments.appointments.create`
(and its siblings `bulk_create` / `recurring.materialize`, all `add_appointment`) push
`appointments._insert_history`, declared `change_appointment`. Writing the "created" row of a
booking you were allowed to create is not a change of somebody else's booking, so the internal op
is the one that was wrong.

This test reads the handler source for the ops each command pushes and pins the rule for all of
them, so a new crossing cannot be published by accident.

Usage: tests/permission_ceiling.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import re
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
_SOURCE = (MODULE_DIR / "handler" / "src" / "lib.rs").read_text()
# Cut the unit tests off: they call every entry point, so leaving them in makes the call graph
# say that the last function before `mod tests` reaches everything (it swallowed the module).
HANDLER = _SOURCE.split("#[cfg(test)]")[0]

# The manifest names the handler function of each Tier-2 command; the handler source says which
# internal ops each of those functions can reach (directly or through the helpers it calls). Both
# halves are READ, never written here, so a new op or a renamed helper cannot slip past.
failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def functions() -> dict[str, str]:
    """`fn name` -> its body, from the handler source."""
    bodies: dict[str, str] = {}
    starts = [(m.group(1), m.start()) for m in re.finditer(r"\n(?:pub )?fn ([a-z_0-9]+)", HANDLER)]
    for i, (name, start) in enumerate(starts):
        end = starts[i + 1][1] if i + 1 < len(starts) else len(HANDLER)
        bodies[name] = HANDLER[start:end]
    return bodies


def ops_reachable(fn: str, bodies: dict[str, str], seen: set[str] | None = None) -> set[str]:
    """Ops `fn` can push, following the helpers it calls (the handler has no recursion)."""
    seen = seen or set()
    if fn in seen or fn not in bodies:
        return set()
    seen.add(fn)
    body = bodies[fn]
    ops = set(re.findall(r'Operation::sql\("([a-z_.]+)"', body))
    for callee in set(re.findall(r"\b([a-z_0-9]+)\(", body)):
        if callee in bodies and callee != fn:
            ops |= ops_reachable(callee, bodies, seen)
    return ops


def permission_of(command: str) -> str | None:
    entry = MANIFEST["commands"].get(command)
    return entry.get("permission") if entry else None


def tier2_commands() -> dict[str, str]:
    """command -> handler function."""
    return {
        name: entry["handler"]["function"]
        for name, entry in MANIFEST["commands"].items()
        if isinstance(entry.get("handler"), dict) and entry["handler"].get("function")
    }


def check_the_check_finds_something() -> None:
    """A ceiling test that resolves no ops would pass for the worst possible reason."""
    bodies = functions()
    total = set()
    for fn in tier2_commands().values():
        total |= ops_reachable(fn, bodies)
    if not total:
        fail("no `Operation::sql(...)` reachable from any handler function — the check is vacuous")
    for op in sorted(total):
        if op not in MANIFEST["commands"]:
            fail(f"handler pushes `{op}`, which the manifest does not declare")


def check_ceiling() -> None:
    bodies = functions()
    role_perms = MANIFEST.get("role_permissions", {})
    for command, fn in sorted(tier2_commands().items()):
        caller_perm = permission_of(command)
        for op in sorted(ops_reachable(fn, bodies)):
            op_perm = permission_of(op)
            if not op_perm or op_perm == caller_perm:
                continue
            for role, perms in sorted(role_perms.items()):
                if caller_perm in perms and op_perm not in perms:
                    fail(
                        f"`{command}` (needs {caller_perm}) pushes `{op}` (needs {op_perm}): "
                        f"role `{role}` reaches SQL it was never granted — permission ceiling "
                        f"leak (hub#459)"
                    )


def main() -> int:
    check_the_check_finds_something()
    check_ceiling()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print("OK: no internal op demands more permission than the commands that push it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
