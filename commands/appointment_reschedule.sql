-- Reagendado de cita (Tier 0). Portado de Appointment.reschedule(new_start, new_duration).
-- Guarda: solo pending|confirmed (WHERE). El nuevo end_datetime (= start + duration) lo
-- calcula el SDK/UI y se pasa ya resuelto. El chequeo de solape (allow_overlapping) es
-- lógica de validación → ver WASM-TODO (mismo motor que create).
UPDATE appointments_appointment
SET start_datetime   = :start_datetime,
    end_datetime     = :end_datetime,
    duration_minutes = :duration_minutes,
    updated_by       = :current_user_id,
    updated_at       = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status IN ('pending', 'confirmed');
