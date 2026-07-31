-- Citas vivas del mismo día que :start_datetime (ADR-0069 read autoritativa del handler WASM de
-- create — appointments#110). Antes el solape se validaba solo contra `payload.existing_appointments`
-- (aportado por el caller) y, si el caller omitía esa lectura, el handler no detectaba solape.
-- Ahora el runtime precarga esta query vía `reads` y el handler prioriza `context.reads`.
--
-- Trae todas las citas vivas del DÍA (no solo la franja): el runtime solo permite `payload.<campo>`
-- literales en `reads.params`, así que no se puede computar end = start + duration aquí. El handler
-- hace el filtrado fino de solape por ventana en `prepare_appointment` (líneas 397-409).
--
-- Mismas reglas que el handler `candidates_from`: se excluyen cancelled/no_show y borradas.
-- :staff_id opcional (vacío/null = agenda global). erp_date = función-puente portable (ADR-0007 §4a).
SELECT id, appointment_number, staff_id, start_datetime, end_datetime, status
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND status NOT IN ('cancelled', 'no_show')
  AND (COALESCE(:staff_id, '') = '' OR staff_id = :staff_id)
  AND erp_date(start_datetime) = erp_date(:start_datetime)
ORDER BY start_datetime ASC;
