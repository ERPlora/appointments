-- Moves an already-booked occurrence to the schedule of the NEW half of the series (appointments#15).
--
-- The row is rewritten IN PLACE instead of being deleted and re-materialized: the appointment keeps
-- its id, its appointment number and its history, which is exactly what the hairdresser needs in
-- the chair (the formula from the last visit hangs off that row). Deleting and recreating would
-- throw all of that away.
--
-- The `WHERE` is the gate, not the handler: only what is still a PLAN (`pending|confirmed`) gets
-- moved. An appointment that started, completed, was cancelled or was converted into a sale is not
-- touched even if the handler got it wrong — a converted one drags a fiscal record and the
-- VeriFactu chain is not rewritten (ADR-0331).
--
-- `updated_at = :now` pins the run: `_history_series_move.sql` (appointments#253) runs right after
-- it as a later statement of this SAME `_recurring_move_occurrence` command, never as a separate
-- operation, and finds this row by that same mark — so a move that does not happen leaves NO audit trail (a
-- separate operation would never match the pin, appointments#196).
--
-- appointments#248: when the edit hands the series to another professional the occurrence follows
-- her (id and name); an EMPTY `:staff_id` keeps whoever it has, so an edit that changes no
-- professional never reassigns an occurrence.
--
-- appointments#252: the same for the SERVICE — when the edit changes it the occurrence takes the
-- new one: id, name and price (the price follows the service, as `materialize` prices every
-- occurrence of the series). An EMPTY `:service_id` keeps all three, so an edit that changes no
-- service never rewrites what the booking costs.
UPDATE appointments_appointment
   SET recurring_id   = :recurring_id,
       start_datetime = :start_datetime,
       end_datetime   = :end_datetime,
       duration_minutes = :duration_minutes,
       staff_id       = COALESCE(NULLIF(:staff_id, ''), staff_id),
       staff_name     = CASE WHEN COALESCE(:staff_id, '') = '' THEN staff_name ELSE :staff_name END,
       service_id     = COALESCE(NULLIF(:service_id, ''), service_id),
       service_name   = CASE WHEN COALESCE(:service_id, '') = '' THEN service_name ELSE :service_name END,
       service_price  = CASE WHEN COALESCE(:service_id, '') = '' THEN service_price ELSE :service_price END,
       updated_by     = :current_user_id,
       updated_at     = :now
 WHERE hub_id = :hub_id
   AND id = :appointment_id
   AND is_deleted = 0
   AND status IN ('pending', 'confirmed')
   AND (converted_sale_id IS NULL OR converted_sale_id = '');
