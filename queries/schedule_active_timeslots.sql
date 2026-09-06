-- Horario COMERCIAL vivo del hub, sin filtrar por día (read autoritativa del handler WASM de
-- `create`, `reschedule`, `bulk_create` y `recurring.materialize` — ADR-0069, appointments#89).
--
-- Why it takes no parameter at all: `reads.params` can only bind a literal `payload.<field>`, and
-- none of the four commands carries the id of a timetable in its payload — nor could a BATCH or a
-- SERIES ask for «the stretches of THIS day», since they book across several. (It used to be told
-- apart from `appointments.schedules.timeslots`, which asked for a `:schedule_id`; that query was
-- retired with the rest of this module's hours surface — appointments#117.) Every live stretch of
-- the hub comes back and the fine cut (weekday and the [start, end] window) is the handler's — the
-- only one that can cross WALL time with an INSTANT, because it needs the business's zone
-- (`context.timezone`, hub#1022) and the IANA table the guest carries inside.
--
-- Es EL MISMO conjunto que mira `availability_check.sql` para calcular `outside_schedule`: tramos
-- vivos y activos de plantillas vivas y activas, del hub, SIN join con la profesional (el horario
-- es del negocio; si además esa persona trabaja esa hora es otra regla — appointments#98). Que la
-- pantalla y la puerta miren lo mismo es lo que impide que una avise de algo que la otra permite.
--
-- El volumen es el de una semana de horarios: decenas de filas, no miles.
SELECT t.id, t.day_of_week, t.start_time, t.end_time
FROM appointments_schedule_timeslot t
JOIN appointments_schedule sc ON sc.id = t.schedule_id AND sc.hub_id = :hub_id
WHERE t.hub_id = :hub_id
  AND t.is_deleted = 0 AND t.is_active = 1
  AND sc.is_deleted = 0 AND sc.is_active = 1
ORDER BY t.day_of_week ASC, t.start_time ASC;
