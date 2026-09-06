# Módulo `appointments` — agenda de citas

Agenda de un negocio con cita previa (peluquería, clínica, taller): reserva una franja para un
**cliente**, contra un **servicio** y un **profesional**, y lleva el ciclo de vida
`pending → confirmed → in_progress → completed / cancelled / no_show`. Gestiona horarios de
disponibilidad, tiempo bloqueado y plantillas de citas recurrentes.

> **Module id:** `appointments`. **Depende de:** `customers`, `services`, `staff` — la cita se
> reserva **contra un profesional**, no contra un nombre tecleado (los tres ids son `required` en el
> schema, así que el alta de texto libre la rechaza el runtime).
> Módulo híbrido: SQL + handler WASM (`create_appointment`, `bulk_create`, `bulk_delete`,
> `materialize_recurring`).

## Documentación de usuario — [`docs/`](docs/)

Viaja **dentro** del módulo y se versiona con él: el asistente del hub (ADR-0282) la indexa por
versión instalada y cita la de TU versión, no la de la última publicada. En inglés (idioma fuente).

| Fichero | Para qué |
| ------- | -------- |
| [`docs/overview.md`](docs/overview.md) | Qué hace y qué NO hace; el ciclo de vida y los eventos |
| [`docs/screens.md`](docs/screens.md) | La agenda (lista ↔ por profesional), reservar, bloqueos y recurrentes |
| [`docs/concepts.md`](docs/concepts.md) | **Capacidad = nº de profesionales**, `allow_overlapping` apaga la comprobación ENTERA, transición inválida = RECHAZO (ya no OK mudo con evento duplicado), reprogramar se excluye a sí misma |
| [`docs/limits.md`](docs/limits.md) | Los 5 códigos `cannot_*`, las 6 razones de no-disponibilidad, caps y permisos por acción |

## Qué expone hoy

| Tipo | Nombre | Permiso |
| ---- | ------ | ------- |
| query | `appointments.appointments.list` / `.get` / `.history` / `.conflicting` | `view_appointment` |
| query | `appointments.availability.slots` / `.check` (motor autoritativo, Tier 0) | `view_schedule` |
| query | `appointments.blocked_times.list` | `view_schedule` |
| query | `appointments.recurring.list` · `.settings.get` | `view_appointment` |
| command | `appointments.appointments.create` (WASM, `reads` → `conflicting`) / `.bulk_create` (WASM) | `add_appointment` |
| command | `confirm` / `start` / `complete` / `cancel` / `no_show` / `reschedule` / `update` (todas con `expect_rows` + código de dominio) | `change_appointment` |
| command | `appointments.appointments.delete` / `.bulk_delete` (WASM) | `delete_appointment` |
| command | `blocked_times.*` | `manage_schedule` |
| command | `recurring.create` / `.materialize` (WASM) / `.delete` · `settings.upsert` | `add_appointment` / `manage_settings` |
| emite | `appointments.appointment.*`, `.blocked_time.created`, `.recurring.created`, `.settings.updated` | — |
| escucha | — | — |

Navegación: `erp-appointments-list` («Appointments»), con conmutador **lista ↔ por profesional**
(reutiliza `ok-scheduler` de OutfitKit).

## Layout

```text
module.json                   # manifest (contrato técnico)
migrations/postgres/          # esquema §2.5 + contador atómico por (hub_id, day)
queries/*.sql                 # lecturas declarativas (el motor de disponibilidad es Tier 0)
commands/*.sql                # escrituras declarativas (las `_` son intenciones del WASM)
schemas/*.json                # JSON Schemas de input (draft 2020-12)
handler/                      # WASM Tier 2 → dist/handler.wasm
ui/                           # Web Components (Lit/Ionic/OutfitKit)
docs/                         # documentación de usuario + corpus del asistente
```

## Estado y trabajo abierto

El estado vive en las **Issues de este repo**, no aquí. Documentado en `docs/limits.md`: el módulo
**no envía recordatorios** (los ajustes solo guardan la política) y el vínculo con calendarios
externos vive en un satélite (`calendar_sync`, ADR-0148), **sin `depends_on`** en ninguna dirección.

Doc de arquitectura: `architecture/modules/appointments.md` (cargarlo antes de tocar el módulo).
