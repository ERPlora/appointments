"""Plumbing shared by the `*.hub.test.py` batteries — the ones that talk to a REAL kernel.

`erplora test <dir> --against-hub` (module-toolkit#110) starts the published hub image with its
own Postgres, installs the module through `POST /api/modules/install` and hands the url over in
`ERPLORA_HUB_BASE_URL`. Everything below is the thin layer between a battery and that runtime: the
two doors (`/api/query`, `/api/command`), the error envelope keyed by CODE, the booking policy the
availability engine reads, and one piece of bookkeeping every battery needs — a `check()` that
records a failure instead of dying on it, so a red run names EVERY broken assertion and not just
the first.

Why HTTP and not a scratch Postgres: these batteries replace the hub's own
`appointments_availability_e2e.rs` (ERPlora/hub#1264, contract «El Hub se CIERRA como KERNEL» §5).
What they assert is the availability engine AS THE RUNTIME RUNS IT — `:hub_id` and `:now` injected
by the host, the `erp_*` bridge functions rendered by the real dialect, the `reads` of
`appointments.appointments.create` pre-loaded by the dispatcher, the WASM handler executed inside
the transaction — and none of that exists in a hand-written harness that binds `:hub_id` itself.
The Postgres batteries next door (`*.postgres.test.py`) keep proving the SQL in isolation, which is
cheaper and sharper for a query's edge cases; these prove the module against the kernel that runs
it.

Three facts of the runtime a battery has to know, all resolved here so no battery hard-codes them:

  * THE TENANT. Module seeds land under the RUNTIME's own `hub_id`, not under whatever `X-Hub-Id` a
    request carries (that is how hub#594 was found), and it is NOT the `local` of
    `ERPLORA_HUB_ID`. `GET /api/hub/context` says which id that is, and every request goes out
    under it.
  * THE SESSION USER. Dev auth trusts `X-User-Id`. Each run mints its own, because batteries share
    one hub for the length of the run and a fixed id would mix this run's rows with a previous
    one's under the same shared hub.
  * THE DEPENDENCIES. `appointments` declares `depends_on: ["customers", "schedules", "services",
    "staff"]` — `schedules` since appointments#102, because the opening-hours gate reads ITS lists —
    and `services` in turn depends on `taxes`, so the whole chain has to be installed through the same
    door, in topological order, BEFORE the module. `--against-hub` mounts one directory
    (module-toolkit#135), so today that install is done by hand; the harness refuses to run when
    any of them is missing rather than reporting an availability engine that answers about an
    empty catalogue.

It refuses to skip. Without a runtime a battery FAILS: a check that excuses itself is the green
that proves nothing this whole toolkit exists to remove (module-toolkit#50).
"""

import datetime
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
import zoneinfo

BASE = (
    os.environ.get("APPOINTMENTS_HUB_BASE_URL")
    or os.environ.get("ERPLORA_HUB_BASE_URL")
    or ""
).rstrip("/")

# The whole chain `appointments` needs installed to answer for itself.
NEEDS = ("taxes", "customers", "schedules", "services", "staff", "appointments")


class Hub:
    """One battery's view of the live runtime."""

    def __init__(self, battery: str, needs: tuple[str, ...] = NEEDS):
        self.battery = battery
        self.failures: list[str] = []
        if not BASE:
            print(
                f"{battery}: no runtime at the other end (ERPLORA_HUB_BASE_URL is empty)."
            )
            print(
                "Run it with `erplora test <dir> --against-hub`; without a hub this is NOT a skip, "
                "it is a failure."
            )
            sys.exit(1)
        self.user = f"u-{uuid.uuid4().hex[:8]}"
        self.hub_id, self.timezone = self._runtime_context()
        self._require_installed(needs)

    # ── transport ────────────────────────────────────────────────────────────────────────

    def _request(self, method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            f"{BASE}{path}",
            data=data,
            headers={
                "content-type": "application/json",
                "x-hub-id": self.hub_id,
                "x-user-id": self.user,
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.status, json.loads(res.read().decode() or "null")
        except urllib.error.HTTPError as err:
            raw = err.read().decode()
            try:
                return err.code, json.loads(raw or "null")
            except json.JSONDecodeError:
                return err.code, {"raw": raw}

    def _runtime_context(self) -> tuple[str, str]:
        """`(hub_id, timezone)` — the tenant the seeds land under, and the BUSINESS's clock.

        The timezone is the second fact no battery may hard-code: the opening-hours gate crosses
        WALL time (`context.timezone`, resolved by the host — hub#731) against the hours
        `schedules` holds, so `08:00Z` is only 08:00 for the business on a hub that runs on UTC.
        The endpoint publishes the resolved IANA name, never `null`."""
        req = urllib.request.Request(f"{BASE}/api/hub/context", method="GET")
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read().decode())
        hub_id = body.get("hub_id")
        if not hub_id:
            print(f"{self.battery}: GET /api/hub/context did not say the hub_id: {body}")
            sys.exit(1)
        timezone = body.get("timezone")
        if not timezone:
            print(f"{self.battery}: GET /api/hub/context did not say the timezone: {body}")
            sys.exit(1)
        return hub_id, timezone

    def _require_installed(self, needs: tuple[str, ...]) -> None:
        status, body = self._request("GET", "/api/modules")
        installed = (
            {m["id"] for m in (body or {}).get("data", [])} if status == 200 else set()
        )
        missing = [m for m in needs if m not in installed]
        if missing:
            print(
                f"{self.battery}: the runtime at {BASE} does not have {missing} installed "
                f"(installed: {sorted(installed)}). `appointments` declares `depends_on: "
                '["customers", "schedules", "services", "staff"]` and `services` pulls in `taxes`, '
                "so the whole chain has to go through `POST /api/modules/install` in topological "
                "order before "
                "the module. Not a skip: an availability engine asked about an empty catalogue "
                "answers `available` to everything."
            )
            sys.exit(1)

    # ── the two doors ────────────────────────────────────────────────────────────────────

    def query(self, name: str, params: dict | None = None) -> list:
        """Rows of a query. A query with a `list` block answers `{rows,total,…}`; the rest answer
        the bare array. Both come back as the list of rows."""
        status, body = self._request(
            "POST", "/api/query", {"name": name, "params": params or {}}
        )
        if status != 200 or not (body or {}).get("ok"):
            raise AssertionError(f"query {name} answered {status}: {body}")
        data = body["data"]
        if isinstance(data, dict) and "rows" in data:
            return data["rows"]
        return data

    def command(self, name: str, payload: dict):
        """`(status, body)` of a command, whatever the runtime answered."""
        return self._request("POST", "/api/command", {"name": name, "payload": payload})

    def run(self, name: str, payload: dict) -> dict:
        """A command that MUST succeed. Its `data` (`new_ids`, `operations`, …)."""
        status, body = self.command(name, payload)
        if status != 200 or not (body or {}).get("ok"):
            raise AssertionError(f"command {name} answered {status}: {body}")
        return body["data"]

    def result(self, name: str, payload: dict):
        """What the command's HANDLER answered — `data.result` (hub#70).

        The envelope is `{ok, operations, new_ids, result}` and the key appears only when a handler
        answered, so reading `source`/`spans` off `data` itself finds nothing at all. That is not a
        detail of this harness: it is how every caller reads one, and reading it wrong is a screen
        that silently believes the authority never spoke."""
        data = self.run(name, payload)
        if "result" not in data:
            raise AssertionError(
                f"command {name} answered no `result`; its handler returned nothing: {data}"
            )
        return data["result"]

    def new_id(self, name: str, payload: dict) -> str:
        """The id the HOST minted for the row a command created. Never composed by the caller:
        the id is the runtime's to give (row contract), and a battery that guesses it is testing
        its own arithmetic."""
        data = self.run(name, payload)
        ids = data.get("new_ids") or []
        if not ids:
            raise AssertionError(f"command {name} minted no id: {data}")
        return ids[0]

    def refused(self, label: str, name: str, payload: dict, code: str) -> None:
        """The runtime must REFUSE the command with exactly this domain code — the code, never the
        prose (ADR-0398 §6): the message is human text AND translated (ADR-0055), so asserting on
        it is asserting on the translation. This is the very trap the hub e2e fell into: it
        sniffed the `overlap:` prefix and went red the day `appointments` started answering in
        business language (appointments#70/#71)."""
        status, body = self.command(name, payload)
        got = (
            ((body or {}).get("error") or {}).get("code")
            if isinstance(body, dict)
            else None
        )
        if status == 200:
            self.failures.append(
                f"{label} — expected refusal `{code}`, the command SUCCEEDED: {body}"
            )
            print(f"  FAIL: {label} — expected refusal `{code}`, got success: {body}")
        elif got != code:
            self.failures.append(
                f"{label} — expected code [{code}], got [{got}] (HTTP {status}: {body})"
            )
            print(f"  FAIL: {label} — expected code [{code}], got [{got}] (HTTP {status})")
        else:
            print(f"  ok: {label} refused with `{code}` (HTTP {status})")

    # ── bookkeeping ──────────────────────────────────────────────────────────────────────

    def check(self, label: str, got, want) -> None:
        if got != want:
            self.failures.append(f"{label} — expected [{want!r}], got [{got!r}]")
            print(f"  FAIL: {label} — expected [{want!r}], got [{got!r}]")
        else:
            print(f"  ok: {label} = {got!r}")

    def check_true(self, label: str, condition: bool, detail="") -> None:
        if not condition:
            self.failures.append(f"{label} — {detail}" if detail else label)
            print(f"  FAIL: {label} {detail}")
        else:
            print(f"  ok: {label}")

    def finish(self, verdict: str) -> int:
        print()
        if self.failures:
            print(f"✗ {self.battery}: {len(self.failures)} failure(s):")
            for f in self.failures:
                print(f"  - {f}")
            return 1
        print(f"✓ {self.battery}: {verdict}")
        return 0


# ── the booking policy the engine reads ──────────────────────────────────────────────────


def set_booking_policy(
    hub: Hub,
    *,
    allow_overlapping: bool,
    min_booking_notice: int = 0,
    max_advance_booking: int = 90,
    default_duration: int = 60,
) -> None:
    """Writes the hub's booking policy through the real settings door.

    `min_booking_notice=0` on purpose: the engine crosses `:now` — injected by the RUNTIME with the
    server's real clock — against the notice, so a battery that left the default 60 minutes would
    be asserting about the wall clock of whoever runs it. The settings row is ONE per hub
    (`appointments_settings`), so every section that depends on the policy sets it again instead of
    inheriting whatever the previous section left behind."""
    hub.run(
        "appointments.settings.upsert",
        {
            "default_duration": default_duration,
            "min_booking_notice": min_booking_notice,
            "max_advance_booking": max_advance_booking,
            "allow_overlapping": allow_overlapping,
            "calendar_start_hour": 8,
            "calendar_end_hour": 20,
            "slot_interval": 15,
        },
    )


def availability(
    hub: Hub, start: str, duration: int, staff_id: str | None = None
) -> tuple[int, str]:
    """`(available, reason)` of `appointments.availability.check` — the engine that answers the
    same verdict the booking door enforces.

    It is a COMMAND and not a query since appointments#122: the opening hours belong to
    `schedules`, a query of a module may only name its own tables, and a handler is the only place
    that gets the authority's lists pre-loaded (`reads`). The SQL half survives underneath as
    `appointments.availability.own_rules`."""
    payload: dict = {"start_datetime": start, "duration_minutes": duration}
    if staff_id is not None:
        payload["staff_id"] = staff_id
    verdict = hub.result("appointments.availability.check", payload)
    if not isinstance(verdict, dict) or "available" not in verdict:
        raise AssertionError(
            f"availability.check answered {verdict!r} for {start} "
            f"({duration} min, staff={staff_id})"
        )
    return int(verdict["available"]), verdict.get("reason") or ""


# ── the links a booking needs, created for real ──────────────────────────────────────────


class Links:
    """Customer, service and two professionals, all REAL rows of this hub.

    `appointments.appointments.create` stopped believing the browser: it RESOLVES customer, service
    and staff against the hub through its `reads` and refuses what it cannot find
    (appointments#11/#21). Ids invented by a test would be rejected as `customer_not_found` — and a
    battery that read that as «the overlap was refused» would be green about nothing."""

    def __init__(
        self,
        customer_id,
        service_id,
        staff_id,
        other_staff_id,
        service_name,
        staff_name,
        other_staff_name,
    ):
        self.customer_id = customer_id
        self.service_id = service_id
        self.staff_id = staff_id
        self.other_staff_id = other_staff_id
        self.service_name = service_name
        # The names the CATALOGUE holds. An appointment freezes these, not the ones the caller
        # sent — which is why a battery has to know them to assert the snapshot.
        self.staff_name = staff_name
        self.other_staff_name = other_staff_name


def seed_links(hub: Hub, tag: str, duration_minutes: int = 30) -> Links:
    """Creates the links through the public commands, tagged so a hub SHARED with every other
    section keeps this section's rows apart from the rest.

    The tax key is READ from `taxes` rather than hardcoded: a seed that renames its categories
    should not silently turn this into a red test about something else."""
    mark = f"{tag}-{uuid.uuid4().hex[:6]}"
    categories = hub.query("taxes.categories.list")
    tax_key = next((c["key"] for c in categories if c.get("key")), None)
    if not tax_key:
        raise AssertionError(f"`taxes` must seed at least one category: {categories}")

    customer_id = hub.new_id("customers.create", {"name": f"Cliente {mark}"})
    service_name = f"Peinado/Lavado {mark}"
    service_id = hub.new_id(
        "services.services.create",
        {
            "name": service_name,
            "tax_category_key": tax_key,
            "duration_minutes": duration_minutes,
            "is_bookable": 1,
        },
    )
    staff_last, other_last = f"Uno {mark}", f"Dos {mark}"
    staff_id = hub.new_id(
        "staff.members.create",
        {"first_name": "Pro", "last_name": staff_last, "is_bookable": 1},
    )
    other_staff_id = hub.new_id(
        "staff.members.create",
        {"first_name": "Pro", "last_name": other_last, "is_bookable": 1},
    )
    return Links(
        customer_id,
        service_id,
        staff_id,
        other_staff_id,
        service_name,
        f"Pro {staff_last}",
        f"Pro {other_last}",
    )


def book(hub: Hub, links: Links, staff_id: str, start: str, duration: int) -> str:
    """Books through the PUBLIC command — the same door the till uses. Returns the appointment id.

    Never through the `_insert_appointment` sub-command: those are internal (hub#131/#145) and
    seeding with them would skip the very handler whose rules this battery is about."""
    return hub.new_id(
        "appointments.appointments.create",
        {
            "customer_id": links.customer_id,
            "customer_name": "Cliente",
            "service_id": links.service_id,
            "service_name": links.service_name,
            # A DELIBERATELY WRONG name: `create` resolves the professional through its
            # `staff.members.get` read and freezes the catalogue's name, never the caller's
            # (appointments#11/#21 — the payload does not get to decide who was seen).
            "staff_id": staff_id,
            "staff_name": "no-lo-decide-el-payload",
            "start_datetime": start,
            "duration_minutes": duration,
        },
    )


# ── the calendar ─────────────────────────────────────────────────────────────────────────


def next_weekday(weekday: int = 2, at_least_days: int = 7) -> str:
    """`YYYY-MM-DD` of the next given weekday (0=Monday) at least `at_least_days` away.

    The engine crosses `:now` — the runtime's real clock — against `min_booking_notice` and
    `max_advance_booking`, so the day has to be comfortably inside the 90-day window and far from
    the notice edge. A WEEKDAY because the working-schedule section seeds Monday–Friday shifts."""
    day = datetime.date.today() + datetime.timedelta(days=at_least_days)
    while day.weekday() != weekday:
        day += datetime.timedelta(days=1)
    return day.isoformat()


def instant(day: str, hhmm: str) -> str:
    """`2026-09-09T12:00:00+00:00` — an appointment is an INSTANT with its offset, never a naive
    string. UTC on purpose: `availability.check` reads the hour off the bind and the runtime's
    Postgres session is UTC, so a battery written in local time would move with the machine.

    For anything about OPENING HOURS use `business_instant()` instead: the door reads the wall
    clock, not this one."""
    return f"{day}T{hhmm}:00+00:00"


def business_instant(hub: Hub, day: str, hhmm: str) -> str:
    """The same instant written on the BUSINESS's clock: `"12:00"` here is noon for whoever runs
    the salon, with the offset that zone really had on that date.

    `instant()` above is UTC because the availability QUERY reads the hour straight off the bind
    (`erp_extract('hour', …)` renders a `timestamptz` in the session's zone, and the runtime's is
    UTC). The DOOR does not: `schedule_refusal` converts the instant with `context.timezone`
    (hub#731) before crossing it against the hours `schedules` holds. So a section about opening
    hours has to speak WALL time or it is asserting about the offset of whoever ran it — on a hub
    in Madrid `08:00Z` is 10:00 in the shop, lands inside a 09:00–18:00 week, and the red turns
    green while proving the opposite of what it claims."""
    hour, minute = (int(part) for part in hhmm.split(":"))
    try:
        zone = zoneinfo.ZoneInfo(hub.timezone)
    except zoneinfo.ZoneInfoNotFoundError as err:
        raise AssertionError(
            f"the hub runs on {hub.timezone!r} and this machine has no such zone ({err}): the "
            "opening-hours section cannot be written on a clock it cannot read"
        ) from err
    return datetime.datetime.combine(
        datetime.date.fromisoformat(day), datetime.time(hour, minute), tzinfo=zone
    ).isoformat()
