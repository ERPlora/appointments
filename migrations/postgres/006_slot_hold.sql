-- 006_slot_hold.sql — appointments#69: una decisión pendiente APARTA su franja.
--
-- El problema: entre que un cliente escribe («¿puedo mañana a las diez?») y alguien del salón
-- aprueba la petición en la bandeja pasan HORAS, y el mostrador vende esa hora por la puerta.
-- Hasta ahora el choque se gestionaba después (appointments#38: la reserva se rechaza y la
-- petición vuelve a `pending_review` con el motivo). Funciona y nunca sobrecupa, pero es gestionar
-- el choque en vez de evitarlo — y el mercado lo evita: Square retiene la franja 15 min mientras
-- se completa la reserva, Phorest 7 en su hueco de retención, Odoo deja la pre-reserva bloqueando
-- el hueco, y Google Actions Center trata un `SLOT_UNAVAILABLE` frecuente como DEFECTO tuyo.
--
-- Una retención NO es una cita: nadie ha reservado nada, no tiene número, no entra en la agenda
-- ni en el historial, y **caduca sola**. Por eso tabla propia y no una fila
-- `appointments_appointment` con un `status` nuevo — que habría metido un estado fantasma en el
-- ciclo pending→confirmed→…, en la numeración y en todas las queries del módulo.
--
-- La forma es la de `tables_table_hold` (tables#12) y no es casualidad: es el mismo problema —
-- «otro módulo necesita que este aparte un recurso suyo»— y la misma solución modular. La
-- referencia a quien la pidió es OPACA (`source` + `source_ref`): `appointments` no aprende qué es
-- una petición de WhatsApp, solo que alguien identificable apartó un hueco y puede soltarlo. Un
-- hub sin bandeja no se entera de que esta tabla existe.
CREATE TABLE IF NOT EXISTS appointments_slot_hold (
    id             TEXT PRIMARY KEY,
    hub_id         TEXT NOT NULL,
    -- La agenda que se aparta. Vacío = agenda global (choca con cualquiera), misma convención que
    -- `appointments_blocked_time.staff_id` y que el gate de solape.
    staff_id       TEXT NOT NULL DEFAULT '',
    -- Quién pidió la retención y sobre qué fila suya. `(hub_id, source, source_ref)` es la clave
    -- natural: el outbox es at-least-once y reabrir el panel dos veces NO puede apartar dos huecos.
    source         TEXT NOT NULL,
    source_ref     TEXT NOT NULL,
    -- La franja apartada, con los MISMOS nombres que una cita: el handler la mide con la misma
    -- función que mide el solape, y darles nombres distintos habría sido pedir dos implementaciones
    -- de «[inicio, fin) se cruzan» y que una de las dos se olvidara de los bordes.
    start_datetime TEXT NOT NULL,
    end_datetime   TEXT NOT NULL,
    -- Cuándo caduca la RETENCIÓN — no la franja. Son dos relojes distintos y confundirlos es el
    -- fallo clásico: aparto las 10:00 de mañana, pero mi derecho a apartarlas dura 15 minutos.
    -- Es lo único que impide la «retención fantasma» que cuentan los foros (Zoho Bookings: huecos
    -- que se quedan bloqueados «hasta que alguien borre la cita a mano»).
    expires_at     TEXT NOT NULL,
    -- Lo que la agenda PINTA sobre el hueco. Sin un nombre, un hueco que desaparece es un bug:
    -- el propio artículo de soporte de Square lista su retención de 15 min entre las causas de
    -- huecos que «aparecen no disponibles sin motivo».
    label          TEXT NOT NULL DEFAULT '',
    -- `held` retiene · `consumed` la petición acabó siendo cita · `released` la soltaron (se
    -- rechazó, se eligió otra hora) · `expired` se acabó el tiempo y la barrió la tarea programada.
    -- `released` y `expired` se distinguen a propósito: soltar es una decisión, vencer es que
    -- nadie decidió — y sin la distinción no hay forma de saber si el TTL está bien elegido.
    status         TEXT NOT NULL DEFAULT 'held',
    is_deleted     INTEGER NOT NULL DEFAULT 0,
    deleted_at     TEXT,
    created_by     TEXT,
    updated_by     TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT,
    CHECK (status IN ('held', 'consumed', 'released', 'expired'))
);

-- Idempotencia del apartado: la misma petición no aparta dos huecos. Al elegir otra hora, el
-- UPSERT mueve ESTA retención en vez de dejar la anterior colgada.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_hold_source
    ON appointments_slot_hold (hub_id, source, source_ref);

-- Las dos lecturas del día: «¿qué hay apartado en la agenda de esta profesional?» (create,
-- reschedule, disponibilidad) y «¿qué retenciones ya vencieron?» (la barrida programada).
CREATE INDEX IF NOT EXISTS ix_appointments_hold_live
    ON appointments_slot_hold (hub_id, staff_id, status, start_datetime);
CREATE INDEX IF NOT EXISTS ix_appointments_hold_expiry
    ON appointments_slot_hold (hub_id, status, expires_at);

-- Cuánto dura una retención, en minutos. 15 = lo que retiene Square mientras el cliente completa
-- la reserva, y el defecto que llevan las apps de reserva de Shopify; Phorest usa 7 y no lo deja
-- tocar. 0 apaga la retención entera, que es lo que quiere un hub sin bandeja.
--
-- Se elige el TTL CORTO, no el largo (GlossGenius deja la petición 48 h en el calendario), porque
-- nuestro reloj empieza cuando una persona ABRE el panel de reserva y elige el hueco — no cuando
-- llega el mensaje. Un mensaje parseado por el modelo no trae ni profesional ni hora: no hay
-- ninguna franja que apartar hasta que alguien la elige. Y un TTL largo es justo el que produce
-- la retención fantasma de los foros.
ALTER TABLE appointments_settings
    ADD COLUMN IF NOT EXISTS hold_minutes INTEGER NOT NULL DEFAULT 15;
