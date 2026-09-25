-- Upsert de los ajustes de reservas del hub (singleton: un registro por hub_id, garantizado
-- por uq_appointments_settings_hub). Portado de AppointmentsSettings. Runtime inyecta
-- :new_id/:hub_id/:current_user_id/:now. En el conflicto por hub_id sobrescribe los campos
-- editables y actualiza la auditoría (conserva id/created_*).
-- Los flags booleanos del schema (allow_overlapping/send_reminders/allow_customer_cancellation/
-- auto_confirm_online) se bindean CRUDOS: el runtime traduce el booleano JSON a 0/1 al bindear
-- (`Json::Bool(b) => q.bind(if *b { 1 } else { 0 })`, hub#208/ADR-0154) y las columnas son INTEGER
-- (contrato de fila §2.5). El `CASE WHEN` que describía este comentario se retiró con aquel cambio;
-- Postgres sigue sin castear boolean a integer, por eso el bind lo hace por nosotros.
-- Ver appointments#25 y appointments#79.
INSERT INTO appointments_settings
  (id, hub_id, default_duration, min_booking_notice, max_advance_booking, allow_overlapping,
   send_reminders, reminder_hours_before, allow_customer_cancellation, cancellation_notice_hours,
   calendar_start_hour, calendar_end_hour, slot_interval, auto_confirm_online,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :default_duration, :min_booking_notice, :max_advance_booking,
   :allow_overlapping,
   :send_reminders,
   :reminder_hours_before,
   :allow_customer_cancellation,
   :cancellation_notice_hours,
   :calendar_start_hour, :calendar_end_hour, :slot_interval,
   -- appointments#136. COALESCE on purpose: the schema gives it `default: true`, so the runtime
   -- always sends it (ADR-0073), but a caller writing this statement without it must not leave a
   -- NOT NULL column as NULL. (`hold_minutes` is no longer written: its setting was retired in
   -- appointments#184 and the column keeps its table DEFAULT until appointments#187 drops it.)
   COALESCE(:auto_confirm_online, 1),
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
  auto_confirm_online         = excluded.auto_confirm_online,
  is_deleted                  = 0,
  deleted_at                  = NULL,
  updated_by                  = :current_user_id,
  updated_at                  = :now;
