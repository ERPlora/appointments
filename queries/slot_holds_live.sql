-- Retenciones VIVAS del mismo día que :start_datetime (appointments#69).
--
-- Read autoritativa (ADR-0069) de `create` y `reschedule`: lo que el
-- mostrador no puede vender porque una decisión pendiente lo tiene apartado.
--
-- Trae las del DÍA entero, no las de la franja: `reads.params` solo admite `payload.<campo>`
-- literales, así que aquí no se puede computar `fin = inicio + duración`. El filtrado fino por
-- ventana `[inicio, fin)` lo hace el handler con la MISMA función con la que mide el solape.
--
-- «Viva» son las dos condiciones a la vez: `status = 'held'` **y** `expires_at > :now`. La segunda
-- no sobra aunque exista la tarea programada: entre dos barridas hay minutos, y en esos minutos
-- una retención caducada seguiría cerrando el hueco. La tarea programada limpia la fila; esta
-- query decide, y decide al instante.
--
-- :staff_id opcional (vacío/null = agenda global). Va CASTEADO por lo mismo que en
-- availability_check.sql: sin el CAST, Postgres no puede inferir el tipo del bind y el PREPARE
-- muere con 42P08. erp_date/erp_dt = funciones-puente portables (ADR-0007 §4a).
SELECT id, staff_id, source, source_ref, start_datetime, end_datetime, expires_at, label
FROM appointments_slot_hold
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND status = 'held'
  AND erp_dt(expires_at) > erp_dt(:now)
  AND (COALESCE(CAST(:staff_id AS TEXT), '') = '' OR staff_id = '' OR staff_id = :staff_id)
  AND erp_date(start_datetime) = erp_date(:start_datetime)
ORDER BY start_datetime ASC;
