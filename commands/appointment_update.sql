-- The details of ONE appointment — `appointments._update_details`, the write of
-- `appointments.appointments.update` that is not about the slot (appointments#271).
--
-- The edit used to be this file alone, and it wrote the professional, the service, their names and
-- the slot exactly as the caller sent them. Since appointments#271 the command runs the WASM handler
-- (`update_appointment`): the professional, the service and the slot take the agenda's own road
-- (`_reschedule_row`, judged by `reschedule`), and this statement keeps only what the caller owns —
-- the customer's contact on this appointment and the notes. That is also why it has no status
-- filter: the notes of an appointment that already happened can still be written.
-- appointments#274: every bind arrives filled — the handler copies from the row each field the
-- caller left out, so a partial edit writes back what the appointment had instead of blanking it.
-- The runtime injects :hub_id / :current_user_id / :now.
UPDATE appointments_appointment SET
  customer_name    = :customer_name,
  customer_phone   = :customer_phone,
  customer_email   = :customer_email,
  notes            = :notes,
  internal_notes   = :internal_notes,
  updated_by       = :current_user_id,
  updated_at       = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0;
