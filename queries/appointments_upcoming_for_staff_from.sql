-- ONE PAGE of a professional's live appointments ahead, from the window's start — the read of
-- `recurring.materialize` (appointments#267).
--
-- `upcoming_for_staff.sql` hands over her WHOLE agenda ahead, and the WASM handler pays ~40 k
-- instructions per row just to read it: past ~4 300 bookings of hers a series ran out of the
-- kernel's 200 M budget before judging a single date (`code: wasm`, nothing booked). A series does
-- not need it whole: it books at most 50 occurrences a run. So this read is bounded by ROWS, not by
-- dates — a `to` would not bound anything, callers pass the horizon:
--
--   * from the window's start (`payload.from`, YYYY-MM-DD) minus a day, so a booking written in
--     any offset that still overlaps that day comes back; without a date-shaped `from`, from
--     `:now` — exactly `upcoming_for_staff`;
--   * ordered by INSTANT, then id: start texts carry mixed offsets and do not sort as time, and a
--     page has to end on the same row every time;
--   * at most 2 000 rows (the handler's `AGENDA_PAGE_ROWS`). A full page holds every booking that
--     starts before its last start; the handler judges only what ends by then and answers
--     `next_from` for the rest.
--
-- Same rows as `upcoming_for_staff`: hers plus the ones with no professional (they take
-- anybody's slot), live only. `:now`, `:hub_id` come from the runtime (system_params). erp_* =
-- portable bridge functions (ADR-0007 §4a).
SELECT id, appointment_number, staff_id, start_datetime, end_datetime, status
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND status NOT IN ('cancelled', 'no_show')
  AND (COALESCE(staff_id, '') = '' OR staff_id = :staff_id)
  AND erp_dt(end_datetime) >= erp_dt(:now)
  AND erp_dt(end_datetime) >= CASE
        WHEN COALESCE(CAST(:from AS TEXT), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        THEN erp_dateadd(CAST(:from AS TEXT), -1, 'days')
        ELSE erp_dt(:now)
      END
ORDER BY erp_dt(start_datetime), id
LIMIT 2000;
