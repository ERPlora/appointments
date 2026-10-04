#!/usr/bin/env python3
"""A battery against a live hub never materializes a series up to the edge of the booking window —
regression of ERPlora/appointments#276.

§7 of `availability.hub.test.py` created a weekly series with no end and materialized it without a
`to`. `materialize` then closes the window itself at today + `max_advance_booking` (90 days), and
the runtime judges each date against its real clock. When the series' weekday put its last date on
day 90 exactly — every run on a Thursday, because `next_weekday()` lands 13 days ahead — that date
came back `appointments.too_far` instead of `appointments.outside_staff_hours`, and the battery went
red on a module that was fine (hub module e2e, 2026-10-01). Any other weekday it was green.

So the rule held here, for every `*.hub.test.py`: a battery that calls
`appointments.recurring.materialize` WITHOUT a `to` must close every series it creates itself, with
`max_occurrences` or `end_date`, so none of its dates reaches the edge of the window. A battery
that passes `to` closes the window on purpose and is judging the horizon (`series_edit_at_horizon`,
`busy_agenda_booking`). It reads the code's syntax tree, so a payload built in a variable, spread
with `**` or filtered with a comprehension is followed to the dict that defines it.

Usage: tests/hub_batteries_series_bounded.contract.test.py   (exit 0 = green)
"""

from __future__ import annotations

import ast
import pathlib
import sys

TESTS_DIR = pathlib.Path(__file__).resolve().parent

CREATE = "appointments.recurring.create"
MATERIALIZE = "appointments.recurring.materialize"
SERIES_BOUNDS = {"max_occurrences", "end_date"}


def unbounded_series(source: str) -> list[int]:
    """Line numbers of the series `source` creates with no end while materializing with no `to`."""
    tree = ast.parse(source)
    assigned: dict[str, list[ast.expr]] = {}

    def bind(target: ast.expr, value: ast.expr) -> None:
        if isinstance(target, ast.Name):
            assigned.setdefault(target.id, []).append(value)
        elif isinstance(target, ast.Tuple) and isinstance(value, ast.Tuple):
            for name, item in zip(target.elts, value.elts):
                bind(name, item)

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                bind(target, node.value)
        elif isinstance(node, ast.For) and isinstance(node.iter, (ast.Tuple, ast.List)):
            # `for label, payload in (("absent", {...}), ("empty", {...}))`
            for item in node.iter.elts:
                bind(node.target, item)

    def keys(node: ast.expr, seen: frozenset[str] = frozenset()) -> set[str] | None:
        """The literal keys a payload expression carries; None when it cannot be followed."""
        if isinstance(node, ast.Dict):
            found: set[str] = set()
            for key, value in zip(node.keys, node.values):
                if key is None:  # `**spread`
                    spread = keys(value, seen)
                    if spread is None:
                        return None
                    found |= spread
                elif isinstance(key, ast.Constant) and isinstance(key.value, str):
                    found.add(key.value)
                # A computed key (`{**payload, field: ""}`) adds a key; it never takes one away.
            return found
        if isinstance(node, ast.Name) and node.id not in seen and node.id in assigned:
            # A name bound to several dicts carries only what EVERY binding carries.
            sets = [keys(value, seen | {node.id}) for value in assigned[node.id]]
            if any(s is None for s in sets):
                return None
            return set.intersection(*sets)
        if isinstance(node, ast.DictComp):
            # `{k: v for k, v in payload.items() if …}`: at most what `payload` carries. Taken as
            # carrying all of it — a comprehension that drops a bound is the door's refusal test.
            source_iter = node.generators[0].iter
            if (
                isinstance(source_iter, ast.Call)
                and isinstance(source_iter.func, ast.Attribute)
                and source_iter.func.attr == "items"
            ):
                return keys(source_iter.func.value, seen)
        return None

    creates: list[tuple[int, ast.expr]] = []
    open_window = False
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and len(node.args) >= 2):
            continue
        name = node.args[0]
        if not (isinstance(name, ast.Constant) and name.value in (CREATE, MATERIALIZE)):
            continue
        payload = node.args[1]
        if name.value == CREATE:
            creates.append((node.lineno, payload))
            continue
        carried = keys(payload)
        if carried is None or "to" not in carried:
            open_window = True

    if not open_window:
        return []
    return sorted(
        line
        for line, payload in creates
        if not ((keys(payload) or set()) & SERIES_BOUNDS)
    )


# The detector judged against known answers first: a guard that stopped seeing an open series
# would stay green on every battery, and nobody would notice.
MATERIALIZE_OPEN = f"hub.command('{MATERIALIZE}', {{**batch, 'recurring_id': rid}})\n"
OPEN = {
    "the shape of #276": (
        "batch = {'customer_id': c}\n"
        f"rid = hub.new_id('{CREATE}', {{'frequency': 'weekly', 'start_date': day}})\n"
        + MATERIALIZE_OPEN
    ),
    "a payload in a variable": (
        "batch = {'customer_id': c}\n"
        "p = {'frequency': 'weekly', 'start_date': day}\n"
        f"rid = hub.new_id('{CREATE}', p)\n" + MATERIALIZE_OPEN
    ),
    "a bound that only one branch carries": (
        "batch = {'customer_id': c}\n"
        "p = {'max_occurrences': 4}\n"
        "p = {'frequency': 'weekly'}\n"
        f"rid = hub.new_id('{CREATE}', p)\n" + MATERIALIZE_OPEN
    ),
    "a loop over payloads, one of them open": (
        "batch = {'customer_id': c}\n"
        "for label, p in (('a', {'max_occurrences': 2}), ('b', {'start_date': day})):\n"
        f"    hub.command('{CREATE}', p)\n" + MATERIALIZE_OPEN
    ),
    "a materialize whose payload cannot be followed": (
        f"rid = hub.new_id('{CREATE}', {{'start_date': day}})\n"
        f"hub.command('{MATERIALIZE}', build())\n"
    ),
}
CLOSED = {
    "max_occurrences": (
        "batch = {'customer_id': c}\n"
        f"rid = hub.new_id('{CREATE}', {{'start_date': day, 'max_occurrences': 4}})\n"
        + MATERIALIZE_OPEN
    ),
    "end_date": (
        "batch = {'customer_id': c}\n"
        f"rid = hub.new_id('{CREATE}', {{'start_date': day, 'end_date': last}})\n"
        + MATERIALIZE_OPEN
    ),
    "a bound spread into the payload": (
        "batch = {'customer_id': c}\n"
        "base = {'max_occurrences': 2}\n"
        f"rid = hub.new_id('{CREATE}', {{**base, 'staff_id': ''}})\n"
        f"hub.command('{CREATE}', {{k: v for k, v in base.items() if k != 'x'}})\n"
        + MATERIALIZE_OPEN
    ),
    "a loop over payloads that all carry the bound": (
        "batch = {'customer_id': c}\n"
        "base = {'max_occurrences': 2}\n"
        "for label, p in (('a', {**base, 'x': ''}), ('b', {k: v for k, v in base.items()})):\n"
        f"    hub.command('{CREATE}', p)\n" + MATERIALIZE_OPEN
    ),
    "a materialize that closes its window with `to`": (
        f"rid = hub.new_id('{CREATE}', {{'start_date': day}})\n"
        f"hub.result('{MATERIALIZE}', {{'recurring_id': rid, 'from': a, 'to': b}})\n"
    ),
}
misjudged = [
    f"missed: {name}" for name, src in OPEN.items() if not unbounded_series(src)
] + [f"false alarm: {name}" for name, src in CLOSED.items() if unbounded_series(src)]
if misjudged:
    print("✗ hub_batteries_series_bounded: the detector misjudges its own examples:")
    for case in misjudged:
        print(f"  - {case}")
    sys.exit(1)

batteries = sorted(TESTS_DIR.glob("*.hub.test.py"))
if not batteries:
    print(
        "hub_batteries_series_bounded: no *.hub.test.py found — the guard would prove nothing"
    )
    sys.exit(1)

failures: list[str] = []
for battery in batteries:
    source = battery.read_text()
    lines = source.splitlines()
    for number in unbounded_series(source):
        failures.append(f"{battery.name}:{number}: {lines[number - 1].strip()}")

if failures:
    print(
        "✗ hub_batteries_series_bounded: a live-hub battery materializes a series with no end and "
        "no `to`, so its last date lands on the edge of the booking window and its verdict "
        "depends on the weekday it runs (appointments#276). Give the series `max_occurrences` "
        "or `end_date`:"
    )
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)

print(
    f"✓ hub_batteries_series_bounded: {len(batteries)} live-hub batteries, every series they "
    "materialize ends inside the booking window"
)
