-- Soft-delete de plantilla de horario (§2.5). Sus tramos quedan huérfanos pero también
-- se filtran por is_deleted en sus queries; un borrado en cascada lógico de los tramos
-- (batch sobre N filas) se documenta como tarea de runtime — ver WASM-TODO.
UPDATE appointments_schedule
SET is_deleted = 1, deleted_at = :now, is_active = 0,
    updated_by = :current_user_id, updated_at = :now
WHERE id = :schedule_id AND hub_id = :hub_id AND is_deleted = 0;
