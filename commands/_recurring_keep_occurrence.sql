-- appointments#236 — an occurrence a series edit («this and following») could NOT move: the new
-- slot is outside the opening hours or her shift, on a blocked period or on top of another
-- appointment. It stays on its OWN slot — nothing about its time changes, so it leaves no
-- «rescheduled» line — but it follows the NEW half of the series as an exception of it. Left on
-- the old half (closed the day before the cut), the new half's occurrences read would not see
-- that date and `materialize` would book the same customer a second time that day.
--
-- Same door as `_recurring_move_occurrence.sql`: only what is still a PLAN (`pending|confirmed`),
-- never an occurrence already turned into a sale (ADR-0331), never another hub's row.
UPDATE appointments_appointment
   SET recurring_id = :recurring_id,
       updated_by   = :current_user_id,
       updated_at   = :now
 WHERE hub_id = :hub_id
   AND id = :appointment_id
   AND is_deleted = 0
   AND status IN ('pending', 'confirmed')
   AND (converted_sale_id IS NULL OR converted_sale_id = '');
