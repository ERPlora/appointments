-- _mark_converted: vincula una cita con la venta que nació de ella (hub#777).
-- Listener de `sales.sale.created_from_appointment`: el TPV cobra una venta con appointment_id,
-- y este UPDATE escribe el sale_id sobre la cita para trazabilidad («¿esta cita se cobró?»).
-- Solo trazabilidad: no cambia el status (la autoridad sobre el estado sigue siendo manual).
-- Runtime inyecta :hub_id; :appointment_id y :sale_id vienen del evento.
UPDATE appointments_appointment
   SET converted_sale_id = :sale_id,
       updated_at = :now
 WHERE id = :appointment_id
   AND hub_id = :hub_id
   AND is_deleted = 0;
