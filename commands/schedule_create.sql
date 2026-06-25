-- Alta de plantilla de horario (Tier 0). Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
INSERT INTO appointments_schedule
  (id, hub_id, name, description, is_default, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
-- GUARDARRAÍL QA (2026-06-25): el binder del runtime no aplica los defaults del JSON Schema
-- (gap sistémico P0); COALESCE espeja los DEFAULT de la migración para el alta mínima.
VALUES
  (:new_id, :hub_id, :name, COALESCE(:description, ''), COALESCE(:is_default, 0), 1,
   0, :current_user_id, :current_user_id, :now, :now);
