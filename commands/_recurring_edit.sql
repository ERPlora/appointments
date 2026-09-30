-- Edita la plantilla EN SITIO (appointments#15). Es la rama del corte en la PRIMERA ocurrencia:
-- «esta y las siguientes» desde el principio es la serie entera, y no hay nada que partir.
--
-- Partir igualmente dejaría una plantilla cerrada con `end_date < start_date`: una fila que no
-- genera nada y que todas las pantallas de lista seguirían pintando.
-- appointments#90: la PAUTA se guarda aquí también. El handler siempre manda las cuatro claves
-- (hereda de la plantilla lo que no se pidió cambiar), así que esta rama no puede quedarse con la
-- hora nueva y la frecuencia vieja — una serie que nadie pidió.
-- appointments#248: the professional too — the template's own when the edit changes none, the new
-- one (name from the staff read) when «this and following» hands the series to her.
UPDATE appointments_recurring
   SET time             = :time,
       duration_minutes = :duration_minutes,
       frequency        = :frequency,
       day_of_week      = :day_of_week,
       staff_id         = :staff_id,
       staff_name       = :staff_name,
       updated_by       = :current_user_id,
       updated_at       = :now
 WHERE hub_id = :hub_id AND id = :recurring_id AND is_deleted = 0;
