-- Plantillas de horario activas del hub. Runtime inyecta :hub_id.
-- appointments#79: `is_default` como BOOLEANO — es lo que declara `schedules.create`, así que una
-- plantilla listada se puede volver a crear con la misma fila.
SELECT id, name, description, is_default <> 0 AS is_default, is_active
FROM appointments_schedule
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
