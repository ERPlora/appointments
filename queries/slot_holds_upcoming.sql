-- Todas las retenciones VIVAS que aún no han terminado (appointments#69).
--
-- La gemela multi-día de `slot_holds_live.sql`, para `bulk_create` y `recurring.materialize`: un
-- lote y una serie abarcan varios días y `reads.params` no sabe expresar «las retenciones de CADA
-- uno de estos días» (solo admite `payload.<campo>` literales). Mismo par que ya existe para los
-- bloqueos de agenda: `blocked_times.overlapping` (un día) y `.upcoming` (todo lo que viene).
--
-- «Viva» = `status = 'held'` **y** `expires_at > :now`, igual que la de un día: entre dos pasadas
-- de la tarea programada, una retención caducada no puede seguir cerrando un hueco.
SELECT id, staff_id, source, source_ref, start_datetime, end_datetime, expires_at, label
FROM appointments_slot_hold
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND status = 'held'
  AND erp_dt(expires_at) > erp_dt(:now)
  AND erp_dt(end_datetime) >= erp_dt(:now)
  AND (COALESCE(CAST(:staff_id AS TEXT), '') = '' OR staff_id = '' OR staff_id = :staff_id)
ORDER BY start_datetime ASC;
