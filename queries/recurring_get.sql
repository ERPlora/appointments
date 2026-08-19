-- Una plantilla de cita recurrente por id (read autoritativa del handler WASM de
-- `recurring.materialize` — ADR-0069, appointments#54).
--
-- Antes la plantilla ENTERA viajaba en el payload (`payload.recurring`), nombres y precio
-- incluidos: el navegador decidía de quién era la serie, qué servicio se prestaba y cuánto valía
-- cada una de sus ocurrencias. Ahora el runtime precarga esta fila por `payload.recurring_id` y el
-- handler contrasta contra ella los ids que le mandan; si no coinciden, no se materializa nada.
--
-- Devuelve los tres ids (que `recurring_list.sql` no trae: esa query es para pintar la lista) y la
-- regla de repetición completa. `is_active` NO se filtra aquí: una plantilla desactivada tiene que
-- llegar al handler para que el rechazo sea `recurring_inactive` y no un `recurring_not_found`
-- que no explica nada. Runtime inyecta :hub_id.
SELECT id, customer_id, customer_name, service_id, service_name, staff_id, staff_name,
       frequency, day_of_week, time, duration_minutes,
       start_date, end_date, max_occurrences, is_active
FROM appointments_recurring
WHERE hub_id = :hub_id AND is_deleted = 0 AND id = :recurring_id
LIMIT 1;
