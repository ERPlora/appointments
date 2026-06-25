-- Seam cita→venta (ADR-0010 style): lo dispara el listener del evento
-- `sales.sale.created_from_appointment`. Marca la cita como convertida (status = 'completed')
-- cuando se ha generado una venta a partir de ella. sales NO edita appointments — appointments
-- reacciona en SU propio comando (contrato por evento). El payload del evento aporta
-- :appointment_id; runtime inyecta :hub_id, :now, :current_user_id.
--
-- IDEMPOTENTE: la entrega del outbox es at-least-once. El WHERE excluye estados terminales
-- que NO deben pisarse (cancelled/no_show) y reejecutar sobre una cita ya 'completed' fija el
-- mismo valor → no-op seguro. Si :appointment_id no casa ninguna fila (venta TPV normal sin
-- cita), tampoco hace nada.
UPDATE appointments_appointment
SET status = 'completed',
    updated_by = :current_user_id,
    updated_at = :now
WHERE id = :appointment_id AND hub_id = :hub_id AND is_deleted = 0
  AND status NOT IN ('cancelled', 'no_show');
