#!/usr/bin/env python3
"""`recurring.create` takes only what `recurring.materialize` can book (appointments#246).

A series created with no professional (by the assistant or through the API — the screen already
demanded one) sat in the list, active, and could never be booked: «Book appointments» sent
`recurring.materialize`, whose schema requires the customer, the service and the professional as
non-empty ids, and the screen painted the raw `invalid_payload`. The door that let the series in
was `recurring.create`, whose schema declared the three ids as optional, nullable strings.

The fix closes that door the way both of this module's other booking doors already do
(`appointments.appointments.create` and `recurring.materialize`): the three ids are REQUIRED
non-empty strings in the schema. The refusal is then the kernel's `invalid_payload` naming the
field, and — what matters most for the assistant — the tool definition generated from this schema
marks the three as required, so the model asks for the professional BEFORE calling instead of
creating a series nobody can book.

What this file pins:
  1. SHAPE. Each of `customer_id`, `service_id`, `staff_id` is in `required` and declared exactly
     as `recurring.materialize` declares it (`string`, `minLength: 1`) — the two must not drift.
  2. BEHAVIOUR. Validating real payloads with `jsonschema` (the same Draft 2020-12 the schema
     names): a series without the professional, with an empty one or with `null` is refused, and
     the same series WITH the three ids is accepted — so the guard is not just refusing everything.

Usage: tests/recurring_create_booking_ids.contract.test.py   (exit 0 = green)
  Needs `jsonschema`; without it this file FAILS instead of skipping.
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

BOOKING_IDS = ("customer_id", "service_id", "staff_id")

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def schema_of(command: str) -> dict:
    return json.loads(
        (MODULE_DIR / MANIFEST["commands"][command]["schema"]).read_text()
    )


create = schema_of("appointments.recurring.create")
materialize = schema_of("appointments.recurring.materialize")

# ── 1 · SHAPE ─────────────────────────────────────────────────────────────────────────────────
for field in BOOKING_IDS:
    if field not in create.get("required", []):
        fail(
            f"recurring_create.json: `{field}` must be required (materialize cannot book without it)"
        )
    want = materialize["properties"][field]
    got = create["properties"].get(field)
    if got != want:
        fail(
            f"recurring_create.json: `{field}` is {got}, must be declared as materialize does: {want}"
        )

# ── 2 · BEHAVIOUR ─────────────────────────────────────────────────────────────────────────────
try:
    import jsonschema
except ImportError:
    fail(
        "`jsonschema` is not importable: the payloads cannot be validated (pip install jsonschema)"
    )
    jsonschema = None

VALID = {
    "customer_id": "c1",
    "customer_name": "Ana López",
    "service_id": "sv1",
    "service_name": "Corte",
    "staff_id": "s1",
    "staff_name": "Eva Pro",
    "frequency": "weekly",
    "day_of_week": 1,
    "time": "10:00",
    "duration_minutes": 30,
    "start_date": "2099-10-06",
}

if jsonschema is not None:
    validator = jsonschema.Draft202012Validator(create)

    def errors(payload: dict) -> list:
        return list(validator.iter_errors(payload))

    if errors(VALID):
        fail(
            f"a complete series must be accepted, got: {[e.message for e in errors(VALID)]}"
        )

    for field in BOOKING_IDS:
        missing = {k: v for k, v in VALID.items() if k != field}
        for label, payload in (
            ("absent", missing),
            ("empty", {**VALID, field: ""}),
            ("null", {**VALID, field: None}),
        ):
            if not errors(payload):
                fail(f"a series with `{field}` {label} must be refused by the schema")

if failures:
    for f in failures:
        print(f"FAIL {f}")
    sys.exit(1)
print("OK recurring.create requires the three ids materialize books with")
