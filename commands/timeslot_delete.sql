-- Soft-delete de un tramo horario (§2.5).
UPDATE appointments_schedule_timeslot
SET is_deleted = 1, deleted_at = :now, is_active = 0,
    updated_by = :current_user_id, updated_at = :now
WHERE id = :timeslot_id AND hub_id = :hub_id AND is_deleted = 0;
