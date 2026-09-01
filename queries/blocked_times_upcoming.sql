-- Bloqueos vivos que quedan POR DELANTE (read autoritativa del handler WASM de `bulk_create` y de
-- `recurring.materialize` — ADR-0069, appointments#10).
--
-- Es la gemela sin-día de `blocked_times_overlapping.sql`. Aquélla filtra por
-- `payload.start_datetime`, que es exactamente lo que un LOTE y una SERIE no tienen: reservan en
-- varios días y `reads.params` solo sabe leer un `payload.<campo>` de primer nivel, así que no hay
-- forma de pedir «los bloqueos de CADA uno de estos días». Pedirle al caller la ventana tampoco
-- vale: una ventana estrecha dejaría fuera el festivo y el guard se abriría solo.
--
-- Por eso trae TODOS los bloqueos que aún no han terminado, sin filtrar por profesional (el corte
-- fino —bloqueo de todo el hub vs. de una persona, y la ventana [start, end)— lo hace el handler
-- en `blocked_refusal`, que ya conoce la duración resuelta contra el catálogo). El volumen es el
-- de los festivos, cierres y formaciones futuras de un negocio: decenas de filas, no miles.
--
-- `:now` lo inyecta el runtime (system_params) en TODA query, no solo en los commands.
-- appointments#79: `all_day` como BOOLEANO, igual que en sus gemelas `list`/`overlapping`.
SELECT id, title, block_type, start_datetime, end_datetime, all_day <> 0 AS all_day, staff_id, reason
FROM appointments_blocked_time
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND erp_dt(end_datetime) >= erp_dt(:now)
ORDER BY start_datetime ASC;
