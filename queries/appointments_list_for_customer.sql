-- The last N appointments of ONE customer — the visit history the customer sheet shows
-- (appointments#46, decided in ERPlora/pm#9). Runtime injects :hub_id.
--
-- «The stylist needs the last formula and the allergy note at the chair, in two taps.» The
-- formula is a note OF THE VISIT (Phorest's split: client notes are stable, appointment notes carry
-- the colour formula and products used, dated), so it lives here in `notes` / `internal_notes` and
-- the sheet of `customers` reads it through THIS public query + a `customers.detail` slot filler
-- (ADR-0043). `customers` never depends on `appointments`.
--
-- Newest first (upcoming ones on top, then the past), live rows only. Cancelled / no-show visits
-- ARE history (they tell the salon something), so status is returned, not filtered.
-- :limit is optional: `COALESCE(CAST(:limit AS INTEGER), 20)` fixes the bind type in both dialects
-- and caps the answer to the last 20 when omitted (a sheet asks for the last N, never for pages).
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
