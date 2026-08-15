-- Agenda configuration status — the row behind this module's checklist item (appointments#30,
-- hub#369). ONE row always: `hub.setup.status` reads the first row and evaluates
-- `configured_when` on it, so a status query answers with counters, never with a list.
--
-- What "configured" means here is "the hub knows when this business works". It is NOT the
-- settings row (`appointments.settings.get`): every column there is NOT NULL with a default and
-- the availability engine falls back to exactly those defaults when the row is missing, so saving
-- that form changes nothing about the day. The weekly time slots do: while there is not a single
-- one, `queries/availability_slots.sql` takes its `NOT EXISTS(...)` branch and offers the whole
-- 8-20 calendar window every day of the week — Sunday included, with the salon shut. The first
-- active slot is what makes the agenda start telling the truth.
--
-- Only slots that can actually be booked count: active slot, on an active schedule, neither
-- soft-deleted. Runtime injects :hub_id.
SELECT
    (SELECT COUNT(*)
       FROM appointments_schedule sc
      WHERE sc.hub_id = :hub_id
        AND sc.is_deleted = 0
        AND sc.is_active = 1) AS active_schedules,
    (SELECT COUNT(*)
       FROM appointments_schedule_timeslot t
       JOIN appointments_schedule sc ON sc.id = t.schedule_id AND sc.hub_id = :hub_id
      WHERE t.hub_id = :hub_id
        AND t.is_deleted = 0
        AND t.is_active = 1
        AND sc.is_deleted = 0
        AND sc.is_active = 1) AS weekly_time_slots;
