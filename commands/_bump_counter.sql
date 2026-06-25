-- Incrementa atómicamente el contador de citas del día (upsert). Primera intención de
-- create_appointment / bulk_create / materialize_recurring (una por cita: el contador
-- avanza dentro del lote). Runtime inyecta :new_id, :hub_id. :day lo aporta el handler.
INSERT INTO appointments_appointment_counter (id, hub_id, day, last_number)
VALUES (:new_id, :hub_id, :day, 1)
ON CONFLICT (hub_id, day) DO UPDATE SET last_number = appointments_appointment_counter.last_number + 1;
