-- Soft-delete de un tiempo bloqueado (§2.5).
UPDATE appointments_blocked_time
SET is_deleted = 1, deleted_at = :now,
    updated_by = :current_user_id, updated_at = :now
WHERE id = :blocked_time_id AND hub_id = :hub_id AND is_deleted = 0;
