-- Motor de disponibilidad: ¿está libre una franja concreta? (WASM-TODO pieza 8 /
-- check_availability). Query declarativa Tier 0 — misma lógica que availability_slots
-- pero para UNA franja, devolviendo `available` (0/1) y el primer `reason` que falla:
--   invalid_start | too_soon | too_far | outside_schedule | blocked | overlap | ''
--
-- Binds: :start_datetime (ISO 8601, requerido) · :duration_minutes (opcional; default =
-- settings.default_duration) · :staff_id (opcional; ausente = agenda global).
-- Runtime inyecta :hub_id y :now. printf()/strftime()/datetime() son de SQLite (§14).
WITH cfg AS (
    SELECT COALESCE(COALESCE(:duration_minutes, MAX(default_duration)), 60) AS dur,
           COALESCE(MAX(min_booking_notice),  60) AS notice_min,
           COALESCE(MAX(max_advance_booking), 90) AS advance_days,
           COALESCE(MAX(allow_overlapping),    0) AS allow_overlapping
    FROM appointments_settings
    WHERE hub_id = :hub_id AND is_deleted = 0
),
win AS (
    SELECT datetime(:start_datetime) AS s_start,
           datetime(:start_datetime, '+' || c.dur || ' minutes') AS s_end,
           CAST((CAST(strftime('%w', :start_datetime) AS INTEGER) + 6) % 7 AS INTEGER) AS dow,
           CAST(strftime('%H', :start_datetime) AS INTEGER) * 60
             + CAST(strftime('%M', :start_datetime) AS INTEGER) AS start_min,
           CAST(strftime('%H', :start_datetime) AS INTEGER) * 60
             + CAST(strftime('%M', :start_datetime) AS INTEGER) + c.dur AS end_min
    FROM cfg c
),
checks AS (
    SELECT
        CASE WHEN w.s_start IS NULL THEN 1 ELSE 0 END AS invalid_start,
        CASE WHEN w.s_start < datetime(:now, '+' || c.notice_min || ' minutes')
             THEN 1 ELSE 0 END AS too_soon,
        CASE WHEN date(w.s_start) > date(:now, '+' || c.advance_days || ' days')
             THEN 1 ELSE 0 END AS too_far,
        CASE WHEN EXISTS (
                 SELECT 1
                 FROM appointments_schedule_timeslot t
                 JOIN appointments_schedule sc ON sc.id = t.schedule_id
                 WHERE t.hub_id = :hub_id AND t.is_deleted = 0 AND t.is_active = 1
                   AND sc.is_deleted = 0 AND sc.is_active = 1
             )
             AND NOT EXISTS (
                 SELECT 1
                 FROM appointments_schedule_timeslot t
                 JOIN appointments_schedule sc ON sc.id = t.schedule_id
                 WHERE t.hub_id = :hub_id AND t.is_deleted = 0 AND t.is_active = 1
                   AND sc.is_deleted = 0 AND sc.is_active = 1
                   AND t.day_of_week = w.dow
                   AND (CAST(substr(t.start_time, 1, 2) AS INTEGER) * 60
                        + CAST(substr(t.start_time, 4, 2) AS INTEGER)) <= w.start_min
                   AND w.end_min <= (CAST(substr(t.end_time, 1, 2) AS INTEGER) * 60
                                     + CAST(substr(t.end_time, 4, 2) AS INTEGER))
             )
             THEN 1 ELSE 0 END AS outside_schedule,
        CASE WHEN EXISTS (
                 SELECT 1
                 FROM appointments_blocked_time b
                 WHERE b.hub_id = :hub_id AND b.is_deleted = 0
                   AND (b.staff_id IS NULL OR b.staff_id = ''
                        OR (:staff_id IS NOT NULL AND b.staff_id = :staff_id))
                   AND (
                       (b.all_day = 1 AND date(b.start_datetime) <= date(w.s_start)
                                      AND date(w.s_start) <= date(b.end_datetime))
                       OR (datetime(b.start_datetime) < w.s_end
                           AND datetime(b.end_datetime) > w.s_start)
                   )
             )
             THEN 1 ELSE 0 END AS blocked,
        CASE WHEN c.allow_overlapping = 0 AND EXISTS (
                 SELECT 1
                 FROM appointments_appointment a
                 WHERE a.hub_id = :hub_id AND a.is_deleted = 0
                   AND a.status NOT IN ('cancelled', 'no_show')
                   AND (:staff_id IS NULL OR a.staff_id = :staff_id)
                   AND datetime(a.start_datetime) < w.s_end
                   AND datetime(a.end_datetime) > w.s_start
             )
             THEN 1 ELSE 0 END AS overlap
    FROM win w, cfg c
)
SELECT
    CASE WHEN invalid_start + too_soon + too_far + outside_schedule + blocked + overlap = 0
         THEN 1 ELSE 0 END AS available,
    CASE
        WHEN invalid_start = 1 THEN 'invalid_start'
        WHEN too_soon = 1 THEN 'too_soon'
        WHEN too_far = 1 THEN 'too_far'
        WHEN outside_schedule = 1 THEN 'outside_schedule'
        WHEN blocked = 1 THEN 'blocked'
        WHEN overlap = 1 THEN 'overlap'
        ELSE ''
    END AS reason
FROM checks;
