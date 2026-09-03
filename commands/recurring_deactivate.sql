-- Desactiva una plantilla de cita recurrente sin borrarla (§2.5, appointments#110). No toca
-- is_deleted ni las ocurrencias ya reservadas: solo deja de ofrecerse para materializar nuevas
-- (`recurring.materialize` la rechaza con `recurring_inactive`) y para elegirla en la agenda.
-- Runtime inyecta :hub_id/:current_user_id/:now.
UPDATE appointments_recurring
SET is_active = 0, updated_by = :current_user_id, updated_at = :now
WHERE id = :recurring_id AND hub_id = :hub_id AND is_deleted = 0;
