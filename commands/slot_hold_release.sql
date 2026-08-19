-- appointments#69: suelta la franja apartada — se eligió otra hora, se rechazó la petición, o
-- quien la tenía cerró el panel.
--
-- Idempotente: soltar dos veces no rompe nada (el segundo UPDATE no encuentra fila `held`). Solo
-- toca retenciones VIVAS: una ya `consumed` (la petición acabó siendo cita) no se degrada a
-- `released`, o perderíamos la traza de que aquella retención sí sirvió para algo — que es el dato
-- con el que se sabe si el TTL está bien elegido.
UPDATE appointments_slot_hold SET
    status     = 'released',
    updated_by = :current_user_id,
    updated_at = :now
WHERE hub_id = :hub_id AND source = :source AND source_ref = :source_ref
  AND status = 'held' AND is_deleted = 0;
