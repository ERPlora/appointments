#!/usr/bin/env python3
"""`availability.slots` mide la ANTELACIÓN MÍNIMA en el reloj del NEGOCIO (appointments#88).

Por qué existe este fichero. Los huecos candidatos se generan como texto NAIVE (hora de pared del
salón, `2026-08-28T12:00:00`) y la comprobación de `min_booking_notice` los bajaba por `erp_dt`
—`::timestamptz`—, que interpreta un naive en la zona de la SESIÓN del runtime (UTC). En un hub de
`Europe/Madrid` eso corre la antelación mínima el offset entero: `slots` ofrece huecos que ya han
pasado o que no llegan al aviso mínimo, y `availability.check` —que compara el `:start_datetime`
con su offset contra el mismo `:now`— dice `too_soon` para ESE MISMO hueco en el mismo instante.
El motor se contradecía a sí mismo, y `create` rechaza un segundo después lo que la pantalla acaba
de ofrecer. Es el resto que `availability_window.postgres.test.py` documentó y no pudo cerrar:
entonces la zona del negocio no llegaba al SQL; hoy sí (`:timezone`, hub#1022 · dispatch.rs).

El contrato que fija (contra un Postgres real, con la sesión en UTC como el runtime):

  1. Con el salón en Madrid (+02:00), `now` = 11:00 de pared y 60 min de antelación mínima, el
     PRIMER hueco ofrecido es el de las 12:00 de pared. Ni 10:00 (que ya pasó) ni 11:45.
  2. El borde es INCLUSIVO: exactamente 60 minutos por delante vale, igual que en el handler.
  3. Equivalencia con `availability.check`, hueco por hueco: lo que `slots` ofrece está
     `available=1`, y el hueco anterior al primero está `available=0` con `too_soon`.
  4. Un offset NEGATIVO (`America/New_York`, −04:00) se desplaza igual de mal en el otro sentido:
     ahí el bug ESCONDÍA huecos legítimos en vez de ofrecer huecos pasados.

Uso: tests/availability_business_notice.postgres.test.py   (exit 0 = verde)
  Usa el contenedor `erplora-test-pg-5433` (override: ERPLORA_TEST_PG_CONTAINER). Crea una BD de
  usar y tirar y la BORRA al final, pase o falle. Sin contenedor, se SALTA — nunca se da por buena.
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
DB = f"appointments_business_notice_{uuid.uuid4().hex[:8]}"
HUB = "hub-under-test"
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
        # The runtime's Postgres session runs in UTC. Reproduced here so the test cannot pass by
        # the accident of a session that happens to sit on the business zone.
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


def seed_settings(notice_min: int) -> None:
    psql("DELETE FROM appointments_settings WHERE hub_id = " + literal(HUB))
    psql(
        "INSERT INTO appointments_settings (id, hub_id, default_duration, min_booking_notice, "
        "max_advance_booking, allow_overlapping, calendar_start_hour, calendar_end_hour, "
        f"slot_interval, is_deleted, created_at) VALUES ('st-1', {literal(HUB)}, 30, {notice_min}, "
        "0, 0, 8, 20, 15, 0, '2026-08-01T00:00:00+00:00')"
    )


def slots_of(now: str, timezone: str, date: str = DAY) -> list[str]:
    rows = run_query(
        SLOTS,
        {
            "date": date,
            "staff_id": "s1",
            "duration_minutes": 30,
            "exclude_hold_ref": None,
            "hub_id": HUB,
            "now": now,
            "timezone": timezone,
        },
    )
    return [r["start_time"] for r in rows]


def check_at(now: str, timezone: str, start: str) -> dict:
    rows = run_query(
        CHECK,
        {
            "start_datetime": start,
            "staff_id": "s1",
            "duration_minutes": 30,
            "exclude_appointment_id": None,
            "exclude_hold_ref": None,
            "hub_id": HUB,
            "now": now,
            "timezone": timezone,
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

        # ── 1+2 · Madrid (+02:00): now = 11:00 de pared, 60 min de antelación ────────────────
        seed_settings(60)
        madrid_now = "2026-08-28T09:00:00+00:00"  # 11:00 en Madrid
        offered = slots_of(madrid_now, "Europe/Madrid")
        for gone in ("08:00", "10:00", "11:00", "11:45"):
            if gone in offered:
                fail(
                    f"slots ofrece {gone} de pared: con now=11:00 y 60 min de aviso ese hueco ya "
                    "pasó o no llega al mínimo (la antelación se midió en el reloj de la sesión)"
                )
        if offered[:1] != ["12:00"]:
            fail(
                f"el primer hueco debe ser el de las 12:00 de pared (borde inclusivo), no {offered[:1]}"
            )

        # ── 3 · equivalencia con el motor autoritativo, hueco por hueco ──────────────────────
        for start_time in offered[:6]:
            verdict = check_at(
                madrid_now, "Europe/Madrid", f"{DAY}T{start_time}:00+02:00"
            )
            if verdict.get("available") != 1:
                fail(f"slots ofrece {start_time} pero check dice {verdict}")
        too_soon = check_at(madrid_now, "Europe/Madrid", f"{DAY}T11:45:00+02:00")
        if too_soon.get("available") != 0 or too_soon.get("reason") != "too_soon":
            fail(
                f"11:45 de pared tiene que ser too_soon para check, y salió {too_soon}"
            )

        # ── 4 · offset NEGATIVO: el mismo error, escondiendo huecos legítimos ────────────────
        # New York = −04:00 en agosto. now = 09:00 de pared (13:00Z). Con 60 min, el primer hueco
        # es el de las 10:00 de pared. El bug lo empujaba cuatro horas: pedía 17:00 o más.
        ny_now = "2026-08-28T13:00:00+00:00"
        offered_ny = slots_of(ny_now, "America/New_York")
        if offered_ny[:1] != ["10:00"]:
            fail(
                "con el salón en New York el primer hueco es el de las 10:00 de pared, "
                f"y salió {offered_ny[:1]} (ventana desplazada por el offset negativo)"
            )
        for free in ("10:00", "11:00", "16:00"):
            if free not in offered_ny:
                fail(
                    f"{free} de pared cumple la antelación en New York y slots lo esconde"
                )

        # ── 5 · sin antelación mínima el corte es AHORA, y también en el reloj del salón ─────
        # Con `min_booking_notice = 0` lo que queda es «no reserves en el pasado»: con now = 11:00
        # de pared, el primer hueco es el de las 11:00 y el de las 10:45 ya no está a la venta.
        seed_settings(0)
        wide = slots_of(madrid_now, "Europe/Madrid")
        if wide[:1] != ["11:00"]:
            fail(
                f"sin antelación mínima el primer hueco es el de las 11:00 de pared, no {wide[:1]}"
            )
        if "10:45" in wide:
            fail(
                "10:45 de pared ya pasó: sin antelación mínima sigue sin poder reservarse"
            )

        if failures:
            print(f"FAIL ({len(failures)}):")
            for f in failures:
                print(f"  - {f}")
            return 1
        print(
            "OK: availability.slots mide la antelación mínima en el reloj del NEGOCIO y coincide "
            "con availability.check hueco por hueco"
        )
        return 0
    finally:
        subprocess.run(
            ["docker", "exec", CONTAINER, "dropdb", "-U", "postgres", "--force", DB]
        )


if __name__ == "__main__":
    sys.exit(main())
