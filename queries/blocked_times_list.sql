-- Tiempos bloqueados del hub a partir de una fecha (calendario). Runtime inyecta :hub_id.
-- Bind :from_datetime (ISO 8601): devuelve bloqueos que terminan en/después de esa fecha.
-- appointments#79: `all_day` sale como BOOLEANO (en reposo es INTEGER 0/1), que es lo que
-- `blocked_times.create` declara — así una fila listada se puede volver a crear tal cual.
SELECT id, title, block_type, start_datetime, end_datetime, all_day <> 0 AS all_day, staff_id, reason
FROM appointments_blocked_time
WHERE hub_id = :hub_id AND is_deleted = 0
  AND end_datetime >= :from_datetime
