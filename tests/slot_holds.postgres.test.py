#!/usr/bin/env python3
"""`appointments_slot_hold` — la retención que cierra la ventana de conflicto (appointments#69).

Por qué existe este fichero. `cargo test` cubre la mitad que decide con las filas ya cargadas: que
una franja retenida rechaza con `appointments.slot_on_hold`, que la retención de otra profesional
no bloquea, que los bordes que se tocan no solapan y que la petición dueña de la retención sí puede
reservar. Lo que `cargo test` NO puede ver es si el SQL devuelve esas filas — y una read que
devuelve vacío es una guarda que nunca dispara con los tests de Rust en verde de punta a punta: la
trampa exacta de «tests que no prueban nada» (appointments#16).

Y hay una segunda mitad que solo existe aquí: **la caducidad**. Toda la decisión de mercado se
apoya en que la retención se suelte SOLA. Los foros están llenos de la variante rota — WooCommerce
libera el stock desde un cron programado al mismo intervalo que la retención (liberación real entre
T+x y T+2x, y nunca si el cron muere), y Zoho Bookings deja huecos bloqueados «hasta que alguien
borre la cita a mano». Por eso aquí se comprueba lo que de verdad libera el hueco: **la lectura**,
que exige `expires_at > :now` y por tanto deja de contar en el instante exacto, sin depender de que
la tarea programada haya corrido.

El contrato que fija:

  1. MANIFEST. Las dos queries existen, están bajo `appointments.view_schedule` y no son `list`;
     `create` y `reschedule` las declaran como read `required` (una guarda cuya entrada puede
     faltar es una guarda que se abre) y `_book_from_request` NO (dentro de un listener, una read
     `required` que no resuelve es una fila de dead-letter que no lee nadie).
     La tarea programada existe y apunta a `appointments.slots.expire_holds`.

  2. POSTGRES REAL, sobre una BD de usar y tirar construida con las migraciones del módulo:
     - `slots.hold` aparta el hueco y el TTL lo pone el SERVIDOR desde `hold_minutes` (el payload
       no puede proponerlo);
     - reelegir hora MUEVE la misma retención en vez de apilar una segunda (idempotencia por
       `(hub_id, source, source_ref)`);
     - la read ve la retención viva y NO ve la caducada — sin haber corrido ninguna barrida;
     - `hold_minutes = 0` apaga la retención entera;
     - `expire_holds` marca `expired` (contabilidad) y `release_hold` marca `released`, que son
       cosas distintas a propósito;
     - `_hold_consume` cierra la que acabó siendo cita, y NO puede degradar a `released` una ya
       consumida;
     - la retención de OTRO HUB no se ve jamás.

Uso: tests/slot_holds.postgres.test.py   (exit 0 = verde)
  Usa el contenedor `erplora-test-pg-5433` (override: ERPLORA_TEST_PG_CONTAINER). Crea una BD de
  usar y tirar y la BORRA al final, pase o falle. Sin contenedor, la capa Postgres se SALTA —
  nunca se da por pasada.
"""

import json
import os
import pathlib
import re
import subprocess
import sys
from datetime import datetime

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())

LIVE = "appointments.slot_holds.live"
AHEAD = "appointments.slot_holds.upcoming"
PERMISSION = "appointments.view_schedule"
HOLD = "appointments.slots.hold"
RELEASE = "appointments.slots.release_hold"
EXPIRE = "appointments.slots.expire_holds"
CONSUME = "appointments._hold_consume"

CONTAINER = os.environ.get("ERPLORA_TEST_PG_CONTAINER", "erplora-test-pg-5433")
DB = f"appointments_slot_hold_test_{os.getpid()}"
HUB = "hub-under-test"
OTHER_HUB = "hub-neighbour"

NOW = "2026-08-20T09:00:00+02:00"
SLOT_START = "2026-08-20T11:00:00+02:00"
SLOT_END = "2026-08-20T11:30:00+02:00"

failures: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


# ── Capa 1: cableado del manifest ─────────────────────────────────────────────────────────


def check_manifest() -> None:
    queries = MANIFEST.get("queries", {})
    for name in (LIVE, AHEAD):
        q = queries.get(name)
        if not isinstance(q, dict):
            fail(f"{name}: no declarada en module.json")
            continue
        if q.get("permission") != PERMISSION:
            fail(
                f"{name}.permission es {q.get('permission')!r}, esperaba {PERMISSION!r}"
            )
        if "list" in q:
            fail(f"{name}: query plana — el handler quiere las filas, no una página")
        rel = q.get("sql")
        if not rel or not (MODULE_DIR / rel).exists():
            fail(f"{name}.sql: {rel!r} no está en el paquete")

    commands = MANIFEST.get("commands", {})

    # Las tres puertas que escriben una cita tienen que MIRAR las retenciones.
    for cmd, query, required in (
        ("appointments.appointments.create", LIVE, True),
        ("appointments.appointments.reschedule", LIVE, True),
        ("appointments.appointments.bulk_create", AHEAD, True),
        ("appointments.recurring.materialize", AHEAD, True),
        ("appointments._book_from_request", LIVE, False),
    ):
        reads = commands.get(cmd, {}).get("reads", [])
        read = next((r for r in reads if r.get("query") == query), None)
        if read is None:
            fail(
                f"{cmd}.reads: falta {query!r} — la guarda de retención no correría nunca"
            )
            continue
        if required and read.get("required") is not True:
            fail(
                f"{cmd}.reads[{query}]: tiene que ser `required` — una guarda cuya entrada "
                "puede faltar es una guarda que se abre"
            )
        if not required and read.get("required") is True:
            fail(
                f"{cmd}.reads[{query}]: NO puede ser `required` — dentro de un listener, una "
                "read obligatoria que no resuelve aborta el command y la fila acaba en el "
                "dead-letter, que es donde no la lee nadie (appointments#38)"
            )

    for cmd in (HOLD, RELEASE, EXPIRE, CONSUME):
        c = commands.get(cmd)
        if not isinstance(c, dict):
            fail(f"{cmd}: no declarado en module.json")
            continue
        if c.get("transaction") is not True and cmd != CONSUME:
            fail(
                f"{cmd}: sin `transaction` — apartar y pintar tienen que ir juntos o nada"
            )
        for rel in c.get("sql", []):
            if not (MODULE_DIR / rel).exists():
                fail(f"{cmd}.sql: {rel!r} no está en el paquete")

    # El payload NO puede proponer su propia caducidad (regla del `Lease` de Google llevada al
    # extremo barato: allí el servidor puede acortarla; aquí ni se pregunta).
    schema_rel = commands.get(HOLD, {}).get("schema")
    if schema_rel and (MODULE_DIR / schema_rel).exists():
        schema = json.loads((MODULE_DIR / schema_rel).read_text())
        props = schema.get("properties", {})
        for forbidden in ("expires_at", "hold_minutes", "ttl", "expires_in"):
            if forbidden in props:
                fail(
                    f"{HOLD}.schema: acepta {forbidden!r} — un caller que elige su propia "
                    "caducidad puede apartar una agenda entera durante un mes"
                )
        if schema.get("additionalProperties") is not False:
            fail(f"{HOLD}.schema: additionalProperties tiene que ser false")

    tasks = MANIFEST.get("scheduled_tasks") or []
    sweep = next((t for t in tasks if t.get("command") == EXPIRE), None)
    if sweep is None:
        fail(
            "scheduled_tasks: nadie llama a "
            f"{EXPIRE} — sin barrida, la tabla acumula filas `held` muertas"
        )
    elif not sweep.get("cron"):
        fail(f"scheduled_tasks[{sweep.get('name')!r}]: sin `cron`")

    # La migración tiene que estar declarada, o la tabla no existe en ningún hub.
    migs = MANIFEST.get("migrations", {}).get("postgres", [])
    if not any("slot_hold" in m for m in migs):
        fail("migrations.postgres: falta la migración de `appointments_slot_hold`")


# ── Capa 2: Postgres real ─────────────────────────────────────────────────────────────────


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
    raise ValueError("paréntesis sin cerrar")


def shim(sql: str) -> str:
    """Funciones-puente (ADR-0007 §4a) — espejo de `hub/crates/db/src/lib.rs`."""
    forms = {
        "erp_dt": lambda a: f"(({a[0]})::timestamptz)",
        "erp_date": lambda a: f"(({a[0]})::date)",
        "erp_dateadd": lambda a: (
            f"(({a[0]})::timestamptz + (({a[1]}) || ' ' || {a[2]})::interval)"
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


def run_sql_file(rel: str, params: dict) -> None:
    psql([], db=DB, stdin=shim(bind((MODULE_DIR / rel).read_text(), params)))


def run_query(rel: str, params: dict) -> list[dict]:
    body = shim(bind((MODULE_DIR / rel).read_text(), params)).rstrip().rstrip(";")
    out = psql(["-t", "-A", "-c", f"SELECT row_to_json(r) FROM ({body}) r"], db=DB)
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def sql_of(command: str, index: int = 0) -> str:
    return MANIFEST["commands"][command]["sql"][index]


def query_sql(name: str) -> str:
    return MANIFEST["queries"][name]["sql"]


def holds() -> list[dict]:
    out = psql(
        [
            "-t",
            "-A",
            "-c",
            "SELECT row_to_json(r) FROM (SELECT source_ref, status, start_datetime, "
            "expires_at, hub_id FROM appointments_slot_hold ORDER BY source_ref) r",
        ],
        db=DB,
    )
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def instant_is(written: str, expected_iso: str) -> bool:
    """Compara INSTANTES, no cadenas: la columna es TEXT (contrato de fila) y el valor lo escribe
    Postgres, que serializa un `timestamptz` en su propio formato (`2026-08-20 07:15:00+00`).
    Comparar el texto compararía el huso del servidor, no la hora."""
    return datetime.fromisoformat(written) == datetime.fromisoformat(expected_iso)


def settings_row(hold_minutes: int) -> None:
    psql(
        [
            "-c",
            "INSERT INTO appointments_settings (id, hub_id, hold_minutes, is_deleted, created_at) "
            f"VALUES ('st-1', {literal(HUB)}, {hold_minutes}, 0, '2026-08-01T00:00:00+02:00') "
            "ON CONFLICT (hub_id) DO UPDATE SET hold_minutes = EXCLUDED.hold_minutes",
        ],
        db=DB,
    )


def take_hold(
    source_ref: str, start: str, end: str, staff: str = "s1", hub: str = HUB
) -> None:
    run_sql_file(
        sql_of(HOLD),
        {
            "new_id": f"h-{source_ref}",
            "hub_id": hub,
            "staff_id": staff,
            "source": "whatsapp_inbox",
            "source_ref": source_ref,
            "start_datetime": start,
            "end_datetime": end,
            "label": "Ana",
            "current_user_id": "u-1",
            "now": NOW,
        },
    )


def check_against_postgres() -> None:
    if failures:
        return
    if not docker_available():
        notes.append(
            f"SKIPPED capa Postgres: el contenedor {CONTAINER!r} no está corriendo"
        )
        return

    psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
    psql(["-c", f'CREATE DATABASE "{DB}"'])
    try:
        for entry in MANIFEST.get("migrations", {}).get("postgres", []):
            rel = entry if isinstance(entry, str) else entry["file"]
            psql([], db=DB, stdin=(MODULE_DIR / rel).read_text())

        # ── El TTL lo pone el SERVIDOR ───────────────────────────────────────────────────
        settings_row(15)
        take_hold("req-1", SLOT_START, SLOT_END)
        rows = holds()
        if len(rows) != 1:
            fail(f"hold: esperaba 1 retención, hay {len(rows)}")
        elif not instant_is(rows[0]["expires_at"], "2026-08-20T09:15:00+02:00"):
            fail(
                "hold.expires_at = "
                f"{rows[0]['expires_at']!r}: el TTL sale de settings.hold_minutes (15) sobre "
                ":now, no del payload"
            )

        # Reelegir hora MUEVE la misma retención: la clave natural es (hub, source, source_ref).
        take_hold("req-1", "2026-08-20T12:00:00+02:00", "2026-08-20T12:30:00+02:00")
        rows = holds()
        if len(rows) != 1:
            fail(
                f"hold: reelegir hora apiló {len(rows)} retenciones — el hueco anterior se "
                "quedaría apartado sin dueño (la «retención fantasma» de los foros)"
            )
        elif rows[0]["start_datetime"] != "2026-08-20T12:00:00+02:00":
            fail("hold: el UPSERT no movió la franja")

        # Vuelve a su sitio para el resto de la prueba.
        take_hold("req-1", SLOT_START, SLOT_END)

        # ── La READ es la que libera el hueco, no la barrida ─────────────────────────────
        live = run_query(
            query_sql(LIVE),
            {"hub_id": HUB, "staff_id": "s1", "start_datetime": SLOT_START, "now": NOW},
        )
        if len(live) != 1 or live[0]["source_ref"] != "req-1":
            fail(
                f"{LIVE}: no ve la retención viva → la guarda nunca dispararía. Devolvió {live!r}"
            )

        # El MISMO estado de la BD, un minuto DESPUÉS de caducar y SIN haber corrido la barrida.
        after = run_query(
            query_sql(LIVE),
            {
                "hub_id": HUB,
                "staff_id": "s1",
                "start_datetime": SLOT_START,
                "now": "2026-08-20T09:16:00+02:00",
            },
        )
        if after:
            fail(
                f"{LIVE}: sigue devolviendo la retención caducada {after!r}. Esperar a la tarea "
                "programada para liberar el hueco es el fallo de WooCommerce: la liberación real "
                "cae entre T+x y T+2x, y si el planificador muere el hueco no vuelve JAMÁS"
            )

        # Y la de OTRA profesional no bloquea a esta.
        take_hold("req-otra", SLOT_START, SLOT_END, staff="s2")
        mine = run_query(
            query_sql(LIVE),
            {"hub_id": HUB, "staff_id": "s1", "start_datetime": SLOT_START, "now": NOW},
        )
        if {r["source_ref"] for r in mine} != {"req-1"}:
            fail(
                f"{LIVE}: la retención de otra profesional cierra esta agenda → {mine!r}"
            )

        # Ni la de otro hub, nunca.
        take_hold("req-vecino", SLOT_START, SLOT_END, hub=OTHER_HUB)
        mine = run_query(
            query_sql(LIVE),
            {"hub_id": HUB, "staff_id": "s1", "start_datetime": SLOT_START, "now": NOW},
        )
        if any(r["source_ref"] == "req-vecino" for r in mine):
            fail(f"{LIVE}: FUGA ENTRE HUBS — {mine!r}")

        # La gemela multi-día ve lo mismo para el lote y la serie.
        ahead = run_query(
            query_sql(AHEAD), {"hub_id": HUB, "staff_id": "s1", "now": NOW}
        )
        if {r["source_ref"] for r in ahead} != {"req-1"}:
            fail(f"{AHEAD}: esperaba solo req-1 para s1, devolvió {ahead!r}")

        # ── `hold_minutes = 0` apaga la retención entera ─────────────────────────────────
        settings_row(0)
        take_hold("req-apagada", SLOT_START, SLOT_END)
        if any(r["source_ref"] == "req-apagada" for r in holds()):
            fail(
                "hold_minutes = 0: sigue apartando huecos — el interruptor no apaga nada"
            )
        settings_row(15)

        # ── Soltar, vencer y consumir son TRES cosas distintas ───────────────────────────
        take_hold("req-suelta", SLOT_START, SLOT_END)
        run_sql_file(
            sql_of(RELEASE),
            {
                "hub_id": HUB,
                "source": "whatsapp_inbox",
                "source_ref": "req-suelta",
                "current_user_id": "u-1",
                "now": NOW,
            },
        )
        by_ref = {r["source_ref"]: r["status"] for r in holds()}
        if by_ref.get("req-suelta") != "released":
            fail(f"release_hold: dejó la retención en {by_ref.get('req-suelta')!r}")

        take_hold("req-consumida", SLOT_START, SLOT_END)
        run_sql_file(
            sql_of(CONSUME),
            {
                "hub_id": HUB,
                "source_ref": "req-consumida",
                "current_user_id": "u-1",
                "now": NOW,
            },
        )
        by_ref = {r["source_ref"]: r["status"] for r in holds()}
        if by_ref.get("req-consumida") != "consumed":
            fail(f"_hold_consume: dejó la retención en {by_ref.get('req-consumida')!r}")

        # Una ya consumida NO se degrada a `released`: perderíamos la única señal que dice si el
        # TTL está bien elegido (cuántas retenciones acabaron siendo cita).
        run_sql_file(
            sql_of(RELEASE),
            {
                "hub_id": HUB,
                "source": "whatsapp_inbox",
                "source_ref": "req-consumida",
                "current_user_id": "u-1",
                "now": NOW,
            },
        )
        by_ref = {r["source_ref"]: r["status"] for r in holds()}
        if by_ref.get("req-consumida") != "consumed":
            fail("release_hold degradó una retención ya CONSUMIDA — se pierde la traza")

        # La barrida marca `expired` lo vencido y no toca lo vivo.
        run_sql_file(
            sql_of(EXPIRE),
            {
                "hub_id": HUB,
                "current_user_id": "u-1",
                "now": "2026-08-20T09:16:00+02:00",
            },
        )
        by_ref = {r["source_ref"]: r["status"] for r in holds()}
        if by_ref.get("req-1") != "expired":
            fail(f"expire_holds: no venció la retención pasada de hora → {by_ref!r}")
        if by_ref.get("req-consumida") != "consumed":
            fail("expire_holds pisó una retención consumida")
        # Y el hub vecino sigue intacto: la barrida está acotada por hub_id.
        if by_ref.get("req-vecino") != "held":
            fail(f"expire_holds tocó el hub vecino → {by_ref!r}")

    finally:
        psql(["-c", f'DROP DATABASE IF EXISTS "{DB}"'])
        notes.append(f"capa postgres corrió en {CONTAINER} ({DB})")


def main() -> int:
    check_manifest()
    check_against_postgres()
    for note in notes:
        print(f"  · {note}")
    if failures:
        print()
        for f in failures:
            print(f"FAIL — {f}")
        return 1
    print()
    print("ok: appointments_slot_hold — cableado del manifest + Postgres real")
    return 0


if __name__ == "__main__":
    sys.exit(main())
