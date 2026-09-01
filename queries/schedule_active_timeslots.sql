-- Horario COMERCIAL vivo del hub, sin filtrar por día (read autoritativa del handler WASM de
-- `create`, `reschedule`, `bulk_create` y `recurring.materialize` — ADR-0069, appointments#89).
--
-- Por qué existe, habiendo ya `appointments.schedules.timeslots`: aquélla pide `:schedule_id`, y
-- `reads.params` solo sabe bindear un `payload.<campo>` literal — ninguno de los cuatro comandos
-- lleva el id de la plantilla en su payload. Y un LOTE o una SERIE reservan en varios días, así
-- que tampoco se puede pedir «los tramos de ESTE día». Se traen todos los tramos activos del hub
-- y el corte fino (día de la semana y ventana [inicio, fin]) lo hace el handler, que es el único
-- que puede cruzar hora de PARED con un INSTANTE: necesita la zona del negocio (`context.timezone`,
-- hub#1022) y la tabla IANA que el guest lleva dentro.
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
