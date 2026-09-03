#!/usr/bin/env python3
"""A block nobody reads must not carry a second copy of one that IS read (ERPlora/appointments#97).

WHAT WENT WRONG. `ai_context` — a block the runtime parses as an opaque `serde_json::Value` and
deliberately skips when it walks the manifest (`crates/runtime/src/manifest.rs`), described by the
contract itself as "APARCADO / en diseño" — carried its own `depends_on`:

    "ai_context": { "summary": "...", "depends_on": ["customers", "schedules", "services", "staff"] }

The list the installer and the marketplace actually resolve is the one at the ROOT, and by the time
this was measured the two had already drifted: the root pins `{"id": "schedules",
"min_version": "2.0.17"}` and the shadow copy had lost the pin. Nothing was watching, because
nothing reads the copy — a duplicate that no door checks does not stay a duplicate, it becomes a
second, wrong answer to the same question, sitting in the file that authors read to learn the
module.

WHY A TEST AND NOT JUST THE DELETION. Deleting the block fixes today; this stops it coming back.
The invariant is deliberately about the SHAPE, not about `ai_context` being absent: the shape of
that block is still an open question upstream (ERPlora/hub#1334 — the schema types it as an object,
`tasks` and `reservations` publish a string, and nothing has been decided). Should the RAG design
land and give this module an `ai_context` again, this test lets it through — as long as it does not
restate a declaration whose only authority is the manifest root.

Usage: tests/manifest_shadow_declarations.contract.test.py   (exit 0 = green)
"""

import copy
import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

# Declarations whose ONLY authority is the root of the manifest, and who reads each one. A nested
# key with one of these names is a shadow: it looks authoritative to whoever opens the file, and no
# door ever compares it against the real one.
ROOT_ONLY_DECLARATIONS = {
    "depends_on": (
        "the hub installer resolves the dependency plan from the ROOT `depends_on` "
        "(`execute_plan`), and so does the marketplace when it writes the catalogue graph "
        "(`apply_declared_dependencies`, saas#1462) — including the `min_version` pins, which a "
        "hand-copied list is exactly what loses"
    ),
}

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def shadow_declarations(manifest: dict) -> list[str]:
    """Dotted paths of every NESTED copy of a root-only declaration. Root itself never counts."""
    found: list[str] = []

    def walk(node, path: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                child = f"{path}.{key}" if path else key
                if path and key in ROOT_ONLY_DECLARATIONS:
                    found.append(child)
                walk(value, child)
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")

    walk(manifest, "")
    return found


def check_the_check_finds_the_positive() -> None:
    """The walker has to catch the exact block this issue removed, or the check below proves nothing.

    A contract test that only ever runs against a clean manifest is green whether it works or not.
    This feeds it the drifted copy that shipped in v1.1.60 and demands the report.
    """
    planted = copy.deepcopy(MANIFEST)
    planted["ai_context"] = {
        "summary": "planted by the test, never published",
        "depends_on": ["customers", "schedules", "services", "staff"],
    }
    if "ai_context.depends_on" not in shadow_declarations(planted):
        fail(
            "the walker no longer reports `ai_context.depends_on` on a manifest that carries it: "
            "this battery stopped checking anything"
        )

    if shadow_declarations({"depends_on": ["customers"]}):
        fail("the ROOT `depends_on` is the authority, not a shadow — the walker must not report it")


def check_the_manifest_has_no_shadow_declarations() -> None:
    for path in sorted(shadow_declarations(MANIFEST)):
        name = path.rsplit(".", 1)[-1].rstrip("]").split("[")[0]
        fail(f"`{path}` restates the root `{name}`: {ROOT_ONLY_DECLARATIONS[name]}")


def check_the_root_still_declares_them() -> None:
    """If the root ever lost one of these, "no shadow copies" would be true and worthless."""
    for name in sorted(ROOT_ONLY_DECLARATIONS):
        if name not in MANIFEST:
            fail(f"the root no longer declares `{name}`: there is no authority left to shadow")


def main() -> int:
    check_the_check_finds_the_positive()
    check_the_manifest_has_no_shadow_declarations()
    check_the_root_still_declares_them()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print("OK: no block restates a declaration the root already owns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
