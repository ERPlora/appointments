-- Appointments · 004 — TRAZABILIDAD cita → venta (hub#777): una cita que se cobra en el TPV
-- queda vinculada a su venta. El listener de `sales.sale.created_from_appointment` escribe aquí
-- el sale_id; la UI puede entonces contestar «¿esta cita se cobró?» y el ciclo diario cierra.
-- Es solo trazabilidad: el TPV sigue creando la venta; este campo la registra sobre la cita.
ALTER TABLE appointments_appointment ADD COLUMN converted_sale_id TEXT;
