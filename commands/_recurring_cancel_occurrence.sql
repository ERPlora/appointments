-- Cancels an occurrence the new PATTERN leaves without a slot (appointments#90).
--
-- Changing `frequency` or `day_of_week` moves the series to DIFFERENT days, so there is no 1:1
-- correspondence with what is already booked: what still falls on the new pattern gets moved
-- (`_recurring_move_occurrence`) and what does not gets cancelled here.
--
-- CANCEL, not delete. Deleting frees the day in the 005 partial unique index, but throws away the
-- appointment number, the history and the trail on the customer's record — and that history
-- belongs to the customer, not to us. Cancelling is also the ONLY thing the salon vertical offers:
-- Fresha, Vagaro, Square and Booksy do not let you change a series' pattern and force a cancel and
-- a new booking. What is cancelled stays hanging off the OLD half of the series, so neither the
-- new half's occurrence read sees it nor does that index collide with anything.
--
-- The `WHERE` is THE SAME GATE as `_recurring_move_occurrence.sql`'s, word for word, and that is
-- the point: `_cancel_row` would have been more convenient and wider — its guard only knows
-- `cancelled`/`completed` — so a pattern change would have cancelled an appointment IN PROGRESS or
-- already converted into a sale, which drags a fiscal record and the VeriFactu chain (ADR-0331).
--
-- `updated_at = :now` pins the run: `_history_cancel.sql` runs right after it as a later statement
-- of this SAME `_recurring_cancel_occurrence` command, never as a separate operation, and finds
-- this row by that same mark — so a cancellation that does not happen leaves NO audit trail (a
-- separate operation would never match the pin, appointments#196).
UPDATE appointments_appointment
   SET status = 'cancelled',
       cancelled_at = :now,
       cancellation_reason = :reason,
       updated_by = :current_user_id,
       updated_at = :now
 WHERE hub_id = :hub_id
   AND id = :appointment_id
   AND is_deleted = 0
   AND status IN ('pending', 'confirmed')
   AND (converted_sale_id IS NULL OR converted_sale_id = '');
