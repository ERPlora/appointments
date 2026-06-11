-- Contador atómico del nº de cita por hub+día (APT-YYYYMMDD-NNNN). Mismo patrón que
-- sales_sale_counter: el handler WASM emite la intención `_bump_counter` (UPSERT) y
-- `_insert_appointment` lee el contador con subquery en la MISMA transacción, sin
-- ventana SELECT→UPDATE (WASM-TODO pieza 5).
CREATE TABLE IF NOT EXISTS appointments_appointment_counter (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    day         TEXT NOT NULL,             -- YYYYMMDD (día de creación)
    last_number INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointment_counter ON appointments_appointment_counter (hub_id, day);
