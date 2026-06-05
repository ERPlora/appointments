-- Alta de tramo horario en una plantilla (Tier 0). El par (schedule_id, day_of_week,
-- start_time) es único — lo garantiza uq_schedule_timeslot. La validación start<end es
-- lógica trivial que la UI/SDK comprueba. Runtime inyecta :new_id/:hub_id/:current_user_id/:now.
INSERT INTO appointments_schedule_timeslot
  (id, hub_id, schedule_id, day_of_week, start_time, end_time, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :schedule_id, :day_of_week, :start_time, :end_time, 1,
   0, :current_user_id, :current_user_id, :now, :now);
