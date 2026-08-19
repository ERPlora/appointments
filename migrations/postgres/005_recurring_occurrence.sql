-- Appointments · 005 — TRAZABILIDAD e IDEMPOTENCIA de la recurrencia (appointments#15).
--
-- Hasta ahora una cita materializada desde una plantilla recurrente no guardaba NINGÚN vínculo con
-- ella: ni la serie, ni la ocurrencia que representaba. Consecuencias, las dos reales:
--   * volver a ejecutar `appointments.recurring.materialize` DUPLICABA las citas (no había con qué
--     reconocer «esta ya está»), y una materialización es justo lo que se reintenta: la ventana
--     avanza cada semana;
--   * una ocurrencia cancelada no podía ser una EXCEPCIÓN de la serie, porque nada la ataba a ella.
--
-- `recurring_id` = la serie (FK lógica a `appointments_recurring`; sin constraint para que borrar la
-- plantilla no arrastre las citas ya prestadas, que son historia del negocio).
-- `occurrence_date` = el día de PARED de la ocurrencia (`YYYY-MM-DD`), no el instante: es la clave
-- natural que la plantilla genera, y la que hace idempotente el reintento. Se guarda como TEXT por
-- el mismo motivo que el resto de fechas del módulo (ADR-0007 §4a).
--
-- El índice único es PARCIAL (`is_deleted = 0`): dos filas vivas de la misma serie el mismo día son
-- el duplicado que esto existe para impedir, pero una cita BORRADA no debe bloquear que se vuelva a
-- reservar ese día. Una cita CANCELADA sí lo bloquea a propósito — es la excepción de la serie, y
-- reintentar la materialización no puede resucitarla (es lo que hacen Google Calendar, Outlook,
-- Fresha y Square: cancelar una ocurrencia no la devuelve el siguiente sync).
ALTER TABLE appointments_appointment ADD COLUMN recurring_id    TEXT;
ALTER TABLE appointments_appointment ADD COLUMN occurrence_date TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_occurrence
    ON appointments_appointment (hub_id, recurring_id, occurrence_date)
    WHERE is_deleted = 0 AND recurring_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_appointments_recurring
    ON appointments_appointment (hub_id, recurring_id);
