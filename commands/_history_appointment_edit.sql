-- Audit trail of a single-appointment edit, `appointments.appointments.update` (appointments#260).
-- Same actions and the same JSON as the line of the series edit, `_history_series_move.sql`
-- (appointments#253), so the history component paints both alike: the professional first (what
-- the customer asks about), then the service, else the time; old_value = what the appointment
-- had, new_value = what it has now plus the channel.
--
-- It runs FIRST in the `sql[]` of the command, BEFORE `appointment_update.sql`: the command is
-- declarative, with no handler to read the row beforehand, and once the UPDATE has run the row no
-- longer says what it had. So «had» is the row as it stands and «has now» is the payload the
-- UPDATE is about to write — the same binds, so the two cannot disagree. Its WHERE is the one of the UPDATE
-- (id, hub_id, not deleted): an edit that updates nothing leaves nothing. And it shares the
-- transaction of the command: when the overlap gate after the UPDATE refuses, this line rolls back with
-- it, so the trail never shows a change that did not happen. That is why it needs no
-- `updated_at = :now` pin (appointments#196): the rollback does that job here.
--
-- Only a real change leaves a line: editing notes or the customer phone writes nothing, and the
-- slot is compared as an instant (`erp_dt`), so the same time re-sent with another offset is not a
-- move. Names are free text: their double quotes and backslashes are neutralised so the JSON stays
-- parseable (same approach as _history_series_move.sql).
INSERT INTO appointments_history
  (id, hub_id, appointment_id, action, description, performed_by, old_value, new_value,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :new_id, :hub_id, a.id,
       CASE
         WHEN COALESCE(a.staff_id, '') <> COALESCE(:staff_id, '') THEN 'staff_changed'
         WHEN COALESCE(a.service_id, '') <> COALESCE(:service_id, '') THEN 'service_changed'
         ELSE 'rescheduled'
       END,
       CASE
         WHEN COALESCE(a.staff_id, '') <> COALESCE(:staff_id, '')
           THEN 'Appointment handed to another professional'
         WHEN COALESCE(a.service_id, '') <> COALESCE(:service_id, '')
           THEN 'Appointment service changed'
         ELSE 'Appointment rescheduled'
       END,
       :current_user_id,
       '{"staff_id":"' || REPLACE(REPLACE(COALESCE(a.staff_id, ''), '\', '/'), '"', '''')
         || '","staff_name":"' || REPLACE(REPLACE(COALESCE(a.staff_name, ''), '\', '/'), '"', '''')
         || '","service_id":"' || REPLACE(REPLACE(COALESCE(a.service_id, ''), '\', '/'), '"', '''')
         || '","service_name":"' || REPLACE(REPLACE(COALESCE(a.service_name, ''), '\', '/'), '"', '''')
         || '","start_datetime":"' || REPLACE(COALESCE(a.start_datetime, ''), '"', '''') || '"}',
       '{"start_datetime":"' || REPLACE(CAST(:start_datetime AS TEXT), '"', '''')
         || '","end_datetime":"' || REPLACE(CAST(:end_datetime AS TEXT), '"', '''')
         || '","duration_minutes":' || CAST(CAST(:duration_minutes AS INTEGER) AS TEXT)
         || ',"channel":"staff'
         || '","staff_id":"' || REPLACE(REPLACE(COALESCE(:staff_id, ''), '\', '/'), '"', '''')
         || '","staff_name":"' || REPLACE(REPLACE(COALESCE(:staff_name, ''), '\', '/'), '"', '''')
         || '","service_id":"' || REPLACE(REPLACE(COALESCE(:service_id, ''), '\', '/'), '"', '''')
         || '","service_name":"' || REPLACE(REPLACE(COALESCE(:service_name, ''), '\', '/'), '"', '''')
         || '"}',
       0, :current_user_id, :current_user_id, :now, :now
FROM appointments_appointment a
WHERE a.id = :appointment_id AND a.hub_id = :hub_id AND a.is_deleted = 0
  AND (COALESCE(a.staff_id, '') <> COALESCE(:staff_id, '')
       OR COALESCE(a.service_id, '') <> COALESCE(:service_id, '')
       OR erp_dt(a.start_datetime) <> erp_dt(:start_datetime)
       OR erp_dt(a.end_datetime) <> erp_dt(:end_datetime));
