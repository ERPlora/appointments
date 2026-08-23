-- Mueve una ocurrencia ya reservada al horario de la mitad NUEVA de la serie (appointments#15).
--
-- Se reescribe la fila EN SITIO en vez de borrarla y volver a materializar: la cita conserva su id,
-- su número de cita y su historial, que es justo lo que la peluquera necesita en el sillón (la
-- fórmula de la última visita cuelga de esa fila). Borrar y recrear tira todo eso al suelo.
--
-- El `WHERE` es la puerta, no el handler: solo se mueve lo que sigue siendo un PLAN
-- (`pending|confirmed`). Una cita empezada, completada, anulada o convertida en venta no se toca
-- ni aunque el handler se equivocara — una convertida arrastra registro fiscal y la cadena
-- VeriFactu no se reescribe (ADR-0331).
--
-- `updated_at = :now` fija la ejecución: `_history_reschedule.sql` cuelga de esa marca, así que un
-- movimiento que no ocurre NO deja rastro de auditoría.
UPDATE appointments_appointment
   SET recurring_id   = :recurring_id,
       start_datetime = :start_datetime,
       end_datetime   = :end_datetime,
       duration_minutes = :duration_minutes,
       updated_by     = :current_user_id,
       updated_at     = :now
 WHERE hub_id = :hub_id
   AND id = :appointment_id
   AND is_deleted = 0
   AND status IN ('pending', 'confirmed')
   AND (converted_sale_id IS NULL OR converted_sale_id = '');
