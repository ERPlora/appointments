-- Appointments waiting for the business to confirm them — the bell counter (appointments#169).
--
-- With «I review them first» on (`auto_confirm_online = 0`), a booking the customer made herself
-- (online, or the unattended WhatsApp flow, whose grant pins `booked_online = true` on `create`,
-- hub#1623) is born `pending` and waits for the salon.
-- The shell's bell runs this query for `bell["appointments.to_confirm"]` (hub#1678) and shows a row
-- while `count` is above zero; it clears itself once they are confirmed or cancelled.
--
-- What counts: this hub, not deleted, `pending` AND `booked_online = 1`, starting at or after
-- `:now` (injected by the runtime, never sent). `booked_online` is not optional: `status` is born
-- `pending` for counter bookings too, and those are the salon's own — nobody is waiting on them.
--
-- ALWAYS one row (an aggregate without GROUP BY): `count = 0` when nothing is waiting.
SELECT COUNT(*) AS count
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND status = 'pending'
  AND booked_online = 1
  AND erp_dt(start_datetime) >= erp_dt(:now);
