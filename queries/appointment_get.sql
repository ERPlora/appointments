-- One appointment in full. The runtime injects :hub_id. Ported from AppointmentService.get.
--
-- This is the COUNTER door (appointments#146): it carries `customer_phone`/`customer_email` and
-- therefore has NO `ai` block. Adding columns here must never turn it into a model tool —
-- tests/model_readable_columns.contract.test.py pins that in both directions.
--
-- 🕒 appointments#151 — THE DAY AND THE HOUR COME OUT ALREADY READABLE. An automation that
-- confirms a booking has to be able to say «confirmada: el martes a las 10:30 con Ana», and the
-- flow mapping language has neither a clock nor a formatter: `{{steps.x.y}}` prints the value
-- exactly as it comes, so an ISO instant could only be left unsaid. The two labels below are that
-- sentence's raw material, resolved ONCE here instead of reinvented in every consumer.
--
-- They are two SEPARATE fields on purpose, never one sentence: the connector («… a las …»,
-- «… at …») is PROSE, and prose belongs to whoever writes the message, in its own catalogue —
-- ADR-0055, and the same reason this module has no user-facing strings in SQL.
WITH clock AS (
    -- The zone and the language are the CORE's, never this module's (docs/concepts.md, «The clock
    -- is the business's»). `system_params` binds both into every query: `:timezone` is the IANA
    -- name `settings::timezone_of` already resolved (hub#1022), `:caller_lang` the effective
    -- language with the shell's own precedence — personal override, hub setting, `es` (hub#1098).
    --
    -- The CAST is not style: Postgres fixes a bind's type on its FIRST appearance and neither
    -- `TRIM` nor `COALESCE` gives it one, so without it the PREPARE dies with 42P08 — the same
    -- lesson queries/availability_slots.sql wrote down for `:timezone`.
    --
    -- Both COALESCE degrade the way the CORE degrades, and never to NULL, which is the trap that
    -- matters: `AT TIME ZONE NULL` returns NULL, so an empty zone would blank the labels while the
    -- read still looked perfectly healthy. `UTC` mirrors the runtime's own `timezone_name()`; `en`
    -- is the SOURCE language a missing translation falls back to (ADR-0055) — not `es`, which is
    -- the core's default for the SETTING and something `:caller_lang` has already applied by the
    -- time it gets here.
    --
    -- SPLIT_PART drops a regional tag (`es-ES` becomes `es`): a hub that spells its language out
    -- in full would otherwise fall silently into English on a screen that is entirely in Spanish.
    SELECT COALESCE(NULLIF(TRIM(CAST(:timezone AS TEXT)), ''), 'UTC') AS tz,
           LOWER(SPLIT_PART(
               COALESCE(NULLIF(TRIM(CAST(:caller_lang AS TEXT)), ''), 'en'), '-', 1)) AS lang
)
SELECT a.id, a.appointment_number, a.customer_id, a.customer_name, a.customer_phone,
       a.customer_email,
       a.staff_id, a.staff_name, a.service_id, a.service_name, a.service_price,
       a.start_datetime, a.end_datetime, a.duration_minutes, a.status,
       -- appointments#79: `booked_online` as a BOOLEAN — it is what `appointments.create` declares.
       a.notes, a.internal_notes, a.booked_online <> 0 AS booked_online,
       -- appointments#15: which series this appointment comes from and which occurrence it is
       -- (NULL when it comes from none).
       a.recurring_id, a.occurrence_date,
       -- sales#89: the sale born of this appointment (ADR-0077), or NULL if it is not paid yet.
       a.converted_sale_id,
       a.cancelled_at, a.cancellation_reason,
       -- appointments#151. 24-hour, matching what this module's own screens paint: the web
       -- components pin `hourCycle: 'h23'` whatever the locale (ui/lib/business-time.ts,
       -- `formatWallTime`), so the message and the agenda can never disagree about the hour.
       wall.hh || ':' || wall.mi AS start_time_label,
       -- appointments#151. Weekday, day, month and year — the shape every appointment product
       -- confirms a booking with (Fresha, Setmore, Calendly, Vagaro, Acuity). The YEAR stays in on
       -- purpose: `max_advance_booking` is a setting, so a confirmation can be months out and
       -- «martes, 12 de enero» read in December is a date the customer has to guess at.
       --
       -- The names are a table here and not `to_char(..., 'TMDay')` — which resolves against
       -- `lc_time`, a SESSION setting of the server: the same «whoever's clock is nearest» bug
       -- that `:timezone` exists to close, only with words. And `to_char` is not portable anyway
       -- (ADR-0007), so `erplora validate` refuses it.
       CASE clock.lang
           WHEN 'es' THEN
               (ARRAY['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])
                   [wall.weekday]
               || ', ' || wall.day_of_month || ' de '
               || (ARRAY['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
                         'septiembre', 'octubre', 'noviembre', 'diciembre'])[wall.month_of_year]
               || ' de ' || wall.year_number
           ELSE
               (ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
                   [wall.weekday]
               || ', ' || wall.day_of_month || ' '
               || (ARRAY['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                         'September', 'October', 'November', 'December'])[wall.month_of_year]
               || ' ' || wall.year_number
       END AS start_date_label
FROM appointments_appointment a
CROSS JOIN clock
CROSS JOIN LATERAL (
    -- The calendar fields of this appointment as the SALON reads them. Plain Postgres on purpose,
    -- exactly like the `AT TIME ZONE` below and for the same reason queries/availability_slots.sql
    -- gives (ADR-0154): the `erp_*` bridge has nothing for a calendar field, and half a bridge
    -- would leave the query mixing dialects anyway.
    --
    -- ISODOW is 1=Monday…7=Sunday, which indexes the arrays above directly — a `+ 1` on a 0-based
    -- weekday is one of the two off-by-ones this label can have, and the other is the month.
    -- `EXTRACT(DAY …)` drops the padding for free: Spanish writes «5 de septiembre», never «05».
    SELECT LPAD(CAST(CAST(EXTRACT(HOUR   FROM w.ts) AS INTEGER) AS TEXT), 2, '0') AS hh,
           LPAD(CAST(CAST(EXTRACT(MINUTE FROM w.ts) AS INTEGER) AS TEXT), 2, '0') AS mi,
           CAST(CAST(EXTRACT(DAY    FROM w.ts) AS INTEGER) AS TEXT) AS day_of_month,
           CAST(CAST(EXTRACT(YEAR   FROM w.ts) AS INTEGER) AS TEXT) AS year_number,
           CAST(EXTRACT(MONTH  FROM w.ts) AS INTEGER)               AS month_of_year,
           CAST(EXTRACT(ISODOW FROM w.ts) AS INTEGER)               AS weekday
    FROM (
        -- The salon's WALL CLOCK reading of this instant — the only clock that may name a day or
        -- an hour to a customer. Resolved from the stored text and the business zone, never from
        -- the session's, which is UTC in the runtime.
        --
        -- Two shapes are read differently on purpose, because the row contract is mid-move
        -- (appointments#88 still owes the normalisation at rest):
        --   · text carrying a zone designator (`+02:00` today, `Z` once #88 lands) is an INSTANT,
        --     so it converts — and only converting gets `08:30Z` to read 10:30 in Madrid, and
        --     files an appointment at 23:30 UTC on the NEXT day, which is the salon's day for it;
        --   · text with none is a legacy wall reading whose first 19 characters ARE the salon's
        --     clock; casting that to timestamptz would interpret it in the session zone and shift
        --     the label by the hub's whole offset.
        -- After position 10 the date part is spent, so a `Z` or a sign there can only be the zone.
        SELECT CASE
                   WHEN SUBSTR(a.start_datetime, 11) ~ '[Z+-]'
                       THEN CAST(a.start_datetime AS timestamptz) AT TIME ZONE clock.tz
                   ELSE CAST(SUBSTR(a.start_datetime, 1, 19) AS timestamp)
               END AS ts
    ) w
) wall
WHERE a.hub_id = :hub_id AND a.is_deleted = 0 AND a.id = :appointment_id;
