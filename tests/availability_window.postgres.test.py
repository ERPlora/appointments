#!/usr/bin/env python3
"""`availability.slots` tacha la ventana del MISMO reloj en que ofrece los huecos (appointments#76).

Por qué existe este fichero. Los huecos candidatos se generan como texto NAIVE
(`2026-08-28T12:00:00`, hora de pared del salón, sin offset) mientras que las citas viven
guardadas CON offset (`2026-08-28T12:00:00+02:00`). La comparación bajaba ambos lados por
`erp_dt` — `::timestamptz` — con lo que el hueco naive se interpretaba en la zona horaria de la
SESIÓN del runtime (UTC): la ventana tachada quedaba desplazada exactamente el offset del hub.
Consecuencia doble y las dos malas: se ofrecen huecos que `create` rechaza un segundo después
(`overlap`) y se esconden huecos libres. Su hermano `availability.check`, que compara el
`:start_datetime` que trae offset contra las mismas filas, daba la respuesta CORRECTA en el mismo
instante — el motor se contradecía a sí mismo.

El contrato que fija (todo contra un Postgres real, con la sesión en UTC como el runtime):

  1. La cita tacha SU ventana de pared: 12:00+02:00 de 30 min quita 12:00 y 12:15, NO quita
     10:00 ni 10:15 (que es exactamente lo que hacía antes: 12:00 − offset).
  2. Equivalencia con `availability.check`: cada hueco que `slots` ofrece está `available=1`
     para `check` en ese instante, y el que esconde (12:00) está `available=0` con `overlap`.
  3. Un offset NEGATIVO (−05:00) desplaza la ventana igual de mal que uno positivo: la cita
     de las 15:00−05:00 tacha las 15:00 de pared, no las 20:00.
  4. Una cita que CRUZA MEDIANOCCHE tacha la mañana del día siguiente hasta donde llega:
     23:45+02:00 → 08:15+02:00 quita las 08:00 del día 28 y deja libres las 08:15.
  5. El tiempo bloqueado tacha en el mismo reloj que las citas (mismo primitivo).

Lo que este test NO fija, y ya no hace falta que fije: la ANTELACIÓN MÍNIMA contra `:now`. Cuando
se escribió esto no había forma sana de convertir la pared en instante porque la zona del NEGOCIO
no llegaba al SQL; con `:timezone` (hub#1022) sí, y appointments#88 la cerró — su contrato vive en
`availability_business_notice.postgres.test.py`. Del resto de #88 siguen abiertos el FORMATO en
reposo (normalizar a UTC `Z` con su migración) y el tope MÁXIMO, que cuenta días de calendario
sobre la fecha UTC de `:now`.

Uso: tests/availability_window.postgres.test.py   (exit 0 = verde)
  Usa el contenedor `erplora-test-pg-5433` (override: ERPLORA_TEST_PG_CONTAINER). Crea una BD de
  usar y tirar y la BORRA al final, pase o falte. Sin contenedor, se SALTA — nunca se da por buena.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
import uuid

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

SLOTS = "appointments.availability.slots"
CHECK = "appointments.availability.own_rules"
CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_availability_window_{uuid.uuid4().hex[:8]}"
HUB = "hub-under-test"
# The runtime's :now is UTC (registry.rs::now_rfc3339) and the Postgres session of the hub runs
# in UTC — both reproduced here, so the test cannot pass by accident of a shifted session.
NOW = "2026-08-26T09:00:00+00:00"
DAY = "2026-08-28"

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


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


def psql(stdin: str, args=None) -> str:
    cmd = [
        "docker",
        "exec",
        "-i",
        "-e",
        "PGOPTIONS=-c timezone=UTC",
        CONTAINER,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        DB,
        "-q",
        "-X",
    ]
    cmd += args or []
    res = subprocess.run(cmd, input=stdin, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(res.stderr.strip() or res.stdout.strip())
    return res.stdout


def literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def bind(sql: str, params: dict) -> str:
    return re.sub(
        r"(?<![:\w]):([a-z_][a-z0-9_]*)", lambda m: literal(params.get(m.group(1))), sql
    )


def _call_args(sql: str, open_paren: int) -> tuple[list[str], int]:
    depth, start, args = 0, open_paren + 1, []
    i = open_paren
    while i < len(sql):
        ch = sql[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                args.append(sql[start:i])
                return [a.strip() for a in args], i + 1
        elif ch == "," and depth == 1:
            args.append(sql[start:i])
            start = i + 1
        i += 1
    raise ValueError("unbalanced parentheses")


def shim(sql: str) -> str:
    """Funciones-puente (ADR-0007 §4a) — espejo de `hub/crates/db/src/lib.rs`."""
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
            f"(EXTRACT({a[0]} FROM ({a[1]})::timestamptz)::bigint)"
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


def run_query(name: str, params: dict) -> list[dict]:
    rel = MANIFEST["queries"][name]["sql"]
    body = shim(bind((MODULE_DIR / rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(f"SELECT row_to_json(r) FROM ({body}) r", ["-t", "-A"])
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def seed_settings() -> None:
    psql(
        "INSERT INTO appointments_settings (id, hub_id, default_duration, min_booking_notice, "
        "max_advance_booking, allow_overlapping, calendar_start_hour, calendar_end_hour, "
        "slot_interval, is_deleted, created_at) VALUES ('st-1', 'hub-under-test', 30, 0, 365, 0, "
        "8, 20, 15, 0, '2026-08-01T00:00:00+00:00')"
    )


def seed_appointment(
    apt_id: str, staff: str, start: str, end: str, minutes: int
) -> None:
    psql(
        "INSERT INTO appointments_appointment (id, hub_id, customer_name, staff_id, "
        "service_name, start_datetime, end_datetime, duration_minutes, status, is_deleted, "
        f"created_at) VALUES ({literal(apt_id)}, {literal(HUB)}, 'Client', {literal(staff)}, "
        f"'Cut', {literal(start)}, {literal(end)}, {minutes}, 'confirmed', 0, "
        "'2026-08-01T00:00:00+00:00')"
    )


def seed_blocked(block_id: str, staff: str, start: str, end: str) -> None:
    psql(
        "INSERT INTO appointments_blocked_time (id, hub_id, title, block_type, start_datetime, "
        "end_datetime, all_day, staff_id, is_deleted, created_at) VALUES "
        f"({literal(block_id)}, {literal(HUB)}, 'Lunch', 'break', {literal(start)}, "
        f"{literal(end)}, 0, {literal(staff)}, 0, '2026-08-01T00:00:00+00:00')"
    )


def slots_of(staff: str, date: str = DAY, duration: int = 30) -> list[str]:
    rows = run_query(
        SLOTS,
        {
            "date": date,
            "staff_id": staff,
            "duration_minutes": duration,
            "hub_id": HUB,
            "now": NOW,
            # El runtime bindea SIEMPRE la zona del negocio (hub#1022); estas filas son de
            # un salón de Madrid, así que aquí también (appointments#88).
            "timezone": "Europe/Madrid",
        },
    )
    return [r["start_time"] for r in rows]


def check_at(staff: str, start: str, duration: int = 30) -> dict:
    rows = run_query(
        CHECK,
        {
            "start_datetime": start,
            "staff_id": staff,
            "duration_minutes": duration,
            "exclude_appointment_id": None,
            "exclude_hold_ref": None,
            "hub_id": HUB,
            "now": NOW,
            # El runtime bindea SIEMPRE la zona del negocio (hub#1022); estas filas son de
            # un salón de Madrid, así que aquí también (appointments#88).
            "timezone": "Europe/Madrid",
        },
    )
    return rows[0] if rows else {"available": None, "reason": "no-row"}


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
            psql((MODULE_DIR / rel).read_text())
        seed_settings()

        # ── 1+2 · the issue's exact repro: one 12:00+02:00 appointment of 30 min ─────────────
        seed_appointment(
            "apt-a", "s1", "2026-08-28T12:00:00+02:00", "2026-08-28T12:30:00+02:00", 30
        )
        offered = slots_of("s1")
        for gone in ("12:00", "12:15"):
            if gone in offered:
                fail(
                    f"the 12:00+02:00 appointment is booked and slots STILL offers {gone} (wall)"
                )
        for free in ("10:00", "10:15", "13:00"):
            if free not in offered:
                fail(
                    f"{free} is free wall time and slots hides it (window shifted by the offset)"
                )

        # Equivalence with the authoritative engine, slot by slot: every hueco offered must be
        # available for check() at the same instant, and the hidden 12:00 must be an overlap.
        for start_time in offered:
            start_dt = f"{DAY}T{start_time}:00+02:00"
            verdict = check_at("s1", start_dt)
            if verdict.get("available") != 1:
                fail(
                    f"slots offers {start_time} but check says {verdict} for {start_dt}"
                )
        hidden = check_at("s1", f"{DAY}T12:00:00+02:00")
        if hidden.get("available") != 0 or hidden.get("reason") != "overlap":
            fail(
                f"the booked 12:00 must be available=0/overlap for check, got {hidden}"
            )

        # ── 3 · negative offset: the same shift, the other sign ─────────────────────────────
        seed_appointment(
            "apt-b", "s2", "2026-08-28T15:00:00-05:00", "2026-08-28T15:30:00-05:00", 30
        )
        offered_b = slots_of("s2")
        for gone in ("15:00", "15:15"):
            if gone in offered_b:
                fail(
                    f"the 15:00-05:00 appointment is booked and slots STILL offers {gone} (wall)"
                )
        for free in ("17:00", "09:00"):
            if free not in offered_b:
                fail(
                    f"{free} is free wall time and slots hides it (negative-offset shift)"
                )
        hidden_b = check_at("s2", f"{DAY}T15:00:00-05:00")
        if hidden_b.get("available") != 0 or hidden_b.get("reason") != "overlap":
            fail(
                f"the booked 15:00-05:00 must be available=0/overlap for check, got {hidden_b}"
            )

        # ── 4 · crossing midnight: the tail of an overnight appointment taches the next morning
        seed_appointment(
            "apt-c", "s3", "2026-08-27T23:45:00+02:00", "2026-08-28T08:15:00+02:00", 510
        )
        offered_c = slots_of("s3")
        if "08:00" in offered_c:
            fail(
                "the overnight appointment reaches 08:15 wall and slots still offers 08:00"
            )
        if "08:15" not in offered_c:
            fail(
                "08:15 wall is past the overnight appointment's end and slots hides it"
            )

        # ── 5 · blocked time taches on the SAME clock as the appointments ────────────────────
        seed_blocked(
            "blk-1", "s4", "2026-08-28T12:00:00+02:00", "2026-08-28T13:00:00+02:00"
        )
        offered_d = slots_of("s4")
        for gone in ("12:00", "12:15", "12:30"):
            if gone in offered_d:
                fail(f"12:00-13:00 wall is blocked and slots STILL offers {gone}")
        for free in ("11:30", "13:00"):
            if free not in offered_d:
                fail(f"{free} is outside the blocked window and slots hides it")

        if failures:
            print(f"FAIL ({len(failures)}):")
            for f in failures:
                print(f"  - {f}")
            return 1
        print(
            "OK: availability.slots taches the wall window of every live row and agrees "
            "with availability.check slot by slot"
        )
        return 0
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", DB]
        )


if __name__ == "__main__":
    sys.exit(main())
