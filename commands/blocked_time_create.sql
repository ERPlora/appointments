-- Alta de tiempo bloqueado (Tier 0). staff_id puede ser NULL (afecta a todo el hub).
-- La expansión de bloqueos recurrentes (recurrence_rule) y la detección de conflictos
-- (conflicts_with) son lógica → ver WASM-TODO. Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
INSERT INTO appointments_blocked_time
  (id, hub_id, title, block_type, start_datetime, end_datetime, all_day, staff_id,
   reason, is_recurring, recurrence_rule,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :title, :block_type, :start_datetime, :end_datetime, :all_day, :staff_id,
   :reason, :is_recurring, :recurrence_rule,
   0, :current_user_id, :current_user_id, :now, :now);
