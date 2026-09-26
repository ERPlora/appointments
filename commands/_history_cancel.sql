-- Audit trail of the `cancel` transition (appointments#21). Runs as a LATER statement of the SAME
-- command as the UPDATE it audits — `_cancel_row` (cancel_appointment) or
-- `_recurring_cancel_occurrence` (series update) — because the runtime binds `:now` once per
-- command (and once per WASM operation), so a separate operation would never match the pin below
-- (appointments#196). See _history_confirm.sql for the `a.updated_at = :now` run-pinning rationale.
--
-- new_value carries the cancellation reason read back from the row the UPDATE just wrote, plus
-- the channel the cancel came through (`staff` | `customer`, appointments#6 — bound by the
-- handler as :channel), so "who cancelled, when, why and through which door" is answerable from
-- the history alone. The reason is free text: its double quotes are escaped so the JSON stays
-- parseable (portable `REPLACE`, no JSON builtins — the SQL subset of ADR-0007 has none).
INSERT INTO appointments_history
  (id, hub_id, appointment_id, action, description, performed_by, old_value, new_value,
   is_deleted, created_by, updated_by, created_at, updated_at)
SELECT :new_id, :hub_id, a.id, 'cancelled', 'Appointment cancelled', :current_user_id,
       NULL,
       '{"status":"cancelled","channel":"' || COALESCE(:channel, 'staff')
         || '","reason":"' || REPLACE(a.cancellation_reason, '"', '''') || '"}',
       0, :current_user_id, :current_user_id, :now, :now
FROM appointments_appointment a
WHERE a.id = :appointment_id AND a.hub_id = :hub_id AND a.is_deleted = 0
  AND a.updated_at = :now;
