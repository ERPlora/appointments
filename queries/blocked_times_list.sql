-- Tiempos bloqueados del hub a partir de una fecha (calendario). Runtime inyecta :hub_id.
-- Bind :from_datetime (ISO 8601): devuelve bloqueos que terminan en/después de esa fecha.
SELECT id, title, block_type, start_datetime, end_datetime, all_day, staff_id, reason
FROM appointments_blocked_time
WHERE hub_id = :hub_id AND is_deleted = 0
  AND end_datetime >= :from_datetime
ORDER BY start_datetime ASC;
