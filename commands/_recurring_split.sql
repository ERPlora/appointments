-- La mitad NUEVA de una serie partida (appointments#15). Arranca en el día del corte con los
-- valores nuevos y los MISMOS vínculos: partir una serie no cambia de quién es ni qué se presta.
--
-- `split_from_id` deja el rastro de dónde salió (migración 007). Runtime inyecta :hub_id/
-- :current_user_id/:now; el id lo decide el handler (`context.new_ids`), porque las ocurrencias
-- que se mueven en esta misma transacción tienen que apuntar a él.
INSERT INTO appointments_recurring
  (id, hub_id, customer_id, customer_name, service_id, service_name, staff_id, staff_name,
   frequency, day_of_week, time, duration_minutes, start_date, end_date, max_occurrences,
   split_from_id, is_active, is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :customer_id, :customer_name, :service_id, :service_name, :staff_id, :staff_name,
   :frequency, :day_of_week, :time, :duration_minutes, :start_date, :end_date, :max_occurrences,
   :split_from_id, 1, 0, :current_user_id, :current_user_id, :now, :now);
