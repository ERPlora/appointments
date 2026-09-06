-- The availability engine, own-rules half: is THIS slot free? (appointments#122)
--
-- Returns `available` (0/1) and the first `reason` that fails, in the door's order:
--   invalid_start | too_soon | too_far | blocked | overlap | held | ''
--
-- 🔴 THE HOURS ARE NOT HERE, AND CANNOT BE. This query used to compute `outside_schedule` against
-- the module's OWN timetable, retired with the screen that wrote it (appointments#117) and with
-- its fallback (appointments#118). The business opening hours belong to `schedules` (ADR-0392) and
-- a query of a module may only name its own module's tables, so this SQL cannot follow that
-- precedence even in principle. That is why it is no longer the operation anybody calls:
-- appointments#122 turned `appointments.availability.check` into a handler command that takes this
-- verdict as an authoritative read and adds the hours through `schedule_refusal` — the very
-- function the booking door runs. Whoever only wants the open stretches of a date asks
-- `appointments.availability.day_opening`.
--
-- The names say which half is which: this query is `appointments.availability.own_rules` and it
-- answers ONLY what this module owns — the booking notice, the blocked periods, the appointments
-- already on the books and the slots held for a pending request.
--
-- Binds: :start_datetime (ISO 8601, required) · :duration_minutes (optional; default =
-- settings.default_duration) · :staff_id (optional; absent = the whole agenda) ·
-- :exclude_hold_ref (optional; the pending request that owns a hold on this slot).
-- The runtime injects :hub_id and :now. Dates/times go through the erp_* bridge functions
-- (ADR-0007 §4a): erp_dt (comparable datetime), erp_date (date part), erp_dateadd (add interval).
-- Dates are ISO-8601 TEXT.
-- :staff_id is CAST (`CAST(:staff_id AS TEXT)`) and that is not style: Postgres fixes a bind's
-- type at its FIRST appearance and `IS [NOT] NULL` contributes none, so without :staff_id — the
-- whole agenda, which is the normal call — the bind travelled untyped and PREPARE died with 42P08.
-- Same idiom queries/appointments_list.sql already uses. Covered by tests/availability.postgres.test.py.
WITH cfg AS (
    SELECT COALESCE(COALESCE(:duration_minutes, MAX(default_duration)), 60) AS dur,
           COALESCE(MAX(min_booking_notice),  60) AS notice_min,
           COALESCE(MAX(max_advance_booking), 90) AS advance_days,
           COALESCE(MAX(allow_overlapping),    0) AS allow_overlapping
    FROM appointments_settings
    WHERE hub_id = :hub_id AND is_deleted = 0
),
win AS (
    SELECT erp_dt(:start_datetime) AS s_start,
           erp_dateadd(:start_datetime, c.dur, 'minutes') AS s_end
    FROM cfg c
),
checks AS (
    SELECT
        CASE WHEN w.s_start IS NULL THEN 1 ELSE 0 END AS invalid_start,
        CASE WHEN w.s_start < erp_dateadd(:now, c.notice_min, 'minutes')
             THEN 1 ELSE 0 END AS too_soon,
        -- `advance_days = 0` DESACTIVA el tope (appointments#78): mismo significado que el
        -- handler (`lead_time_refusal` solo aplica el máximo `if max_days > 0`). Sin este caso,
        -- TODO instante futuro era too_far y la pantalla —que consulta `check` antes de crear—
        -- no podía reservar aunque `create` habría aceptado ese mismo instante.
        CASE WHEN c.advance_days > 0
                  AND erp_date(w.s_start) > erp_date(erp_dateadd(:now, c.advance_days, 'days'))
             THEN 1 ELSE 0 END AS too_far,
        CASE WHEN EXISTS (
                 SELECT 1
                 FROM appointments_blocked_time b
                 WHERE b.hub_id = :hub_id AND b.is_deleted = 0
                   AND (b.staff_id IS NULL OR b.staff_id = ''
                        OR (CAST(:staff_id AS TEXT) IS NOT NULL AND b.staff_id = :staff_id))
                   AND (
                       (b.all_day = 1 AND erp_date(b.start_datetime) <= erp_date(w.s_start)
                                      AND erp_date(w.s_start) <= erp_date(b.end_datetime))
                       OR (erp_dt(b.start_datetime) < w.s_end
                           AND erp_dt(b.end_datetime) > w.s_start)
                   )
             )
             THEN 1 ELSE 0 END AS blocked,
        CASE WHEN c.allow_overlapping = 0 AND EXISTS (
                 SELECT 1
                 FROM appointments_appointment a
                 WHERE a.hub_id = :hub_id AND a.is_deleted = 0
                   AND a.status NOT IN ('cancelled', 'no_show')
                   AND (CAST(:staff_id AS TEXT) IS NULL OR a.staff_id = :staff_id)
                   AND erp_dt(a.start_datetime) < w.s_end
                   AND erp_dt(a.end_datetime) > w.s_start
             )
             THEN 1 ELSE 0 END AS overlap,
        -- appointments#69: y las franjas RETENIDAS mientras alguien decide. `held` es un motivo
        -- PROPIO, no `overlap`: «ya hay una cita» mandaría a buscar en la agenda una cita que no
        -- existe, y un hueco que desaparece sin nombre se lee como un bug (es literalmente lo que
        -- el soporte de Square tiene que explicar sobre su retención de 15 min).
        -- Va DESPUÉS de `overlap` en la cascada: una cita real es una razón más firme que una
        -- retención que caduca sola.
        CASE WHEN c.allow_overlapping = 0 AND EXISTS (
                 SELECT 1
                 FROM appointments_slot_hold h
                 WHERE h.hub_id = :hub_id AND h.is_deleted = 0
                   AND h.status = 'held'
                   AND erp_dt(h.expires_at) > erp_dt(:now)
                   AND COALESCE(CAST(:exclude_hold_ref AS TEXT), '') <> h.source_ref
                   AND (CAST(:staff_id AS TEXT) IS NULL OR h.staff_id = '' OR h.staff_id = :staff_id)
                   AND erp_dt(h.start_datetime) < w.s_end
                   AND erp_dt(h.end_datetime) > w.s_start
             )
             THEN 1 ELSE 0 END AS held
    FROM win w, cfg c
)
SELECT
    CASE WHEN invalid_start + too_soon + too_far + blocked + overlap + held = 0
         THEN 1 ELSE 0 END AS available,
    CASE
        WHEN invalid_start = 1 THEN 'invalid_start'
        WHEN too_soon = 1 THEN 'too_soon'
        WHEN too_far = 1 THEN 'too_far'
        WHEN blocked = 1 THEN 'blocked'
        WHEN overlap = 1 THEN 'overlap'
        WHEN held = 1 THEN 'held'
        ELSE ''
    END AS reason
FROM checks;
