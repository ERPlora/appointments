-- Audit-trail de una cita (entradas más recientes primero). Runtime inyecta :hub_id.
SELECT id, appointment_id, action, description, performed_by, old_value, new_value, created_at
FROM appointments_history
WHERE hub_id = :hub_id AND is_deleted = 0 AND appointment_id = :appointment_id
ORDER BY created_at DESC;
