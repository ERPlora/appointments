-- Soft-delete de cita (§2.5). Portado de AppointmentService.delete.
-- La guarda "no borrar completed/in_progress" es validación previa → ver WASM-TODO
-- (delete_guard); aquí el WHERE evita re-borrar y filtra por hub.
UPDATE appointments_appointment
SET is_deleted = 1,
    deleted_at = :now,
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status NOT IN ('completed', 'in_progress');
