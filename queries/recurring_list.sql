-- Plantillas de cita recurrente activas del hub. Runtime inyecta :hub_id.
SELECT id, customer_name, service_name, staff_name, frequency, day_of_week,
       time, duration_minutes, start_date, end_date, max_occurrences, is_active
FROM appointments_recurring
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
ORDER BY start_date ASC;
