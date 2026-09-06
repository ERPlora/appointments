-- Motor de disponibilidad: ¿está libre una franja concreta? (WASM-TODO pieza 8 /
-- check_availability). Query declarativa Tier 0 — misma lógica que availability_slots
-- pero para UNA franja, devolviendo `available` (0/1) y el primer `reason` que falla:
--   invalid_start | too_soon | too_far | blocked | overlap | held | ''
--
-- 🔴 appointments#118 — AQUÍ YA NO SE MIRA EL HORARIO. Esta query calculaba `outside_schedule`
-- contra las tablas de horario PROPIAS del módulo, que se retiraron con la pantalla que las
-- escribía (#117) y con su respaldo (#118). El horario del negocio es de `schedules` (ADR-0392) y
-- una query de un módulo solo puede nombrar tablas de su módulo, así que este SQL no puede
-- seguir esa precedencia ni por asomo: quien necesite las horas pregunta a
-- `appointments.availability.day_opening`, que corre la MISMA función que la puerta. La pantalla
-- de reserva ya lo hace así desde #105.
--
-- Binds: :start_datetime (ISO 8601, requerido) · :duration_minutes (opcional; default =
-- settings.default_duration) · :staff_id (opcional; ausente = agenda global).
-- Runtime inyecta :hub_id y :now. Fechas/horas vía funciones-puente erp_* (ADR-0007 §4a):
-- erp_dt (datetime comparable), erp_date (parte fecha), erp_dateadd (suma intervalo).
-- Fechas en TEXT ISO-8601.
-- :staff_id va CASTEADO (`CAST(:staff_id AS TEXT)`) y no es estilo: Postgres fija el tipo de un
-- bind en su PRIMERA aparición y `IS [NOT] NULL` no aporta ninguno, así que sin :staff_id —la
-- agenda global, o sea la llamada normal— el bind viajaba sin tipo y el PREPARE moría con 42P08.
-- Mismo idioma que ya usa queries/appointments_list.sql. Cubierto por tests/availability.pg.test.py.
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
