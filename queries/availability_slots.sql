-- Motor de disponibilidad: slots libres de un día (WASM-TODO pieza 8 / get_available_slots).
-- Va como query declarativa Tier 0 (no WASM): el contrato runtime↔WASM devuelve intenciones,
-- no datos al caller, así que esta lógica de calendario (lectura + cómputo) vive en SQL.
--
-- Genera las franjas candidatas de :date en pasos de `slot_interval` entre
-- `calendar_start_hour` y `calendar_end_hour` (settings del hub, con defaults si no hay
-- fila) y descarta las que:
--   · violan la antelación mínima (`min_booking_notice`) o máxima (`max_advance_booking`),
--   · caen fuera de los tramos activos de horario del día — solo si el hub tiene horarios
--     configurados (sin horarios, valen las horas de calendario),
--   · chocan con tiempo bloqueado (del hub entero, o del :staff_id si se pide),
--   · se solapan con citas vivas (status fuera de cancelled/no_show), salvo
--     `allow_overlapping`.
--
-- Binds: :date (YYYY-MM-DD, requerido) · :staff_id (opcional; ausente = agenda global)
--        · :duration_minutes (opcional; default = settings.default_duration).
-- Runtime inyecta :hub_id y :now. Un bind ausente llega como NULL (centinela del adapter).
-- :staff_id va CASTEADO (`CAST(:staff_id AS TEXT)`) y no es estilo: Postgres fija el tipo de un
-- bind en su PRIMERA aparición y `IS [NOT] NULL` no aporta ninguno, así que sin :staff_id —la
-- agenda global, o sea la llamada normal— el bind viajaba sin tipo y el PREPARE moría con 42P08.
-- Mismo idioma que ya usa queries/appointments_list.sql. Cubierto por tests/availability.pg.test.py.
-- Fechas/horas vía funciones-puente erp_* (ADR-0007 §4a): erp_dt (datetime comparable),
-- erp_date (parte fecha), erp_dateadd (suma intervalo),
-- erp_timefmt (HH:MM). Las fechas se guardan como TEXT ISO-8601.
--
-- ⚠️ EL MISMO RELOJ PARA LOS DOS LADOS (appointments#76). Los huecos candidatos son texto NAIVE
-- (hora de pared del salón, sin offset) y las citas viven CON offset (`2026-08-28T12:00:00+02:00`).
-- Bajar ambos por `erp_dt` (`::timestamptz`) interpreta el hueco naive en la zona horaria de la
-- SESIÓN (UTC en el runtime) y tacha la ventana desplazada exactamente el offset del hub: se
-- ofrecían huecos ocupados y se escondían libres, en contradicción con `availability.check`.
-- La comparación correcta entre dos datos que el módulo YA tiene en la mano es PARED contra
-- PARED: el texto ISO de la fila recortado a su propia hora local (`substr(...,1,19)` conserva
-- `YYYY-MM-DDTHH:MM:SS`, deja fuera el offset y los milisegundos) contra el hueco naive, como
-- TEXTO — mismo formato, ancho fijo, cero-padded: lexicográfico = cronológico, sin zona horaria
-- de por medio y a prueba del reloj de la sesión. Cada fila se compara en el reloj en que fue
-- escrita; una fila con offset del hub (todas las que escribe la UI del módulo desde #76) es
-- exactamente la pared del salón.
--
-- ✅ appointments#88 CERRÓ el resto que este comentario dejaba abierto: la ANTELACIÓN MÍNIMA ya
-- no se mide en el reloj de la sesión. `:timezone` (hub#1022) llega a todo el SQL, así que el
-- hueco naive se resuelve al instante del salón antes de compararlo con `:now` — ver la cláusula
-- marcada abajo. Sigue pendiente en la propia #88 el FORMATO en reposo (normalizar las filas a
-- UTC `Z` con su migración) y el tope MÁXIMO, que cuenta días de calendario sobre la fecha UTC de
-- `:now` y se desvía una sola vez al día, en la franja de medianoche del salón.
WITH RECURSIVE
cfg AS (
    SELECT COALESCE(MAX(calendar_start_hour), 8)   AS start_hour,
           COALESCE(MAX(calendar_end_hour),   20)  AS end_hour,
           COALESCE(MAX(slot_interval),       15)  AS step,
           COALESCE(COALESCE(:duration_minutes, MAX(default_duration)), 60) AS dur,
           COALESCE(MAX(min_booking_notice),  60)  AS notice_min,
           COALESCE(MAX(max_advance_booking), 90)  AS advance_days,
           COALESCE(MAX(allow_overlapping),    0)  AS allow_overlapping
    FROM appointments_settings
    WHERE hub_id = :hub_id AND is_deleted = 0
),
slots(m) AS (
    SELECT start_hour * 60 FROM cfg
    UNION ALL
    SELECT s.m + c.step FROM slots s, cfg c WHERE s.m + c.step + c.dur <= c.end_hour * 60
),
cand AS (
    SELECT s.m AS start_min,
           s.m + c.dur AS end_min,
           :date || 'T' || erp_timefmt(s.m / 60, s.m % 60) || ':00' AS slot_start,
           :date || 'T' || erp_timefmt((s.m + c.dur) / 60, (s.m + c.dur) % 60) || ':00' AS slot_end
    FROM slots s, cfg c
    WHERE s.m + c.dur <= c.end_hour * 60
)
SELECT c.slot_start,
       c.slot_end,
       erp_timefmt(c.start_min / 60, c.start_min % 60) AS start_time,
       erp_timefmt(c.end_min / 60, c.end_min % 60)     AS end_time
FROM cand c, cfg
WHERE
    -- antelación mínima / máxima respecto a :now. `advance_days = 0` DESACTIVA el tope
    -- (appointments#78): mismo significado que ya le da el handler (`lead_time_refusal` solo
    -- aplica el máximo `if max_days > 0`) y que el doc del módulo — sin este caso, un hub con
    -- «antelación máxima = 0» se quedaba con CERO huecos y `check` decía too_far mientras
    -- `create` seguía reservando ese mismo instante.
    --
    -- 🔴 appointments#88 — LA ANTELACIÓN SE MIDE EN EL RELOJ DEL NEGOCIO. `c.slot_start` es texto
    -- NAIVE (hora de pared del salón) y `erp_dt` es `::timestamptz`, que interpreta un naive en la
    -- zona de la SESIÓN del runtime (UTC): en un hub de Madrid la ventana se corría el offset
    -- entero y `slots` ofrecía huecos que ya habían pasado, mientras `availability.check` decía
    -- `too_soon` para ESE MISMO instante — el motor contradiciéndose a sí mismo, y `create`
    -- rechazando un segundo después lo que la pantalla acababa de ofrecer.
    -- `:timezone` es la zona IANA del negocio que el runtime bindea en todo el SQL declarativo (hub#1022,
    -- `dispatch.rs`), así que el naive por fin se puede resolver a instante: `::timestamp AT TIME
    -- ZONE :timezone` es «esta lectura de reloj, en el salón», que es exactamente lo que el hueco
    -- significa. Postgres-only a propósito (ADR-0154): no hay función-puente para esto, y el
    -- mismo idioma ya lo usa `cash_register/commands/_auto_close_sessions.sql`. El CAST del bind
    -- no es estilo: sin él Postgres no puede fijar el tipo de `:timezone` y el PREPARE muere.
    -- El COALESCE degrada a `UTC` igual que el runtime (`timezone_name()`) y NO es defensivo por
    -- gusto: `AT TIME ZONE NULL` devuelve NULL, la comparación se vuelve NULL y la query saldría
    -- SIN NINGÚN HUECO — una agenda vacía y muda, que es peor que una agenda desplazada.
    (c.slot_start::timestamp AT TIME ZONE COALESCE(NULLIF(TRIM(CAST(:timezone AS TEXT)), ''), 'UTC'))
        >= erp_dateadd(:now, cfg.notice_min, 'minutes')
    AND (cfg.advance_days = 0
         OR erp_date(:date) <= erp_date(erp_dateadd(:now, cfg.advance_days, 'days')))
    -- 🔴 appointments#118 — EL HORARIO NO SE FILTRA AQUÍ. Hasta #117 esta query recortaba la
    -- lista con las tablas de horario PROPIAS del módulo, y appointments#105 le puso el crucero
    -- `:schedules_answers` para apagarlas cuando la autoridad ya había resuelto la fecha. Las dos
    -- cosas se van juntas: el horario del negocio es de `schedules` (ADR-0392) y una query de un
    -- módulo solo puede nombrar tablas de su módulo, así que este SQL nunca pudo seguir esa
    -- precedencia. Quien pinta la lista pregunta primero a `appointments.availability.day_opening`
    -- —que corre la MISMA función que la puerta— y filtra por los tramos que le devuelve; lo que
    -- sale de aquí son los huecos que quedan libres una vez descontados aviso mínimo, antelación
    -- máxima, tiempo bloqueado, citas y retenciones.
    -- sin tiempo bloqueado (hub entero = staff_id NULL; o el del :staff_id pedido)
    AND NOT EXISTS (
        SELECT 1
        FROM appointments_blocked_time b
        WHERE b.hub_id = :hub_id AND b.is_deleted = 0
          AND (b.staff_id IS NULL OR b.staff_id = ''
               OR (CAST(:staff_id AS TEXT) IS NOT NULL AND b.staff_id = :staff_id))
          AND (
              (b.all_day = 1 AND substr(b.start_datetime, 1, 10) <= substr(c.slot_start, 1, 10)
                             AND substr(c.slot_start, 1, 10) <= substr(b.end_datetime, 1, 10))
              OR (substr(b.start_datetime, 1, 19) < c.slot_end
                  AND substr(b.end_datetime, 1, 19) > c.slot_start)
          )
    )
    -- sin citas vivas que solapen (salvo allow_overlapping); con :staff_id solo su agenda
    AND (
        cfg.allow_overlapping = 1
        OR NOT EXISTS (
            SELECT 1
            FROM appointments_appointment a
            WHERE a.hub_id = :hub_id AND a.is_deleted = 0
              AND a.status NOT IN ('cancelled', 'no_show')
              AND (CAST(:staff_id AS TEXT) IS NULL OR a.staff_id = :staff_id)
              AND substr(a.start_datetime, 1, 19) < c.slot_end
              AND substr(a.end_datetime, 1, 19) > c.slot_start
        )
    )
    -- ni franjas RETENIDAS por una decisión pendiente (appointments#69). Ofrecer un hueco que
    -- `create` va a rechazar un segundo después es peor que no ofrecerlo: Google Actions Center
    -- cuenta un `SLOT_UNAVAILABLE` frecuente como DEFECTO del integrador, no como resultado normal.
    -- `expires_at > :now` decide AL INSTANTE: la tarea programada limpia filas, no libera huecos.
    -- :exclude_hold_ref = la petición que está eligiendo. Su propia retención no puede borrarle de
    -- la lista el hueco que acaba de apartar (mismo papel que :exclude_appointment_id al mover).
    AND (
        cfg.allow_overlapping = 1
        OR NOT EXISTS (
            SELECT 1
            FROM appointments_slot_hold h
            WHERE h.hub_id = :hub_id AND h.is_deleted = 0
              AND h.status = 'held'
              AND erp_dt(h.expires_at) > erp_dt(:now)
              AND COALESCE(CAST(:exclude_hold_ref AS TEXT), '') <> h.source_ref
              AND (CAST(:staff_id AS TEXT) IS NULL OR h.staff_id = '' OR h.staff_id = :staff_id)
              AND substr(h.start_datetime, 1, 19) < c.slot_end
              AND substr(h.end_datetime, 1, 19) > c.slot_start
        )
    )
ORDER BY c.start_min;
