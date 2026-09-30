-- Ocurrencias de UNA serie que ya están en la agenda (read autoritativa del handler WASM de
-- `recurring.materialize` — ADR-0069, appointments#15).
--
-- Es lo que hace IDEMPOTENTE el reintento. Materializar no es una operación rara que se hace una
-- vez: la ventana avanza cada semana y alguien vuelve a pulsar. Sin esta lectura el handler no
-- tenía con qué reconocer «esta ocurrencia ya está» y DUPLICABA las citas.
--
-- Se devuelven también las CANCELADAS a propósito: una ocurrencia cancelada es la EXCEPCIÓN de la
-- serie («esa semana no»), y el reintento no puede resucitarla — es lo que hacen Google Calendar,
-- Outlook, Fresha y Square. Las BORRADAS sí quedan fuera: borrar es una acción destructiva de
-- administración y el índice único de la migración 005 también las excluye, así que ese día vuelve
-- a estar libre. Runtime inyecta :hub_id.
-- appointments#15 (edición de serie): además del día y el estado van el ID y el hueco actual, que
-- es lo que el handler de `recurring.update` necesita para MOVER la fila en sitio en vez de
-- borrarla y volver a materializar (la cita conserva su número y su historial), y
-- `converted_sale_id` para no tocar la que ya arrastra registro fiscal (ADR-0331).
-- appointments#236: `staff_id` because an occurrence handed by hand to another professional cannot
-- be judged on the series' professional's agenda and days — it is reported, never moved blind.
-- appointments#253: who does it and its service, by name — the history line of a move says what
-- the occurrence HAD, and by then the row is already rewritten.
SELECT id, occurrence_date, status, start_datetime, end_datetime, duration_minutes,
       converted_sale_id, staff_id, staff_name, service_id, service_name
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND recurring_id = :recurring_id
ORDER BY occurrence_date ASC;
