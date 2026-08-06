-- State gate of `appointments.appointments.reschedule` (appointments#21), using the gate table
-- of appointments#20 (`appointments__gate`, CHECK (ok = 1)).
--
-- Runs BEFORE the UPDATE. Rescheduling an appointment in a terminal state (completed, cancelled,
-- no_show) used to return a silent OK: the UPDATE's WHERE simply did not match, nothing changed
-- and the caller got success. The receptionist "moved" a cancelled appointment and it stayed put.
-- Now ok = 0 → CHECK violation → the whole command rolls back with an error the UI can show.
--
-- Reschedulable domain = the same one the UPDATE accepts: pending|confirmed.
INSERT INTO appointments__gate (gate, ok)
SELECT 'appointment_reschedulable',
       CASE WHEN EXISTS (
              SELECT 1
              FROM appointments_appointment
              WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
                AND status IN ('pending', 'confirmed')
            ) THEN 1 ELSE 0 END;
