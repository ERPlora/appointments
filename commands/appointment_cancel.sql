-- Cancelación de cita (Tier 0). Portado de Appointment.cancel(reason).
-- Guarda: no se puede cancelar lo ya 'cancelled' ni 'completed' (WHERE). Marca cancelled_at.
UPDATE appointments_appointment
SET status = 'cancelled',
    cancelled_at = :now,
    cancellation_reason = :reason,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status NOT IN ('cancelled', 'completed');
