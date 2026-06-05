-- Tramos horarios de una plantilla concreta. Runtime inyecta :hub_id.
SELECT id, schedule_id, day_of_week, start_time, end_time, is_active
FROM appointments_schedule_timeslot
WHERE hub_id = :hub_id AND is_deleted = 0 AND schedule_id = :schedule_id
ORDER BY day_of_week ASC, start_time ASC;
