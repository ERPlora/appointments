UPDATE appointments_appointment
   SET customer_name       = '',
       customer_phone      = '',
       customer_email      = '',
       notes               = '',
       internal_notes      = '',
       cancellation_reason = '',
       updated_by          = :current_user_id,
       updated_at          = :now
 WHERE hub_id = :hub_id
   AND customer_id = :customer_id
   AND CAST(:customer_id AS TEXT) <> ''
   AND (customer_name <> '' OR customer_phone <> '' OR customer_email <> ''
        OR notes <> '' OR internal_notes <> '' OR cancellation_reason <> '');

-- Appointments · `customer.anonymized`, step 1/3 — the agenda forgets who the customer was (pm#637,
-- APPOINTMENTS-F24). Prose at the BOTTOM by house rule (hub#1137/ADR-0387).
--
-- `customers.anonymize` is the platform's GDPR erasure (art. 17, customers#11). It publishes
-- `customer.anonymized`; the outbox relay hands its params (`customer_id`, `reason`, `hub_id`) to
-- this command verbatim, so there is no `schema`. Runtime injects :hub_id, :current_user_id, :now.
--
-- Every appointment of that customer — live and soft-deleted, any status — loses what `create`
-- copied from her sheet (name, phone, email), both free-text notes (the internal one may carry an
-- allergy or a colour formula: health data) and the cancellation reason, which she may have written
-- herself. The name goes to '' and not to a marker: the screen paints a translated «Erased
-- customer» for an empty name, a stored English word would reach a Spanish agenda raw.
--
-- KEPT on purpose: the row, its number, `customer_id` (it now names a pseudonymised sheet that
-- `customers` keeps for the fiscal documents, so it is not personal data on its own), service,
-- price, professional, times, status and the link to the sale. That is the business's own record
-- of the slot (who worked, what was charged), and erasing it would leave the agenda lying about a
-- professional's day. The appointment is NOT cancelled: what to do with a future visit is the
-- salon's decision, and it can still cancel it from the agenda.
--
-- The `hub_id` guard is load-bearing: `customer_id` is an opaque id with no cross-module foreign
-- key, and the same string may name a different person in another hub. The empty-id guard keeps a
-- degenerate event from erasing every walk-in whose link is blank.
--
-- IDEMPOTENT: the outbox is at-least-once. The OR guard skips a row with nothing personal left, so
-- a redelivery stamps nothing; each arm is pinned by its own row in
-- `tests/customer_erasure.postgres.test.py` (a row erased before with ONE column left). No
-- `expect_rows`: erasing a customer who never booked is the ordinary case.
