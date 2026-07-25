-- Alta de plantilla de horario (Tier 0). Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
-- :is_default (schema boolean) → INTEGER 0/1 con CASE WHEN: Postgres no castea boolean→integer.
INSERT INTO appointments_schedule
  (id, hub_id, name, description, is_default, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :name, :description, CASE WHEN :is_default THEN 1 ELSE 0 END, 1,
   0, :current_user_id, :current_user_id, :now, :now);
