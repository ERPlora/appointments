-- Cierra la mitad VIEJA de una serie partida (appointments#15): la plantilla deja de generar
-- ocurrencias a partir del corte. Es el `UNTIL` de RFC 5545, y lo que Google escribe en la serie
-- original antes de insertar la nueva.
--
-- No se desactiva ni se borra: la mitad vieja sigue siendo la dueña de las citas ya prestadas, que
-- son historia del negocio. Solo deja de mirar hacia adelante.
UPDATE appointments_recurring
   SET end_date   = :end_date,
       updated_by = :current_user_id,
       updated_at = :now
 WHERE hub_id = :hub_id AND id = :recurring_id AND is_deleted = 0;
