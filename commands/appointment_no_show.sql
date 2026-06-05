-- Marcar como no_show (Tier 0). Portado de Appointment.mark_no_show().
-- Guarda de estado: solo desde pending|confirmed (WHERE). La comprobación is_past
-- (la cita ya pasó) la aplica el SDK/UI antes de llamar; aquí no se compara contra "ahora".
UPDATE appointments_appointment
SET status = 'no_show',
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status IN ('pending', 'confirmed');
