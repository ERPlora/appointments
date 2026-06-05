-- Transición confirmed|in_progress → completed (Tier 0). Portado de Appointment.complete().
UPDATE appointments_appointment
SET status = 'completed',
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status IN ('confirmed', 'in_progress');
