-- Appointment reschedule (Tier 0). Ported from Appointment.reschedule(new_start, new_duration).
-- Guard: only pending|confirmed (WHERE). The new end_datetime (= start + duration) is
-- resolved by the SDK/UI and passed in. The overlap check (allow_overlapping) is enforced
-- SERVER-SIDE by the next statement of this command, _appointment_overlap_assert.sql
-- (gate table with CHECK — appointments#20); it rolls back this UPDATE on double booking.
UPDATE appointments_appointment
SET start_datetime   = :start_datetime,
    end_datetime     = :end_datetime,
    duration_minutes = :duration_minutes,
    updated_by       = :current_user_id,
    updated_at       = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status IN ('pending', 'confirmed');
