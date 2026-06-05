# appointments — lógica para handler Rust→WASM (Tier 2)

Fuente legacy: `old_modules/m_appointments/{models.py,services.py,whatsapp.py,slots.py}`.
El CRUD plano y las transiciones de estado simples ya están en SQL declarativo Tier 0
(`commands/*.sql`): update, confirm/start/complete/cancel/no_show/reschedule, soft-delete,
CRUD de schedules/timeslots/blocked_time/recurring y upsert de settings. Lo que sigue es
lógica de validación / cálculo / batch / contador atómico que **no** cabe en una sola
sentencia SQL y debe convertirse en handler WASM (`handler/src/lib.rs` → `dist/handler.wasm`).

> Regla hub-next: el WASM **nunca toca la BD**. Recibe el payload + datos leídos por el
> runtime (settings, citas solapadas candidatas, último appointment_number del día) y
> devuelve *intenciones* (comandos `_insert_appointment` / `_insert_history` a ejecutar)
> que el runtime valida y persiste en una transacción. El "reloj" (now) lo aporta el host.

## 1. `create_appointment`  (command `appointments.appointments.create`)
Origen: `AppointmentService.create`.
- Parsear `start_datetime` (ISO) y calcular `end = start + duration_minutes`.
- Validar `start >= now` → si no, error `invalid_start` ("no puede empezar en el pasado").
- Leer `appointments_settings.allow_overlapping` (el runtime lo provee). Si es `false`:
  buscar cualquier cita con `status NOT IN ('cancelled','no_show')` cuyo
  `[start_datetime, end_datetime)` se solape con la nueva (`existing.start < end AND
  existing.end > start`). Si hay solape → error `overlap` con el número y franja de la
  cita en conflicto.
- Resolver `service_name` desde el módulo `services` cuando llega `service_id` sin nombre
  (contrato cross-módulo: query pública `services.services.get`/equivalente — **no** SELECT
  directo a la tabla privada de services).
- **Contador atómico** del nº de cita → ver pieza 5.
- Emitir intención `_insert_appointment` (status `pending`, `booked_online` según payload) +
  `_insert_history` (action `created`).
- Devolver `{id, appointment_number, start, created:true}`.

## 2. `bulk_create`  (command `appointments.appointments.bulk_create`)
Origen: `AppointmentService.bulk_create` (máx. 50 ítems).
- Por cada ítem: misma lógica que pieza 1 (parseo, end, contador, inserción) acumulando
  errores por índice en vez de abortar el lote.
- El contador de nº debe avanzar correctamente dentro del mismo lote (no releer entre ítems).
- Devolver `{created:N, errors:M, details:{created:[...], errors:[{index,error}]}}`.

## 3. `bulk_delete`  (command `appointments.appointments.bulk_delete`)
Origen: `AppointmentService.bulk_delete` (máx. 50 ids).
- Soft-delete batch (is_deleted=1, deleted_at=now) de cada id existente del hub.
- Acumular `{id, customer}` en created/errors. Devolver `{deleted:N, errors:M, details:{...}}`.
- Es batch (devuelve la lista de afectados) → no cabe en un único UPDATE declarativo.

## 4. Guarda de borrado de cita (delete_guard)
Origen: `AppointmentService.delete` (rechaza completed/in_progress).
- El SQL `appointment_delete.sql` ya filtra `status NOT IN ('completed','in_progress')` en el
  WHERE, así que un borrado de una cita en ese estado simplemente no afecta filas. Si se
  quiere devolver el error explícito `invalid_status` ("cancela primero"), el handler debe
  leer el status antes y decidir. No bloqueante (el WHERE ya protege la integridad).

## 5. Contador atómico de nº de cita (`generate_appointment_number`)
Origen: `Appointment.generate_number` + la secuencia que `create`/`bulk_create` calculan
leyendo `MAX(appointment_number)` con prefijo del día (race condition en el legacy).
- Formato `APT-YYYYMMDD-NNNN` (NNNN = secuencia por hub+día, 4 dígitos).
- En hub-next debe ser **atómico** (sin ventana SELECT→UPDATE) en SQLite y Postgres → se
  resuelve como capacidad del runtime (counter UPSERT `... ON CONFLICT DO UPDATE RETURNING`,
  como el patrón de `quotes`/`invoice_series`). El WASM solo formatea `APT-{day}-{n:04d}`.

## 6. Motor de recurrencia (`materialize_recurring`)  (command `appointments.recurring.materialize`)
Origen: `RecurringAppointment.get_next_occurrence` + la generación de citas a partir de una
plantilla recurrente.
- Dada una `appointments_recurring` (frequency daily|weekly|biweekly|monthly, day_of_week,
  time, duration, start_date, end_date, max_occurrences), calcular las fechas de ocurrencia
  en una ventana [from, to] respetando `end_date`/`max_occurrences`.
- Lógica por frecuencia (calcada de `get_next_occurrence`): daily = cada día; weekly/biweekly
  = alinear a `day_of_week` saltando 7/14 días; monthly = mismo día del mes (con rollover de
  año en diciembre).
- Para cada ocurrencia, materializar una `Appointment` reusando piezas 1 y 5 (contador, solape
  según settings). Emitir `_insert_appointment` + `_insert_history` por cada una.
- Operación batch sobre N filas → WASM. Devolver `{created:N, dates:[...]}`.

## 7. Cálculo de end_datetime al editar/reagendar (Tier 1, ya resuelto en UI)
Origen: `Appointment.reschedule` / `update` (recalculan `end = start + duration`).
- Los SQL `appointment_update.sql` / `appointment_reschedule.sql` esperan `end_datetime` ya
  resuelto (el SDK/UI lo calcula `start + duration`). Si se quiere blindar server-side,
  moverlo al handler (suma de minutos = capacidad de reloj del host). No bloqueante.

## 8. Disponibilidad / slots libres (whatsapp.py: `check_availability`, `get_available_slots`)
Origen: `old_modules/m_appointments/whatsapp.py` + `slots.py`.
- `check_availability(date, time, service, staff)`: cruzar la plantilla de horario
  (`appointments_schedule` + `_timeslot` del día de la semana) con `blocked_time` y citas
  existentes para decidir si una franja está libre. Respeta `min_booking_notice` /
  `max_advance_booking` de settings.
- `get_available_slots(date)`: generar las franjas candidatas del día en pasos de
  `settings.slot_interval` entre `calendar_start_hour` y `calendar_end_hour`, restando las
  ocupadas/bloqueadas. Es lógica de calendario pura (lectura + cómputo) → WASM; el runtime
  provee las lecturas (timeslots, blocked_time, citas del día) y el WASM devuelve la lista.
- `conflicts_with` (BlockedTime) y `Schedule.is_available_at` son helpers de este mismo motor.

## 9. Integración WhatsApp (whatsapp.py: `create_from_request`, `get_context_for_bot`)
Origen: `old_modules/m_appointments/whatsapp.py` (consumido genéricamente por `whatsapp_inbox`).
- Integración externa: crear cita desde una solicitud entrante de WhatsApp y exponer contexto
  para el bot. En hub-next esto es Tier 1/2 (mediated `http.fetch` + WASM) y/o un contrato de
  eventos con un futuro módulo `whatsapp_inbox`. Fuera del alcance del CRUD declarativo;
  se documenta aquí para no perder la funcionalidad al migrar.

## 10. Recordatorios (settings.send_reminders / reminder_hours_before)
Origen: campos `reminder_sent`/`reminder_sent_at` + settings de recordatorio.
- Tarea programada que selecciona citas próximas sin recordatorio enviado y dispara el envío
  (canal externo) marcando `reminder_sent`. Batch + integración externa → runtime scheduled
  task + handler. El legacy no tenía SCHEDULED_TASKS implementadas; se deja documentado.
