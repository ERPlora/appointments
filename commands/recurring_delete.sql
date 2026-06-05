-- Soft-delete / desactivación de plantilla recurrente (§2.5). No borra las citas ya generadas.
UPDATE appointments_recurring
SET is_deleted = 1, deleted_at = :now, is_active = 0,
    updated_by = :current_user_id, updated_at = :now
WHERE id = :recurring_id AND hub_id = :hub_id AND is_deleted = 0;
