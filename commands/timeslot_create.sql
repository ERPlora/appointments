-- Crea una franja resolviendo su horario contra el hub inyectado (pm#146).
--
-- `schedule_id` venía del payload sin comprobar nada: una franja de este hub podía colgar de un
-- horario del vecino. La mitad de lectura se cerró en pm#89 (los JOIN de `agenda_status`,
-- `availability_check` y `availability_slots` sobre `appointments_schedule` llevan ya la igualdad
-- de hub), pero acotar el JOIN deja de ENSEÑAR la fila cruzada: no impide crearla.
--
-- Aquí el horario NO es opcional —una franja sin horario no significa nada—, así que la guarda es
-- incondicional: si el horario no es de este hub o está borrado no se escribe nada, y
-- `expect_rows` lo convierte en un error de negocio en vez de un OK mentiroso.
INSERT INTO appointments_schedule_timeslot
  (id, hub_id, schedule_id, day_of_week, start_time, end_time, is_active,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT
  :new_id, :hub_id, s.id, :day_of_week, :start_time, :end_time, 1,
  0, :current_user_id, :current_user_id, :now, :now
FROM appointments_schedule s
WHERE s.id = :schedule_id AND s.hub_id = :hub_id AND s.is_deleted = 0;
