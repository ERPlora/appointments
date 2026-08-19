-- Ajustes de reservas del hub (singleton). Runtime inyecta :hub_id.
SELECT id, default_duration, min_booking_notice, max_advance_booking, allow_overlapping,
       send_reminders, reminder_hours_before, allow_customer_cancellation,
       cancellation_notice_hours, calendar_start_hour, calendar_end_hour, slot_interval,
       -- appointments#69. Sale por aquí por DOS razones: la pestaña de Ajustes tiene que pintar
       -- el valor guardado (si no, el formulario enseñaría el defecto del schema para siempre y
       -- guardarlo lo pisaría), y el panel de reserva necesita el mismo número para que la cuenta
       -- atrás en pantalla sea el reloj que de verdad está corriendo en el servidor.
       hold_minutes
FROM appointments_settings
WHERE hub_id = :hub_id AND is_deleted = 0
LIMIT 1;
