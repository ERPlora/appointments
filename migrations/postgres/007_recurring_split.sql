-- Appointments · 007 — TRAZABILIDAD del split de una serie recurrente (appointments#15).
--
-- Editar una serie con alcance «esta y las siguientes» PARTE la serie en dos: la plantilla
-- original se cierra el día anterior al corte (`end_date`, que ya existía) y nace una plantilla
-- NUEVA desde el corte con los valores nuevos. Es el modelo canónico de RFC 5545
-- (`RECURRENCE-ID;RANGE=THISANDFUTURE`) y lo que hacen Google Calendar (`UNTIL` + `events.insert`),
-- Microsoft y Odoo (`_stop_at()` + recurrencia nueva).
--
-- Por qué se parte en vez de versionar la misma plantilla: el índice único parcial de la 005 es
-- `(hub_id, recurring_id, occurrence_date)`. Una plantilla versionada daría DOS verdades para la
-- misma fecha de pared bajo el mismo `recurring_id` — exactamente el duplicado que ese índice
-- existe para impedir. Dos ids no chocan.
--
-- `split_from_id` es la única pieza que faltaba: sin ella las dos mitades quedan como dos series
-- sin relación y nadie puede responder «¿de dónde salió esta?» un mes después. FK lógica, sin
-- constraint, por el mismo motivo que `appointments_appointment.recurring_id`: borrar la mitad
-- vieja no puede arrastrar a la nueva, que sigue viva y con citas dadas.
ALTER TABLE appointments_recurring ADD COLUMN split_from_id TEXT;

CREATE INDEX IF NOT EXISTS ix_appointments_recurring_split
    ON appointments_recurring (hub_id, split_from_id);
