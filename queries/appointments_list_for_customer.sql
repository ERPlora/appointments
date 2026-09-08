-- The last N appointments of ONE customer — WHEN, WHAT, with WHOM and in what state.
-- (appointments#46, decided in ERPlora/pm#9). Runtime injects :hub_id.
--
-- This is the DELEGATED door: it carries an `ai` block, so the assistant and the `ai` steps of a
-- flow are offered it as a tool (the shipped `appointment-from-whatsapp*` recipes list it in
-- `book_appointment`), which means a model composes its arguments while reading a message from
-- whoever is on the other side. So it returns the visit and NOT the salon's notes
-- (appointments#143): the colour formula, the products used and whatever the salon writes down
-- for itself are business-side data in Fresha, Vagaro and Booksy alike, and they never cross to a
-- client-facing surface. The counter reads the whole row through
-- `appointments.appointments.list_for_customer_with_notes`, which no model is ever offered.
--
-- Newest first (upcoming ones on top, then the past), live rows only. Cancelled / no-show visits
-- ARE history (they tell the salon something), so status is returned, not filtered.
-- :limit is optional: `COALESCE(CAST(:limit AS INTEGER), 20)` fixes the bind type in both dialects
-- and caps the answer to the last 20 when omitted (a sheet asks for the last N, never for pages).
SELECT id, appointment_number, customer_id,
       service_id, service_name, service_price,
       staff_id, staff_name,
       start_datetime, end_datetime, duration_minutes, status,
       converted_sale_id, cancelled_at, cancellation_reason
FROM appointments_appointment
WHERE hub_id = :hub_id
  AND is_deleted = 0
  AND customer_id = :customer_id
ORDER BY start_datetime DESC
LIMIT COALESCE(CAST(:limit AS INTEGER), 20);
