-- Lista de citas del hub para un día concreto (con filtros opcionales por estado/staff).
-- Runtime inyecta :hub_id. Portado de AppointmentService.list.
-- El filtro de día se aplica como rango [:day_start, :day_end) sobre start_datetime (ISO 8601).
-- Binds opcionales: :status='' = todos; :staff_id='' = cualquiera. :limit acota el resultado.
SELECT id, appointment_number, customer_name, customer_phone, customer_email,
       service_name, staff_name, start_datetime, end_datetime,
       duration_minutes, status
FROM appointments_appointment
WHERE hub_id = :hub_id AND is_deleted = 0
  AND start_datetime >= :day_start
  AND start_datetime <  :day_end
  AND (:status   = '' OR status   = :status)
  AND (:staff_id = '' OR staff_id = :staff_id)
ORDER BY start_datetime ASC
LIMIT :limit;
