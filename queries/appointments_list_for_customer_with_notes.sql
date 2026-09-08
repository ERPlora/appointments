-- The last N appointments of ONE customer, WITH the salon's notes — the visit history the
-- customer sheet shows at the chair. Runtime injects :hub_id.
--
-- «The stylist needs the last formula and the allergy note at the chair, in two taps.» The
-- formula is a note OF THE VISIT (Phorest's split: client notes are stable, appointment notes
-- carry the colour formula and products used, dated), so it lives here in `notes` /
-- `internal_notes` and the sheet of `customers` reads it through THIS query + a `customers.detail`
-- slot filler (ADR-0043). `customers` never depends on `appointments`.
--
-- This is the COUNTER's door, and the only read of this module that still returns those two
-- columns (appointments#143). It is deliberately NOT declared with an `ai` block: the assistant
-- and the `ai` steps of a flow assemble their tools from that block
-- (`crates/server/src/assistant.rs`), so leaving it off is what keeps the salon's notes out of
-- reach of a model that is reading a stranger's message. Its sibling
-- `appointments.appointments.list_for_customer` is the delegated door and returns the same visits
-- without the notes.
--
-- Same shape as that sibling: newest first (upcoming on top, then the past), live rows only,
-- cancelled / no-show visits included because they ARE history, and :limit optional with the same
-- `COALESCE(CAST(:limit AS INTEGER), 20)` that fixes the bind type in both dialects.
SELECT id, appointment_number, customer_id,
       service_id, service_name, service_price,
       staff_id, staff_name,
       start_datetime, end_datetime, duration_minutes, status,
       notes, internal_notes,
       converted_sale_id, cancelled_at, cancellation_reason
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND customer_id = :customer_id
ORDER BY start_datetime DESC
LIMIT COALESCE(CAST(:limit AS INTEGER), 20);
