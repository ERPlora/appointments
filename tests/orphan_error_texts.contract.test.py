#!/usr/bin/env python3
"""Every error text in the catalogs has something that produces its code (appointments#190).

`locales/en.json` and `locales/es.json → errors` translate the codes the user can meet. A code
reaches the catalog through one of two doors: the manifest declares it (`module.json → errors`,
raised by the handler or the SQL), or the module's own UI raises it (such as
`appointments.invalid_local_time` in `ui/lib/business-time.ts`). A text with neither is dead: it
is translated, packed into `dist/` and downloaded by every hub, and it tells whoever reads the
catalog that a case exists when nothing produces it. `appointments.series_locked` («some
appointments of this series are already invoiced») sat there since the series split (#92), whose
invoiced occurrences are COUNTED in the result (`locked_invoiced`) and shown by the series panel,
never refused with an error.

`stale_deprecated_errors.contract.test.py` guards the other end (a declared code past its deletion
release); this one guards the texts the manifest never declared.

Usage: tests/orphan_error_texts.contract.test.py   (exit 0 = green)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())


def ui_sources() -> str:
    """The UI code that ships, tests excluded: a code only a test mentions is not produced."""
    return "\n".join(
        path.read_text()
        for path in sorted((MODULE_DIR / "ui").rglob("*.ts"))
        if not path.name.endswith(".test.ts")
    )


def orphan_texts() -> list[str]:
    declared = set((MANIFEST.get("errors") or {}).keys())
    ui = ui_sources()
    found = []
    for lang in ("en", "es"):
        catalog = json.loads((MODULE_DIR / "locales" / f"{lang}.json").read_text())
        for code in catalog.get("errors") or {}:
            if code in declared or f"'{code}'" in ui or f'"{code}"' in ui:
                continue
            found.append(
                f"locales/{lang}.json: errors.{code} — neither module.json declares it nor the "
                "UI raises it: declare and produce it, or delete the text"
            )
    return found


def main() -> int:
    failures = orphan_texts()
    if failures:
        print("FAIL orphan_error_texts:")
        for line in failures:
            print(f"  - {line}")
        return 1
    print("OK orphan_error_texts: every error text has a code that produces it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
