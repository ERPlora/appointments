#!/usr/bin/env python3
"""A battery against a live hub never hands the runtime TODAY's date — regression of
ERPlora/appointments#266.

§7 of `availability.hub.test.py` started a weekly series on `datetime.date.today()` at 14:00. The
runtime judges every occurrence against its real clock, so once 14:00 had passed on the series'
weekday, today's date came back `appointments.invalid_start` (in the past) instead of
`appointments.outside_staff_hours`, and the battery went red in the afternoon on a module that was
fine. The CI runs at whatever hour it runs: a battery like that is green or red by the clock.

A date the runtime will compare with `now` has to be far from it — `next_weekday()` (a week or more
ahead) or `today + timedelta(days=N)`. So the rule held here, for every `*.hub.test.py` and the
`hub_harness.py` they share: the clock's own date (`date.today()`, `datetime.now()`,
`datetime.utcnow()`, or a name bound to one of them) is only ever used with an offset added or
subtracted — never formatted, `str()`-ed or put in a payload as it is. It reads the code's syntax
tree, not its text, so a spelling of the same leak (an f-string, a variable) does not slip past.
This catches the bug at any hour, which the battery itself only does after 14:00 on a Wednesday.

Usage: tests/hub_batteries_clock_free.contract.test.py   (exit 0 = green)
"""

from __future__ import annotations

import ast
import pathlib
import sys

TESTS_DIR = pathlib.Path(__file__).resolve().parent

CLOCK_METHODS = {"today", "now", "utcnow"}
CLOCK_OWNERS = {"date", "datetime"}


def _owner(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def clock_leaks(source: str) -> list[int]:
    """Line numbers where `source` hands on the clock's own date, without an offset."""
    tree = ast.parse(source)
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}

    def reads_clock(node: ast.AST, bound: set[str]) -> bool:
        if isinstance(node, ast.Name):
            return node.id in bound
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            return False
        # `datetime.now().date()` is still the clock's own date.
        if node.func.attr == "date" and not node.args:
            return reads_clock(node.func.value, bound)
        return node.func.attr in CLOCK_METHODS and _owner(node.func.value) in CLOCK_OWNERS

    def outermost(node: ast.AST) -> ast.AST:
        # Climb `.date()` so the judgement is on the whole expression.
        while True:
            parent = parents.get(node)
            grand = parents.get(parent) if parent is not None else None
            if (
                isinstance(parent, ast.Attribute)
                and parent.attr == "date"
                and isinstance(grand, ast.Call)
                and grand.func is parent
            ):
                node = grand
                continue
            return node

    # Names bound to the clock (`today = datetime.date.today()`), found to a fixed point.
    bound: set[str] = set()
    while True:
        more = {
            target.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign) and reads_clock(node.value, bound)
            for target in node.targets
            if isinstance(target, ast.Name)
        }
        if more <= bound:
            break
        bound |= more

    leaks: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and not isinstance(node.ctx, ast.Load):
            continue
        if not reads_clock(node, bound):
            continue
        node = outermost(node)
        parent = parents.get(node)
        if isinstance(parent, ast.BinOp) and isinstance(parent.op, (ast.Add, ast.Sub)):
            continue  # an offset: `today + timedelta(days=7)`
        if isinstance(parent, ast.Assign) and parent.value is node:
            continue  # the binding itself; its uses are judged where they are
        leaks.add(node.lineno)
    return sorted(leaks)


# The detector judged against known answers first: a guard that stopped seeing a leak would stay
# green on every battery, and nobody would notice.
LEAKS = {
    "the literal of #266": "p = {'start_date': datetime.date.today().isoformat()}",
    "str()": "p = {'start_date': str(datetime.date.today())}",
    "an f-string": "p = {'start_date': f'{datetime.date.today():%Y-%m-%d}'}",
    "datetime.now()": "p = {'start_date': datetime.datetime.now().date().isoformat()}",
    "a bare `date` import": "p = {'at': date.today()}",
    "through a variable": "today = datetime.date.today()\np = {'start_date': today.isoformat()}",
    "a variable bound to now().date()": "d = datetime.datetime.now().date()\np = {'at': str(d)}",
}
CLEAN = {
    "an offset": "p = {'start_date': (datetime.date.today() + datetime.timedelta(days=7)).isoformat()}",
    "a variable, then an offset": (
        "today = datetime.date.today()\n"
        "p = {'to': (today + datetime.timedelta(days=500)).isoformat()}"
    ),
    "next_weekday()": "p = {'start_date': next_weekday()}",
    "now().date() with an offset": "d = datetime.datetime.now().date() + datetime.timedelta(days=9)",
}
misjudged = [
    f"missed: {name}" for name, src in LEAKS.items() if not clock_leaks(src)
] + [f"false alarm: {name}" for name, src in CLEAN.items() if clock_leaks(src)]
if misjudged:
    print("✗ hub_batteries_clock_free: the detector misjudges its own examples:")
    for case in misjudged:
        print(f"  - {case}")
    sys.exit(1)

batteries = sorted(TESTS_DIR.glob("*.hub.test.py"))
failures: list[str] = []
for battery in [*batteries, TESTS_DIR / "hub_harness.py"]:
    lines = battery.read_text().splitlines()
    for number in clock_leaks(battery.read_text()):
        failures.append(f"{battery.name}:{number}: {lines[number - 1].strip()}")

if not batteries:
    print(
        "hub_batteries_clock_free: no *.hub.test.py found — the guard would prove nothing"
    )
    sys.exit(1)

if failures:
    print(
        "✗ hub_batteries_clock_free: a live-hub battery hands the runtime TODAY's date, so its "
        "verdict depends on the hour it runs (appointments#266). Use next_weekday() or "
        "today + timedelta(days=N):"
    )
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print(
    f"✓ hub_batteries_clock_free: {len(batteries)} live-hub batteries, none sends today's date"
)
