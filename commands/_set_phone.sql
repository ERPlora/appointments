-- `appointments._set_phone` — the write of the scheduled task `phones_to_e164` (appointments#313):
-- the appointment's phone in E.164, the same number in the form the «appointment confirmed»
-- WhatsApp looks the conversation up by. Guarded by the text the read saw (:old_phone): a phone
-- edited between the read and the write is not overwritten. No history line and no event: the
-- number does not change, only its form. Runtime injects :hub_id and :now.
UPDATE appointments_appointment SET
  customer_phone = :customer_phone,
  updated_at     = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND customer_phone = :old_phone;
