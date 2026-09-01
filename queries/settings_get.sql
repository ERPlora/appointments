-- Ajustes de reservas del hub (singleton). Runtime inyecta :hub_id.
SELECT id, default_duration, min_booking_notice, max_advance_booking,
       -- appointments#79: los flags cruzan el JSON como BOOLEANO en las dos direcciones. En reposo
       -- son INTEGER 0/1 (contrato de fila §2.5), pero `settings.upsert` los declara `boolean`, así
       -- que devolverlos crudos hacía que la fila leída no se pudiera volver a guardar (422). El
       -- runtime bindea un booleano JSON como 0/1 (hub#208) y serializa una expresión booleana como
       -- `true`/`false` (crates/db §"BOOL"), así que el viaje de ida y vuelta cierra sin tocar la BD.
       allow_overlapping <> 0            AS allow_overlapping,
       send_reminders <> 0               AS send_reminders,
       reminder_hours_before, allow_customer_cancellation <> 0 AS allow_customer_cancellation,
       cancellation_notice_hours, calendar_start_hour, calendar_end_hour, slot_interval,
       -- appointments#69. Sale por aquí por DOS razones: la pestaña de Ajustes tiene que pintar
       -- el valor guardado (si no, el formulario enseñaría el defecto del schema para siempre y
       -- guardarlo lo pisaría), y el panel de reserva necesita el mismo número para que la cuenta
       -- atrás en pantalla sea el reloj que de verdad está corriendo en el servidor.
       hold_minutes
FROM appointments_settings
WHERE hub_id = :hub_id AND is_deleted = 0
LIMIT 1;
