-- Edición de los datos de una cita (Tier 0; la UI envía el conjunto completo de campos).
-- Portado de AppointmentService.update. NO recalcula end_datetime cuando cambian
-- start/duration: ese recálculo (start + duration → end) lo resuelve el SDK/UI antes de
-- llamar, o el reagendado vía appointment_reschedule. Runtime inyecta :hub_id/:current_user_id/:now.
UPDATE appointments_appointment SET
  customer_name    = :customer_name,
  customer_phone   = :customer_phone,
  customer_email   = :customer_email,
  service_id       = :service_id,
  service_name     = :service_name,
  staff_id         = :staff_id,
  staff_name       = :staff_name,
  start_datetime   = :start_datetime,
  end_datetime     = :end_datetime,
  duration_minutes = :duration_minutes,
  notes            = :notes,
  internal_notes   = :internal_notes,
  updated_by       = :current_user_id,
  updated_at       = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0;
