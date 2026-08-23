-- Edita la plantilla EN SITIO (appointments#15). Es la rama del corte en la PRIMERA ocurrencia:
-- «esta y las siguientes» desde el principio es la serie entera, y no hay nada que partir.
--
-- Partir igualmente dejaría una plantilla cerrada con `end_date < start_date`: una fila que no
-- genera nada y que todas las pantallas de lista seguirían pintando.
UPDATE appointments_recurring
   SET time             = :time,
       duration_minutes = :duration_minutes,
       updated_by       = :current_user_id,
       updated_at       = :now
 WHERE hub_id = :hub_id AND id = :recurring_id AND is_deleted = 0;
