-- Detalle completo de una cita. Runtime inyecta :hub_id. Portado de AppointmentService.get.
SELECT id, appointment_number, customer_id, customer_name, customer_phone, customer_email,
       staff_id, staff_name, service_id, service_name, service_price,
       start_datetime, end_datetime, duration_minutes, status,
       notes, internal_notes, booked_online,
       cancelled_at, cancellation_reason
FROM appointments_appointment
WHERE hub_id = :hub_id AND is_deleted = 0 AND id = :appointment_id;
