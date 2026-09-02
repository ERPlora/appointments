-- Cancela una ocurrencia que la PAUTA nueva deja sin sitio (appointments#90).
--
-- Cambiar `frequency` o `day_of_week` mueve la serie a días DISTINTOS, así que no hay
-- correspondencia 1:1 con lo ya reservado: lo que sigue cayendo en la pauta nueva se mueve
-- (`_recurring_move_occurrence`) y lo que no, se cancela aquí.
--
-- CANCELAR, no borrar. Borrar libera el día en el índice único parcial de la 005, pero tira el
-- número de cita, el historial y el rastro en la ficha de la clienta — y el historial es de la
-- clienta, no nuestro. Cancelar es además lo ÚNICO que ofrece el vertical de salón: Fresha,
-- Vagaro, Square y Booksy no dejan cambiar la pauta de una serie y obligan a cancelar y volver a
-- reservar. Lo cancelado se queda colgando de la mitad VIEJA de la serie, así que ni la read de
-- ocurrencias de la mitad nueva lo ve ni ese índice choca con nada.
--
-- El `WHERE` es LA MISMA PUERTA que la de `_recurring_move_occurrence.sql`, palabra por palabra, y
-- eso es el punto: `_cancel_row` habría sido más cómodo y más ancho —su guarda solo conoce
-- `cancelled`/`completed`—, así que un cambio de pauta habría cancelado una cita EN CURSO o ya
-- convertida en venta, que arrastra registro fiscal y cadena VeriFactu (ADR-0331).
--
-- `updated_at = :now` fija la ejecución: `_history_cancel.sql` cuelga de esa marca, así que una
-- cancelación que no ocurre NO deja rastro de auditoría.
UPDATE appointments_appointment
   SET status = 'cancelled',
       cancelled_at = :now,
       cancellation_reason = :reason,
       updated_by = :current_user_id,
       updated_at = :now
 WHERE hub_id = :hub_id
   AND id = :appointment_id
   AND is_deleted = 0
   AND status IN ('pending', 'confirmed')
   AND (converted_sale_id IS NULL OR converted_sale_id = '');
