-- Bloqueos vivos que pueden tocar el día de :start_datetime (read autoritativa del handler WASM de
-- `create` — ADR-0069, appointments#10/#13). Antes `create` solo miraba el SOLAPE con otras citas:
-- se podía reservar encima de un festivo, de un cierre o de la formación de una profesional, porque
-- el bloqueo solo lo consultaba `availability.check`, que es informativa y no bloquea nada.
--
-- Trae los bloqueos del DÍA (no de la franja exacta): igual que `appointments_conflicting.sql`, el
-- runtime solo admite `payload.<campo>` literales en `reads.params`, así que aquí no se puede
-- calcular end = start + duration. El corte fino por ventana [start, end) lo hace el handler
-- (`blocked_refusal`), que sí conoce la duración ya resuelta contra el catálogo.
--
-- `staff_id` NULL/'' en la fila = bloqueo de TODO el hub (festivo, cierre) y afecta a cualquiera;
-- con profesional, solo a esa persona. Un bloqueo de otra profesional no es asunto de esta cita.
--
-- Estos bloqueos son instantes ISO 8601 (columnas `start_datetime`/`end_datetime` con tz), NO hora
-- de pared, así que compararlos NO necesita la zona horaria del negocio — por eso esta regla sí
-- puede entrar mientras hub#1022 mantiene fuera de alcance el horario comercial y el turno de la
-- profesional, que sí son hora de pared. erp_date = función-puente portable (ADR-0007 §4a).
SELECT id, title, block_type, start_datetime, end_datetime, all_day, staff_id, reason
FROM appointments_blocked_time
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND (COALESCE(staff_id, '') = '' OR staff_id = :staff_id)
  AND erp_date(start_datetime) <= erp_date(:start_datetime)
  AND erp_date(end_datetime)   >= erp_date(:start_datetime)
ORDER BY start_datetime ASC;
