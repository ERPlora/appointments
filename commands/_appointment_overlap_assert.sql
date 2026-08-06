-- Overlap gate shared by `appointments.appointments.reschedule` and `.update`
-- (appointments#20): the double-booking invariant is enforced SERVER-SIDE, inside the
-- command's own transaction, so no caller (UI, SDK, API) can skip it.
--
-- Runs AFTER the UPDATE of the same command. `me.updated_at = :now` pins the row to THIS
-- command run (verifactu#27 pattern): if the UPDATE did not apply (wrong status, missing
-- row), the gate stays green and the command remains the no-op it already was.
--
-- Overlap semantics mirror the availability engine (queries/availability_check.sql) and
-- the create handler's authoritative read (queries/appointments_conflicting.sql):
-- live rows only (not deleted, not cancelled/no_show), same-staff conflict — an
-- appointment without staff uses the global agenda and conflicts with any row —
-- window [start, end) intersection via erp_dt (ADR-0007 §4a).
--
-- ok = 0 violates CHECK (ok = 1) on appointments__gate and rolls back the transaction.
INSERT INTO appointments__gate (gate, ok)
SELECT 'appointment_no_overlap',
       CASE WHEN (SELECT COALESCE(MAX(allow_overlapping), 0)
                  FROM appointments_settings
                  WHERE hub_id = :hub_id AND is_deleted = 0) = 0
             AND EXISTS (
                SELECT 1
                FROM appointments_appointment me
                JOIN appointments_appointment other
                  ON other.hub_id = me.hub_id
                 AND other.id <> me.id
                 AND other.is_deleted = 0
                 AND other.status NOT IN ('cancelled', 'no_show')
                 AND (COALESCE(me.staff_id, '') = '' OR other.staff_id = me.staff_id)
                 AND erp_dt(other.start_datetime) < erp_dt(me.end_datetime)
                 AND erp_dt(other.end_datetime)  > erp_dt(me.start_datetime)
                WHERE me.id = :appointment_id AND me.hub_id = :hub_id
                  AND me.is_deleted = 0
                  AND me.updated_at = :now
             )
       THEN 0 ELSE 1 END;
