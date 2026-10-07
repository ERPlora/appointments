UPDATE _deprecated_appointments_slot_hold
   SET label      = '',
       updated_by = :current_user_id,
       updated_at = :now
 WHERE hub_id = :hub_id
   AND CAST(:customer_id AS TEXT) <> ''
   AND label <> '';

-- Appointments · `customer.anonymized`, step 4/4 — the RETIRED slot holds forget every label of the
-- hub (appointments#314, APPOINTMENTS-F24). Same event and payload as steps 1-3.
--
-- The WhatsApp tray's slot holds were retired in appointments#184 and their table set aside by
-- migration 011 (`_deprecated_appointments_slot_hold`, every hub's rows still in it). Each hold kept
-- as its `label` what the agenda painted on the held slot: the requester's name or, without one,
-- her phone. The row names its requester only by the tray's opaque request id (`source_ref`), never
-- by the customer's sheet, so HERS cannot be told from anyone else's without reading another
-- module's table (ADR-0127). Every label of the hub is blanked instead: the holds expired 15 minutes
-- after they were made and nothing has read them since appointments#184, so the label serves no one
-- (data minimisation). The rest of the row — slot, professional, status, opaque ids — is not
-- personal on its own and stays, so the set-aside table still rolls back as it was.
--
-- Not a migration: the migration guard refuses any `_*` table (`ReservedNamespace`), and the
-- install gate accepts a ROW write on the module's OWN set-aside tables only from a command
-- (hub#2461) — the same door `whatsapp_inbox` uses for its retired requests (whatsapp_inbox#264).
-- The gate does NOT add the tenant filter: the `hub_id` guard here does, because the table holds
-- every hub's rows. The empty-id guard keeps a degenerate event a no-op, like steps 1-3.
--
-- IDEMPOTENT: a blank label is skipped, so a redelivery (the outbox is at-least-once) or the next
-- erasure in the same hub stamps nothing. No `expect_rows`: a hub that never had the tray is normal.
-- Runtime injects :hub_id, :current_user_id, :now.
