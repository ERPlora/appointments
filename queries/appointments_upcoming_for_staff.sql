-- Citas vivas POR DELANTE de una profesional (read autoritativa del handler WASM de `bulk_create`
-- y de `recurring.materialize` — ADR-0069, appointments#10).
--
-- Es la gemela sin-día de `appointments_conflicting.sql`, y existe por lo mismo que
-- `blocked_times_upcoming.sql`: un lote y una serie reservan en varios días y `reads.params` solo
-- admite un `payload.<campo>` de primer nivel, así que «las citas de CADA uno de estos días» no se
-- puede pedir. Hasta ahora esos dos comandos comparaban el solape contra
-- `payload.existing_appointments` — una lectura que armaba el navegador, o sea ninguna garantía.
--
-- `:staff_id` sí es de primer nivel desde appointments#54 (un lote es UNA profesional), así que se
-- filtra por ella; las citas sin profesional (agenda global) también entran, porque ocupan el
-- hueco de cualquiera. El corte fino por ventana [start, end) lo hace el handler.
--
-- Mismas reglas que `candidates_from`: se excluyen cancelled/no_show y borradas. `:now` lo inyecta
-- el runtime (system_params). erp_dt = función-puente portable (ADR-0007 §4a).
SELECT id, appointment_number, staff_id, start_datetime, end_datetime, status
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND status NOT IN ('cancelled', 'no_show')
  AND (COALESCE(staff_id, '') = '' OR staff_id = :staff_id)
  AND erp_dt(end_datetime) >= erp_dt(:now)
ORDER BY start_datetime ASC;
