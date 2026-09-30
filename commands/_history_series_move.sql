-- Audit trail of an occurrence moved by a series edit (appointments#253). Runs as the LATER
-- statement of `_recurring_move_occurrence`, the SAME command as the UPDATE it audits, because the
-- runtime binds `:now` once per command (and once per WASM operation), so a separate operation
-- would never match the pin below (appointments#196). See _history_confirm.sql for the
-- `a.updated_at = :now` run-pinning rationale: a move the UPDATE refused leaves NO line.
--
-- A single reschedule keeps `_history_reschedule.sql`; a series move needs its own line because it
-- can also hand the appointment to another professional or change its service, and «rescheduled»
-- with the time it already had said neither. By the time this runs the row is already rewritten,
-- so what it HAD arrives as `:from_*` — copied by the handler from the occurrences read, never
-- from the payload — and the action says what changed: the professional first (what the customer
-- asks about), then the service, else the time.
--
-- old_value = what it had, new_value = what the row has now (plus the channel, like every move
-- line). Names are free text: their double quotes and backslashes are neutralised so the JSON
-- stays parseable (same approach as _history_cancel.sql).
INSERT INTO appointments_history
  (id, hub_id, appointment_id, action, description, performed_by, old_value, new_value,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :new_id, :hub_id, a.id,
       CASE
         WHEN COALESCE(a.staff_id, '') <> COALESCE(:from_staff_id, '') THEN 'staff_changed'
         WHEN COALESCE(a.service_id, '') <> COALESCE(:from_service_id, '') THEN 'service_changed'
         ELSE 'rescheduled'
       END,
       CASE
         WHEN COALESCE(a.staff_id, '') <> COALESCE(:from_staff_id, '')
           THEN 'Appointment handed to another professional'
         WHEN COALESCE(a.service_id, '') <> COALESCE(:from_service_id, '')
           THEN 'Appointment service changed'
         ELSE 'Appointment rescheduled'
       END,
       :current_user_id,
       '{"staff_id":"' || REPLACE(REPLACE(COALESCE(:from_staff_id, ''), '\', '/'), '"', '''')
         || '","staff_name":"' || REPLACE(REPLACE(COALESCE(:from_staff_name, ''), '\', '/'), '"', '''')
         || '","service_id":"' || REPLACE(REPLACE(COALESCE(:from_service_id, ''), '\', '/'), '"', '''')
         || '","service_name":"' || REPLACE(REPLACE(COALESCE(:from_service_name, ''), '\', '/'), '"', '''')
         || '","start_datetime":"' || REPLACE(COALESCE(:from_start_datetime, ''), '"', '''') || '"}',
       '{"start_datetime":"' || a.start_datetime || '","end_datetime":"' || a.end_datetime
         || '","duration_minutes":' || CAST(a.duration_minutes AS TEXT)
         || ',"channel":"' || COALESCE(:channel, 'staff')
         || '","staff_id":"' || REPLACE(REPLACE(COALESCE(a.staff_id, ''), '\', '/'), '"', '''')
         || '","staff_name":"' || REPLACE(REPLACE(COALESCE(a.staff_name, ''), '\', '/'), '"', '''')
         || '","service_id":"' || REPLACE(REPLACE(COALESCE(a.service_id, ''), '\', '/'), '"', '''')
         || '","service_name":"' || REPLACE(REPLACE(COALESCE(a.service_name, ''), '\', '/'), '"', '''')
         || '"}',
       0, :current_user_id, :current_user_id, :now, :now
FROM appointments_appointment a
WHERE a.id = :appointment_id AND a.hub_id = :hub_id AND a.is_deleted = 0
  AND a.updated_at = :now;
