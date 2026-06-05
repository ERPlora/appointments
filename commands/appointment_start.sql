-- Transición confirmed → in_progress (Tier 0). Portado de Appointment.start().
UPDATE appointments_appointment
SET status = 'in_progress',
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status = 'confirmed';
