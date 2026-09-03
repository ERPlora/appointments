-- Plantillas de cita recurrente del hub, activas E inactivas (appointments#110): una serie
-- desactivada no puede volverse invisible, o «desactivar» sería una trampa sin forma de
-- reactivarla. Quien solo quiera las activas usa el filtro `is_active` que ya declara el bloque
-- `list` del manifest. Runtime inyecta :hub_id.
SELECT id, customer_name, service_name, staff_name, frequency, day_of_week,
       time, duration_minutes, start_date, end_date, max_occurrences, is_active
FROM appointments_recurring
WHERE hub_id = :hub_id AND is_deleted = 0
