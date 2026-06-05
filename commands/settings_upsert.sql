-- Upsert de los ajustes de reservas del hub (singleton: un registro por hub_id, garantizado
-- por uq_appointments_settings_hub). Portado de AppointmentsSettings. Runtime inyecta
-- :new_id/:hub_id/:current_user_id/:now. En el conflicto por hub_id sobrescribe los campos
-- editables y actualiza la auditoría (conserva id/created_*).
INSERT INTO appointments_settings
  (id, hub_id, default_duration, min_booking_notice, max_advance_booking, allow_overlapping,
   send_reminders, reminder_hours_before, allow_customer_cancellation, cancellation_notice_hours,
   calendar_start_hour, calendar_end_hour, slot_interval,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :default_duration, :min_booking_notice, :max_advance_booking, :allow_overlapping,
   :send_reminders, :reminder_hours_before, :allow_customer_cancellation, :cancellation_notice_hours,
   :calendar_start_hour, :calendar_end_hour, :slot_interval,
   0, :current_user_id, :current_user_id, :now, :now)
ON CONFLICT(hub_id) DO UPDATE SET
  default_duration            = excluded.default_duration,
  min_booking_notice          = excluded.min_booking_notice,
  max_advance_booking         = excluded.max_advance_booking,
  allow_overlapping           = excluded.allow_overlapping,
  send_reminders              = excluded.send_reminders,
  reminder_hours_before       = excluded.reminder_hours_before,
  allow_customer_cancellation = excluded.allow_customer_cancellation,
  cancellation_notice_hours   = excluded.cancellation_notice_hours,
  calendar_start_hour         = excluded.calendar_start_hour,
  calendar_end_hour           = excluded.calendar_end_hour,
  slot_interval               = excluded.slot_interval,
  is_deleted                  = 0,
  deleted_at                  = NULL,
  updated_by                  = :current_user_id,
  updated_at                  = :now;
