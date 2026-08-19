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
SELECT occurrence_date, status
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND recurring_id = :recurring_id
ORDER BY occurrence_date ASC;
