-- The read of the scheduled task `phones_to_e164` (appointments#313): the upcoming appointments of
-- this hub that are still waiting (pending or confirmed) and whose phone is not E.164 yet — booked
-- before the handler saved it that way, or corrected by hand as typed. Those are the ones whose
-- «appointment confirmed» WhatsApp would reach nobody: the notice finds the conversation by the
-- exact international number. A past, cancelled, completed or deleted appointment sends nothing
-- any more and is left as it is.
--
-- Each row carries the hub's country (the core's `hub_settings.country_code`, ADR-0085): the
-- scheduler's context has none, and a number typed without prefix is one of the business's
-- country. No row → NULL, which the handler reads as Spain, the runtime's default — the same as
-- Customers' sweep (customers#121). A text the handler cannot read («ask at reception») comes back
-- on every tick and is left as typed; the bound keeps that cheap, and a hub with more than the
-- bound waits for the next tick. Runtime injects :hub_id and :now.
SELECT a.id,
       a.customer_phone,
       (SELECT s.value FROM hub_settings s
         WHERE s.hub_id = :hub_id AND s.key = 'country_code') AS country_code
FROM appointments_appointment a
WHERE a.hub_id = :hub_id
  AND a.is_deleted = 0
  AND a.status IN ('pending', 'confirmed')
  AND a.customer_phone <> ''
  AND a.customer_phone !~ '^\+[1-9][0-9]{6,14}$'
  AND erp_dt(a.start_datetime) >= erp_dt(:now)
ORDER BY a.start_datetime, a.id
LIMIT 1000;
