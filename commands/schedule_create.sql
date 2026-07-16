-- PG-compat (auditoría pm#16, 07-17): los binds BOOLEANOS del schema van envueltos en
-- CASE WHEN :x THEN 1 WHEN NOT :x THEN 0 END — las columnas son INTEGER 0/1 por contrato
-- (§2.5) y Postgres NO castea boolean→bigint (SQLite sí lo toleraba). El tri-estado
-- preserva NULL para los COALESCE de opcionales.
-- Alta de plantilla de horario (Tier 0). Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
INSERT INTO appointments_schedule
  (id, hub_id, name, description, is_default, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :name, :description, CASE WHEN :is_default THEN 1 WHEN NOT :is_default THEN 0 END, 1,
   0, :current_user_id, :current_user_id, :now, :now);
