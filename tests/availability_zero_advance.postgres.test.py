#!/usr/bin/env python3
"""«Antelación máxima = 0» debe significar SIN LÍMITE también al LEER (appointments#78).

El doc del módulo y el handler están de acuerdo: `max_advance_booking = 0` desactiva el tope —
`lead_time_refusal` (handler/src/lib.rs) solo aplica el máximo `if max_days > 0`, con el docstring
«a zero must never mean "nothing can be booked"». Por eso `create` reserva sin problema.

Pero las dos queries de disponibilidad hacían `COALESCE(MAX(max_advance_booking), 90) AS
advance_days` y comparaban SIN caso 0, así que un hub que guarda 0 —que es exactamente lo que
guardará quien no quiera límite— se quedaba con la agenda a cero:

  · `appointments.availability.slots`  → 0 huecos, cualquier día (`erp_date(:date) <= now+0d`
    solo deja HOY, y hoy ya lo cierra la antelación mínima);
  · `appointments.availability.check`  → `too_far` para cualquier instante futuro;

mientras `create` SÍ reservaba ese mismo instante. La pantalla consulta `check` antes de crear y
aborta con su mensaje, así que el mostrador se quedaba sin poder reservar por la pantalla con la
explicación menos útil posible.

Esta batería EJECUTA las dos queries contra un Postgres real (migraciones del propio módulo, shim
de las funciones-puente como el runtime) con la fila de ajustes sembrada por escenario:

  1. `max_advance_booking = 0` → `slots` de mañana devuelve huecos y `check` de mañana está
     disponible (HOY falla: slots vacío y `too_far`).
  2. `max_advance_booking = 30` → +40 días sigue siendo `too_far` en `check` y sin huecos en
     `slots`: arreglar el 0 no puede aflojar el límite real.
  3. Coherencia con `create` (el mismo veredicto que `lead_time_refusal`): parametrizado con
     `max_advance_booking` ∈ {0, 1, 30} × `min_booking_notice` ∈ {0, 60}. Mañana a las 11:00 está
     disponible en todas las combinaciones; a +100 días solo con tope 0. La antelación mínima
     con la misma lupa: 0 = sin tope, 60 minutes rechaza un hueco 30 minutos adelante.
  4. El borde es inclusivo (igual que el handler): con tope 30, un inicio EXACTAMENTE a +30 días
     no es `too_far`.

Usage: tests/availability_zero_advance.postgres.test.py   (exit 0 = green)
  Uses the `erplora-test-pg-5433` container by default (override: ERPLORA_TEST_PG_CONTAINER).
  Creates a scratch database and DROPS it at the end, pass or fail. If Docker or the container is
  missing the check is SKIPPED, never passed.
"""

import json
import os
import pathlib
import re
import subprocess
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_zero_advance_test_{os.getpid()}"
HUB = "hub-under-test"

QUERIES = {
    "appointments.availability.slots": "queries/availability_slots.sql",
    "appointments.availability.check": "queries/availability_check.sql",
}

# The fixed `now` the runtime would inject. 2026-09-01 is a Tuesday: tomorrow 11:00 is ~26 h
# ahead, comfortably past a 60-minute notice and inside the default 8–20 calendar.
NOW = "2026-09-01T09:00:00+02:00"
# The business zone the runtime binds as `:timezone` (hub#1022). `NOW` is a Madrid instant, so the
# salon is in Madrid: since appointments#88 the minimum notice is measured on THIS clock, and a
# fixture that leaves the bind out would be measuring on the session's (UTC).
TZ = "Europe/Madrid"
TOMORROW = "2026-09-02"
PLUS_100_DAYS = "2026-12-10"  # +100 days, same wall clock

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Postgres plumbing (same dialect as the sibling batteries) ────────────────────────────


def docker_available() -> bool:
    try:
        res = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER],
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return False
    return res.returncode == 0 and res.stdout.strip() == "true"


def psql(args: list[str], db: str | None = None, stdin: str | None = None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
    ]
    if db:
        cmd += ["-d", db]
    cmd += args
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def _call_args(sql: str, start: int) -> tuple[list[str], int]:
    """Splits the arguments of a call whose `(` is at `start`, honouring nesting and quotes."""
    depth, args, buf, i, quoted = 0, [], "", start, False
    while i < len(sql):
        c = sql[i]
        if quoted:
            buf += c
            if c == "'":
                quoted = False
        elif c == "'":
            quoted = True
            buf += c
        elif c == "(":
            depth += 1
            if depth > 1:
                buf += c
        elif c == ")":
            depth -= 1
            if depth == 0:
                args.append(buf)
                return args, i + 1
            buf += c
        elif c == "," and depth == 1:
            args.append(buf)
            buf = ""
        else:
            buf += c
        i += 1
    raise ValueError("unbalanced call")


def shim(sql: str) -> str:
    """Bridge functions (ADR-0007 §4a) — the subset these two queries use, lowered like the
    runtime does (`hub/crates/db/src/lib.rs::render_bridge_fn`)."""
    forms = {
        "erp_dt": lambda a: f"(({a[0]})::timestamptz)",
        "erp_date": lambda a: f"(({a[0]})::date)",
        "erp_dateadd": lambda a: (
            f"(({a[0]})::timestamptz + (({a[1]}) || ' ' || {a[2]})::interval)"
        ),
        "erp_dow_mon0": lambda a: (
            f"((EXTRACT(ISODOW FROM ({a[0]})::timestamptz)::int) - 1)"
        ),
        "erp_extract": lambda a: (
            f"(EXTRACT({a[0].strip().strip(chr(39)).lower()} FROM ({a[1]})::timestamptz)::bigint)"
        ),
        "erp_timefmt": lambda a: (
            f"(lpad(({a[0]})::text, 2, '0') || ':' || lpad(({a[1]})::text, 2, '0'))"
        ),
    }
    for name, render in forms.items():
        while True:
            m = re.search(rf"\b{name}\(", sql)
            if not m:
                break
            args, end = _call_args(sql, m.end() - 1)
            sql = sql[: m.start()] + render(args) + sql[end:]
    return sql


def rows(sql: str) -> list[dict]:
    # The .sql files end in `;`; embedded in the row_to_json subquery it would split the statement.
    inner = sql.strip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({inner}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def seed_settings(max_advance: int, notice: int) -> None:
    """One settings row per scenario: the columns the availability engine reads."""
    psql(
        [],
        db=DB,
        stdin=(
            "DELETE FROM appointments_settings;\n"
            "INSERT INTO appointments_settings (id, hub_id, default_duration, min_booking_notice,"
            " max_advance_booking, allow_overlapping, calendar_start_hour, calendar_end_hour,"
            " slot_interval, created_at)"
            f" VALUES ('st-1', '{HUB}', 30, {notice}, {max_advance}, 0, 8, 20, 15,"
            " '2026-09-01T00:00:00+02:00');\n"
        ),
    )


def slots(date: str) -> list[dict]:
    params = {
        "hub_id": HUB,
        "now": NOW,
        "date": date,
        "duration_minutes": 30,
        # El runtime bindea SIEMPRE la zona del negocio (hub#1022, appointments#88).
        "timezone": TZ,
    }
    sql = shim(
        bind(
            (MODULE_DIR / QUERIES["appointments.availability.slots"]).read_text(),
            params,
        )
    )
    return rows(sql)


def check(start: str) -> dict:
    params = {
        "hub_id": HUB,
        "now": NOW,
        "start_datetime": start,
        "duration_minutes": 30,
        "timezone": TZ,
    }
    sql = shim(
        bind(
            (MODULE_DIR / QUERIES["appointments.availability.check"]).read_text(),
            params,
        )
    )
    got = rows(sql)
    return got[0] if got else {"available": None, "reason": "no row"}


# ── The scenarios ────────────────────────────────────────────────────────────────────────


def scenario_disabled_cap_opens_the_agenda() -> None:
    """`0` = sin límite: mañana vuelve a tener huecos y a estar disponible."""
    seed_settings(0, 0)
    free = slots(TOMORROW)
    if not free:
        fail(
            "max_advance_booking=0: slots of tomorrow returns NO slots — «0» must mean no cap"
        )
    verdict = check(f"{TOMORROW}T11:00:00+02:00")
    if verdict.get("available") != 1:
        fail(
            "max_advance_booking=0: check of tomorrow 11:00 says "
            f"{verdict.get('reason') or verdict!r} — «0» must mean no cap"
        )


def scenario_real_cap_still_refuses_far_future() -> None:
    """Arreglar el 0 no puede aflojar el límite real: +40 días sigue demasiado lejos."""
    seed_settings(30, 0)
    verdict = check(f"2026-10-11T11:00:00+02:00")
    if verdict.get("reason") != "too_far":
        fail(
            "max_advance_booking=30: check of +40 days must stay too_far, got "
            f"{verdict!r}"
        )
    if slots("2026-10-11"):
        fail("max_advance_booking=30: slots of +40 days must stay empty")


def scenario_coherence_with_create() -> None:
    """La lectura y la escritura leen el MISMO ajuste con el MISMO significado.

    `create` (`lead_time_refusal`) acepta mañana en todas las combinaciones y solo rechaza por
    antelación máxima cuando el tope es > 0 y el instante se pasa. `check` debe emparejar.
    """
    for max_advance in (0, 1, 30):
        for notice in (0, 60):
            seed_settings(max_advance, notice)
            where = f"max_advance={max_advance}, notice={notice}"

            tomorrow = check(f"{TOMORROW}T11:00:00+02:00")
            if tomorrow.get("available") != 1:
                fail(
                    f"{where}: tomorrow 11:00 must be available (~26 h ahead, inside every cap),"
                    f" got {tomorrow!r}"
                )

            far = check(f"{PLUS_100_DAYS}T11:00:00+02:00")
            if max_advance == 0:
                if far.get("available") != 1:
                    fail(
                        f"{where}: +100 days must be available with the cap disabled, got {far!r}"
                    )
            elif far.get("reason") != "too_far":
                fail(f"{where}: +100 days must be too_far with a real cap, got {far!r}")

            soon = check("2026-09-01T09:30:00+02:00")  # 30 minutes ahead
            if notice == 0:
                if soon.get("available") != 1:
                    fail(
                        f"{where}: 30 minutes ahead must be fine with no notice, got {soon!r}"
                    )
            elif soon.get("reason") != "too_soon":
                fail(
                    f"{where}: 30 minutes ahead must be too_soon with a 60-minute notice, got {soon!r}"
                )


def scenario_boundary_is_inclusive() -> None:
    """Con tope 30, EXACTAMENTE +30 días está dentro — igual que el handler («60 minutes' notice
    means 60 is enough»)."""
    seed_settings(30, 0)
    verdict = check("2026-10-01T09:00:00+02:00")
    if verdict.get("reason") == "too_far":
        fail(
            "max_advance_booking=30: exactly +30 days is ON the boundary, not beyond it"
        )
    if not slots("2026-10-01"):
        fail("max_advance_booking=30: the boundary day +30 must still offer slots")


def main() -> int:
    if not docker_available():
        print(f"SKIPPED: no Postgres in container {CONTAINER} (nothing was verified)")
        return 0

    subprocess.run(
        ["docker", "exec", CONTAINER, "createdb", "-U", "postgres", DB], check=True
    )
    try:
        for entry in MANIFEST["migrations"]["postgres"]:
            rel = entry if isinstance(entry, str) else entry["file"]
            r = psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())
            if r is None:
                pass
        scenario_disabled_cap_opens_the_agenda()
        scenario_real_cap_still_refuses_far_future()
        scenario_coherence_with_create()
        scenario_boundary_is_inclusive()
    except RuntimeError as e:
        print(f"FAIL: Postgres error\n{e}")
        return 1
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", DB]
        )

    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(
        "OK: a zero max-advance cap opens the agenda in slots and check, and the real caps hold"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
