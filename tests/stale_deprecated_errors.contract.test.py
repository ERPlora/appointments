#!/usr/bin/env python3
"""No error code stays `deprecated` past the release that was supposed to delete it (ADR-0398).

ADR-0398 §3 retires a published error code in two releases: one marks it `deprecated: "<version>"`,
a LATER one deletes it from `module.json` and from `locales/en.json`/`es.json`. The gate only
guards the first half (a code cannot vanish without having been marked in the previous release);
nothing guarded the second, so `appointments.schedule_unavailable` sat `deprecated: "1.1.65"`
through twenty-five releases (appointments#186 found it while deleting the WhatsApp door codes).

WHAT THIS GUARDS. `module.json → version` is the last published release (`release.yml` bumps it
in the `chore(release)` commit). A code whose `deprecated` version is OLDER than that has already
had its "later release": it must be deleted, together with its `en`/`es` text. A code deprecated
AT the published version is the normal case (deleted by the next merge); one deprecated at a
version NOT yet published (the bump comes after the merge) is the first half in flight.

Only codes the manifest declares are looked at: a UI-side code such as
`appointments.invalid_local_time` (raised in `ui/lib/business-time.ts`) translates through the
same catalog without being a manifest error, and that is not this guard's business.

Usage: tests/stale_deprecated_errors.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())


def version_tuple(text: str) -> tuple[int, ...]:
    return tuple(int(part) for part in text.strip().split("."))


def stale_deprecated_codes() -> list[str]:
    published = version_tuple(MANIFEST["version"])
    return sorted(
        code
        for code, decl in (MANIFEST.get("errors") or {}).items()
        if isinstance(decl, dict)
        and isinstance(decl.get("deprecated"), str)
        and version_tuple(decl["deprecated"]) < published
    )


def stale_texts(stale: list[str]) -> list[str]:
    found = []
    for lang in ("en", "es"):
        catalog = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text())
        for code in stale:
            if code in (catalog.get("errors") or {}):
                found.append(
                    f"locales/{lang}.json: errors.{code} — the code is past its deletion "
                    "release, so is its text"
                )
    return found


def main() -> int:
    stale = stale_deprecated_codes()
    failures = [
        f"module.json: errors.{code} is deprecated since "
        f"{MANIFEST['errors'][code]['deprecated']} and v{MANIFEST['version']} is already "
        "published: delete it and its text (ADR-0398)"
        for code in stale
    ] + stale_texts(stale)
    if failures:
        print("FAIL stale_deprecated_errors:")
        for line in failures:
            print(f"  - {line}")
        return 1
    print(
        "OK stale_deprecated_errors: no error code is deprecated past its deletion release"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
