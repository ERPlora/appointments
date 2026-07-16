-- PG-compat (auditoría pm#16, 07-17): los binds BOOLEANOS del schema van envueltos en
-- CASE WHEN :x THEN 1 WHEN NOT :x THEN 0 END — las columnas son INTEGER 0/1 por contrato
-- (§2.5) y Postgres NO castea boolean→bigint (SQLite sí lo toleraba). El tri-estado
-- preserva NULL para los COALESCE de opcionales.
-- Alta de tiempo bloqueado (Tier 0). staff_id puede ser NULL (afecta a todo el hub).
-- La expansión de bloqueos recurrentes (recurrence_rule) y la detección de conflictos
-- (conflicts_with) son lógica → ver WASM-TODO. Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
INSERT INTO appointments_blocked_time
  (id, hub_id, title, block_type, start_datetime, end_datetime, all_day, staff_id,
   reason, is_recurring, recurrence_rule,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :title, :block_type, :start_datetime, :end_datetime, CASE WHEN :all_day THEN 1 WHEN NOT :all_day THEN 0 END, :staff_id,
   :reason, CASE WHEN :is_recurring THEN 1 WHEN NOT :is_recurring THEN 0 END, :recurrence_rule,
   0, :current_user_id, :current_user_id, :now, :now);
