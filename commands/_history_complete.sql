-- Audit trail of the `complete` transition (appointments#21). See _history_confirm.sql for the
-- `a.updated_at = :now` run-pinning rationale. The previous status is not re-read (the UPDATE
-- accepts confirmed|in_progress), so old_value stays NULL rather than lying.
INSERT INTO appointments_history
  (id, hub_id, appointment_id, action, description, performed_by, old_value, new_value,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :new_id, :hub_id, a.id, 'completed', 'Appointment completed', :current_user_id,
       NULL,
       '{"status":"completed"}',
       0, :current_user_id, :current_user_id, :now, :now
FROM appointments_appointment a
WHERE a.id = :appointment_id AND a.hub_id = :hub_id AND a.is_deleted = 0
  AND a.updated_at = :now;
