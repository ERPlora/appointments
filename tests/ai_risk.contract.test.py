#!/usr/bin/env python3
"""Cuánto daño hace cada operación ofrecida a la IA (ERPlora/hub#1042).

El asistente se INVENTÓ una garantía de seguridad: dijo que `bulk_delete` «no existe, está
deshabilitada intencionalmente» un turno después de listarla entre sus propias tools. Ese
mecanismo no existe. Lo único que impidió el borrado fue el criterio del modelo, no un control —
y el producto, además, le mintió al usuario sobre sus propias defensas.

`ai.risk` (vocabulario CERRADO: normal · destructive · bulk_destructive) es lo que permite al core
aplicar una política de confirmación SIN conocer el dominio.

**Este módulo es la prueba de por qué el core no puede adivinarlo por el nombre**: sus siete
commands «destructivos» son en realidad SOFT-DELETE de UNA fila (`is_deleted = 1 WHERE id = :x`,
sin cascada), y `cancel` —que suena peor que varios— es la operación reversible y correcta, con
motivo obligatorio. Un core que clasificara por el nombre se equivocaría en los dos sentidos.

Uso: tests/ai_risk.contract.test.py   (exit 0 = verde)
"""

import json
import pathlib
import sys

MODULE_DIR = pathlib.Path(__file__).resolve().parent.parent
MANIFEST = json.loads((MODULE_DIR / "module.json").read_text())
COMMANDS = MANIFEST.get("commands", {})

failures: list[str] = []


def fail(msg: str) -> None:
    failures.append(msg)


def risk_of(name: str) -> str:
    """El riesgo declarado. Ausente = `normal`, que es el default del schema."""
    return COMMANDS.get(name, {}).get("ai", {}).get("risk", "normal")


# El conjunto que alcanza a VARIOS registros: el payload nombra `ids` (hasta 50) y la tarjeta no
# dice cuántas caen. Es exactamente la definición de `bulk_destructive`.
BULK = {"appointments.appointments.bulk_delete"}

# Borrados de UNA fila. Soft-delete, pero el usuario no puede deshacerlos desde la pantalla.
# `schedules.delete` / `timeslots.delete` salieron con appointments#117: el horario se configura
# en `schedules` y este módulo ya no lo escribe.
SINGLE = {
    "appointments.appointments.delete",
    "appointments.blocked_times.delete",
    "appointments.recurring.delete",
}

# Cancelar NO es borrar: conserva la cita, exige motivo y es la vía reversible. Marcarla como
# destructiva empujaría al asistente a evitar la operación CORRECTA, y al usuario a teclear
# confirmaciones para lo rutinario — que es como se enseña a confirmar sin leer.
REVERSIBLE = {"appointments.appointments.cancel"}


def check_the_check_finds_something() -> None:
    """Si estas tools dejaran de ofrecerse a la IA, todo lo de abajo pasaría sin comprobar nada."""
    for name in BULK | SINGLE | REVERSIBLE:
        if name not in COMMANDS:
            fail(f"`{name}` ya no existe en el manifest: este test dejó de comprobar nada")
        elif "ai" not in COMMANDS[name]:
            fail(f"`{name}` ya no se ofrece a la IA: este test dejó de comprobar nada")


def check_risk_is_declared() -> None:
    for name in sorted(BULK):
        if risk_of(name) != "bulk_destructive":
            fail(f"`{name}` alcanza a un CONJUNTO: debe declarar `bulk_destructive`, no {risk_of(name)!r}")
    for name in sorted(SINGLE):
        if risk_of(name) != "destructive":
            fail(f"`{name}` borra un registro: debe declarar `destructive`, no {risk_of(name)!r}")
    for name in sorted(REVERSIBLE):
        if risk_of(name) != "normal":
            fail(
                f"`{name}` es la vía REVERSIBLE (conserva la cita, exige motivo): marcarla "
                f"{risk_of(name)!r} empuja a evitar la operación correcta"
            )


def check_no_destructive_is_left_unmarked() -> None:
    """Cualquier command nuevo que se ofrezca a la IA y suene destructivo tiene que decidirse.

    No clasifica por el nombre —eso lo hace el humano que lo escribe— pero sí OBLIGA a mirarlo:
    un `*.delete` nuevo que nadie clasifique entra aquí como fallo, no en silencio.
    """
    known = BULK | SINGLE | REVERSIBLE
    for name, cmd in sorted(COMMANDS.items()):
        if "ai" not in cmd or name in known:
            continue
        leaf = name.split(".")[-1]
        if any(w in leaf for w in ("delete", "remove", "void", "purge", "wipe", "clear")):
            fail(f"`{name}` se ofrece a la IA y suena destructivo, pero nadie ha decidido su `risk`")


def main() -> int:
    check_the_check_finds_something()
    check_risk_is_declared()
    check_no_destructive_is_left_unmarked()
    if failures:
        print(f"FAIL ({len(failures)}):")
        for f in sorted(set(failures)):
            print(f"  - {f}")
        return 1
    print("OK: cada operación ofrecida a la IA declara cuánto daño hace")
    return 0


if __name__ == "__main__":
    sys.exit(main())
