-- appointments#69: la retención cumplió su función — la petición que la pidió ya es una cita.
--
-- Sub-paso interno de `_book_from_request`, en la MISMA transacción que la reserva: o se crean la
-- cita y el consumo, o no se crea ninguno de los dos. Si se dejase para después, un fallo entre
-- medias dejaría la franja apartada por una petición que ya no espera nada — la retención
-- huérfana que Lightspeed documenta en sus propias notas de versión (abandonar la venta no
-- cancelaba el layaway) y que sin caducidad no reclama nadie. Aquí caducaría sola de todas formas,
-- pero mientras tanto estaría cerrando el hueco de su propia cita.
--
-- `consumed` no es `released`: soltar es «se decidió que no», consumir es «se decidió que sí».
-- Distinguirlos es lo que permite saber si el TTL está bien elegido, en vez de solo cuántos se
-- perdieron.
--
-- No filtra por `source`: la referencia de la petición ya es única, y el handler que emite esta
-- intención sabe QUÉ petición reservó, no de qué módulo venía. Preguntárselo obligaría a
-- `appointments` a saber que existe `whatsapp_inbox`, que es exactamente lo que el par
-- `source`/`source_ref` evita.
UPDATE appointments_slot_hold SET
    status     = 'consumed',
    updated_by = :current_user_id,
    updated_at = :now
WHERE hub_id = :hub_id AND source_ref = :source_ref
  AND status = 'held' AND is_deleted = 0;
