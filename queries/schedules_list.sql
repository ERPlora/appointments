-- Plantillas de horario activas del hub. Runtime inyecta :hub_id.
SELECT id, name, description, is_default, is_active
FROM appointments_schedule
WHERE hub_id = :hub_id AND is_deleted = 0 AND is_active = 1
ORDER BY is_default DESC, name ASC;
