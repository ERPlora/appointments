-- Cancel row update, emitted by the `cancel_appointment` WASM handler as the intention
-- `appointments._cancel_row` (appointments#6: the policy — who may cancel and how far ahead —
-- lives in the handler, decided from the pre-loaded reads). Ported from Appointment.cancel(reason).
-- Guard kept in the WHERE as the last line of defence against a race between the handler's read
-- and this UPDATE: an already 'cancelled' or 'completed' row stays put. Sets cancelled_at.
UPDATE appointments_appointment
SET status = 'cancelled',
    cancelled_at = :now,
    cancellation_reason = :reason,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status NOT IN ('cancelled', 'completed');
