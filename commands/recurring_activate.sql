-- Reactiva una plantilla de cita recurrente desactivada (§2.5, appointments#110). No repone
-- ocurrencias por sí sola: eso sigue siendo `recurring.materialize`. Runtime inyecta
-- :hub_id/:current_user_id/:now.
UPDATE appointments_recurring
SET is_active = 1, updated_by = :current_user_id, updated_at = :now
WHERE id = :recurring_id AND hub_id = :hub_id AND is_deleted = 0;
