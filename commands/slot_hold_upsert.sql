-- appointments#69: aparta una franja mientras alguien decide.
--
-- IDEMPOTENTE por la clave natural `(hub_id, source, source_ref)`: reabrir el panel de la misma
-- petición, o que el outbox reentregue un evento, NO puede apartar dos huecos. Y elegir otra hora
-- MUEVE esta misma retención en vez de dejar la anterior colgada — que es como se fabrica la
-- «retención fantasma» que los foros de WooCommerce y Zoho Bookings describen como el fallo caro:
-- huecos bloqueados que solo se liberan a mano.
--
-- **El TTL lo pone el SERVIDOR, no el caller.** `expires_at` se calcula aquí, desde
-- `appointments_settings.hold_minutes`, y el payload no tiene forma de proponerlo. Es la regla de
-- Google Actions Center llevada al extremo barato: allí el cliente propone `lease_expiration_time`
-- y el servidor puede acortarlo si es excesivo; aquí directamente no se pregunta. Un caller que
-- eligiese su propia caducidad podría apartar una agenda entera durante un mes.
--
-- `hold_minutes = 0` apaga la retención: el INSERT no encuentra fila y no aparta nada. Un hub que
-- no quiere retener no tiene que saber que esta tabla existe.
--
-- Se guarda un INSTANTE absoluto — la suma de los minutos sobre el `:now` que inyecta el
-- runtime—, nunca «hace N minutos» calculado al leer: comparar un reloj local contra un instante
-- UTC es el bug de HPOS de WooCommerce, que cancelaba los pedidos al instante ignorando su propio
-- ajuste de 60 minutos.
INSERT INTO appointments_slot_hold (
    id, hub_id, staff_id, source, source_ref, start_datetime, end_datetime,
    expires_at, label, status, is_deleted, created_by, updated_by, created_at, updated_at
)
SELECT
    :new_id, :hub_id, COALESCE(CAST(:staff_id AS TEXT), ''), :source, :source_ref,
    :start_datetime, :end_datetime,
    erp_dateadd(:now, c.hold_minutes, 'minutes'),
    COALESCE(CAST(:label AS TEXT), ''), 'held',
    0, :current_user_id, :current_user_id, :now, :now
FROM (
    SELECT COALESCE(MAX(hold_minutes), 15) AS hold_minutes
    FROM appointments_settings
    WHERE hub_id = :hub_id AND is_deleted = 0
) c
WHERE c.hold_minutes > 0
ON CONFLICT (hub_id, source, source_ref) DO UPDATE SET
    staff_id       = EXCLUDED.staff_id,
    start_datetime = EXCLUDED.start_datetime,
    end_datetime   = EXCLUDED.end_datetime,
    expires_at     = EXCLUDED.expires_at,
    label          = EXCLUDED.label,
    status         = 'held',
    is_deleted     = 0,
    updated_by     = EXCLUDED.updated_by,
    updated_at     = EXCLUDED.updated_at;
