-- Appointment reschedule — the row move of `appointments.appointments.reschedule`.
--
-- Since appointments#10 it is NOT called directly: the command runs the WASM handler
-- (`reschedule_appointment`), which reads the appointment, the settings and the blocked periods,
-- refuses what does not fit and emits this UPDATE as `appointments._reschedule_row`. So
-- `:end_datetime` no longer comes from the browser — the handler computes it as start + duration.
--
-- The `WHERE status IN (...)` stays as a belt: the handler decided with a read and the state could
-- have changed since. The one that turns that into an ERROR instead of a silent no-op is
-- _reschedule_state_assert.sql, which the handler emits as its own operation BEFORE this one; the
-- overlap check (allow_overlapping) is enforced right after by _appointment_overlap_assert.sql
-- (gate table with CHECK — appointments#20), and the audit trail by _history_series_move.sql last (the line a series move writes, which
-- says whether the professional, the service or only the time changed — appointments#263) —
-- both run as LATER statements of this SAME `_reschedule_row` command's own `sql[]`, not as
-- separate operations, because the runtime binds `:now` once per command and both find this row
-- by `a.updated_at = :now` (appointments#196).
--
-- appointments#263: the move can also hand the appointment to another professional or change its
-- service — resolved by the handler against the staff and service records, never from the caller.
-- An EMPTY `:staff_id` / `:service_id` keeps what the row has (the pattern of
-- _recurring_move_occurrence.sql), so a plain move never rewrites who does it or what it costs;
-- the price follows the service.
UPDATE appointments_appointment
SET start_datetime   = :start_datetime,
    end_datetime     = :end_datetime,
    duration_minutes = :duration_minutes,
    staff_id         = COALESCE(NULLIF(:staff_id, ''), staff_id),
    staff_name       = CASE WHEN COALESCE(:staff_id, '') = '' THEN staff_name ELSE :staff_name END,
    service_id       = COALESCE(NULLIF(:service_id, ''), service_id),
    service_name     = CASE WHEN COALESCE(:service_id, '') = '' THEN service_name ELSE :service_name END,
    service_price    = CASE WHEN COALESCE(:service_id, '') = '' THEN service_price ELSE :service_price END,
    updated_by       = :current_user_id,
    updated_at       = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status IN ('pending', 'confirmed');
