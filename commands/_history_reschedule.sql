-- Audit trail of the `reschedule` transition (appointments#21). Runs LAST in the command, after
-- the state gate, the UPDATE and the overlap gate — so a rejected reschedule (terminal status or
-- double booking) rolls back with NO history row, and the trail never shows a move that did not
-- happen. See _history_confirm.sql for the `a.updated_at = :now` run-pinning rationale.
--
-- new_value carries the slot the appointment landed on (read back from the row), plus the channel
-- the move was asked through (`staff` | `customer`, appointments#145 — bound by the handler as
-- :channel), the same stamp the cancel line carries.
INSERT INTO appointments_history
  (id, hub_id, appointment_id, action, description, performed_by, old_value, new_value,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :new_id, :hub_id, a.id, 'rescheduled', 'Appointment rescheduled', :current_user_id,
       NULL,
       '{"start_datetime":"' || a.start_datetime || '","end_datetime":"' || a.end_datetime
         || '","duration_minutes":' || CAST(a.duration_minutes AS TEXT)
         || ',"channel":"' || COALESCE(:channel, 'staff') || '"}',
       0, :current_user_id, :current_user_id, :now, :now
FROM appointments_appointment a
WHERE a.id = :appointment_id AND a.hub_id = :hub_id AND a.is_deleted = 0
  AND a.updated_at = :now;
