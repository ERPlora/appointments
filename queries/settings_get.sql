-- Ajustes de reservas del hub (singleton). Runtime inyecta :hub_id.
SELECT id, default_duration, min_booking_notice, max_advance_booking, allow_overlapping,
       send_reminders, reminder_hours_before, allow_customer_cancellation,
       cancellation_notice_hours, calendar_start_hour, calendar_end_hour, slot_interval
FROM appointments_settings
WHERE hub_id = :hub_id AND is_deleted = 0
LIMIT 1;
