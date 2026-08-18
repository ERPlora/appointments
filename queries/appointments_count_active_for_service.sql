-- Upcoming live appointments of ONE service — the public read `services` archives with (services#2).
--
-- Archiving a service must not break the slots already booked (each appointment keeps its own
-- snapshot of service_name/price/duration), but the person archiving has to be TOLD what it
-- touches: Fresha/Square/Vagaro archive and warn, they never delete a service with future
-- bookings. `services` cannot look at this table (it is private to this module), so the count is
-- published here as a query — the only cross-module door the contract allows.
--
-- What counts: this hub, this service, not deleted, still bookable (`pending`/`confirmed`), and
-- starting at or after `:now` (injected by the runtime, never sent). Completed/cancelled/no_show
-- and past appointments are history: archiving changes nothing for them.
--
-- ALWAYS one row (an aggregate without GROUP BY): `active_count = 0` when there is nothing.
-- The caller must be able to tell "no appointments" from "query unavailable" (module not installed).
SELECT COUNT(*)              AS active_count,
       MIN(start_datetime)   AS next_start_datetime
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND service_id = :service_id
  AND is_deleted = 0
  AND status IN ('pending', 'confirmed')
  AND erp_dt(start_datetime) >= erp_dt(:now);
