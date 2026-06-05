-- Inserción de una entrada de historial (Tier 0). Invocada por el runtime/WASM tras cada
-- transición de estado para dejar el audit-trail. Portado de log_appointment_history.
-- old_value/new_value son JSON serializado (TEXT) o NULL. Runtime inyecta :hub_id/:now.
INSERT INTO appointments_history
  (id, hub_id, appointment_id, action, description, performed_by, old_value, new_value,
   is_deleted, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :appointment_id, :action, :description, :current_user_id, :old_value, :new_value,
   0, :current_user_id, :current_user_id, :now, :now);
