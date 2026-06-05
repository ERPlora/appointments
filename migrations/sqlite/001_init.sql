-- Appointments · esquema inicial (SQLite). Portado fielmente de old_modules/m_appointments/models.py.
-- Modelos: AppointmentsSettings (singleton/hub), Schedule + ScheduleTimeSlot (plantillas de
-- disponibilidad), BlockedTime (huecos bloqueados), Appointment (la cita en sí),
-- AppointmentHistory (audit-trail de transiciones) y RecurringAppointment (plantilla recurrente).
-- Contrato de fila estándar de hub-next (§2.5): hub_id + soft-delete + auditoría en TODAS.
-- Depende (vía datos, FK lógica sin constraint cross-módulo) de customers y services.

-- Ajustes de reservas: un único registro por hub (lo garantiza el índice único de hub_id).
CREATE TABLE IF NOT EXISTS appointments_settings (
    id                          TEXT PRIMARY KEY,
    hub_id                      TEXT NOT NULL,
    default_duration            INTEGER NOT NULL DEFAULT 60,   -- minutos
    min_booking_notice          INTEGER NOT NULL DEFAULT 60,   -- minutos de antelación mínima
    max_advance_booking         INTEGER NOT NULL DEFAULT 90,   -- días máx. de antelación
    allow_overlapping           INTEGER NOT NULL DEFAULT 0,
    send_reminders              INTEGER NOT NULL DEFAULT 1,
    reminder_hours_before       INTEGER NOT NULL DEFAULT 24,
    allow_customer_cancellation INTEGER NOT NULL DEFAULT 1,
    cancellation_notice_hours   INTEGER NOT NULL DEFAULT 24,
    calendar_start_hour         INTEGER NOT NULL DEFAULT 8,
    calendar_end_hour           INTEGER NOT NULL DEFAULT 20,
    slot_interval               INTEGER NOT NULL DEFAULT 15,    -- minutos
    is_deleted                  INTEGER NOT NULL DEFAULT 0,
    deleted_at                  TEXT,
    created_by                  TEXT,
    updated_by                  TEXT,
    created_at                  TEXT NOT NULL,
    updated_at                  TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_appointments_settings_hub ON appointments_settings (hub_id);
CREATE INDEX        IF NOT EXISTS idx_appointments_settings_hub ON appointments_settings (hub_id, is_deleted);

-- Plantilla de horario (p.ej. "Horario de tienda"). Sus tramos viven en _timeslot.
CREATE TABLE IF NOT EXISTS appointments_schedule (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_default  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_schedule_hub    ON appointments_schedule (hub_id, is_deleted);
CREATE INDEX IF NOT EXISTS ix_appointments_schedule_active  ON appointments_schedule (hub_id, is_active);

-- Tramo horario de una plantilla: día de la semana (0=Lun..6=Dom) + ventana hora inicio/fin.
CREATE TABLE IF NOT EXISTS appointments_schedule_timeslot (
    id          TEXT PRIMARY KEY,
    hub_id      TEXT NOT NULL,
    schedule_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL,            -- 0=Lunes .. 6=Domingo
    start_time  TEXT NOT NULL,               -- HH:MM
    end_time    TEXT NOT NULL,               -- HH:MM
    is_active   INTEGER NOT NULL DEFAULT 1,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    deleted_at  TEXT,
    created_by  TEXT,
    updated_by  TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT,
    FOREIGN KEY (schedule_id) REFERENCES appointments_schedule (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_timeslot               ON appointments_schedule_timeslot (schedule_id, day_of_week, start_time);
CREATE INDEX        IF NOT EXISTS idx_appointments_schedule_timeslot_hub ON appointments_schedule_timeslot (hub_id, is_deleted);
CREATE INDEX        IF NOT EXISTS ix_timeslot_schedule_day           ON appointments_schedule_timeslot (schedule_id, day_of_week);

-- Tiempo bloqueado (festivo, vacaciones, descanso…). Opcionalmente por staff concreto.
CREATE TABLE IF NOT EXISTS appointments_blocked_time (
    id              TEXT PRIMARY KEY,
    hub_id          TEXT NOT NULL,
    title           TEXT NOT NULL,
    block_type      TEXT NOT NULL DEFAULT 'other',   -- holiday|vacation|break|maintenance|other
    start_datetime  TEXT NOT NULL,                   -- ISO 8601 con tz
    end_datetime    TEXT NOT NULL,                   -- ISO 8601 con tz
    all_day         INTEGER NOT NULL DEFAULT 0,
    staff_id        TEXT,                            -- NULL = afecta a todo el hub
    reason          TEXT NOT NULL DEFAULT '',
    is_recurring    INTEGER NOT NULL DEFAULT 0,
    recurrence_rule TEXT NOT NULL DEFAULT '',
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    deleted_at      TEXT,
    created_by      TEXT,
    updated_by      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_blocked_time_hub ON appointments_blocked_time (hub_id, is_deleted);
CREATE INDEX IF NOT EXISTS ix_blocked_time_hub_start         ON appointments_blocked_time (hub_id, start_datetime);

-- La cita. customer_id/service_id/staff_id son FK lógicas a otros módulos (sin constraint
-- cross-módulo: §1 "nunca tocar tablas privadas de otro módulo"); se denormaliza el nombre.
CREATE TABLE IF NOT EXISTS appointments_appointment (
    id                  TEXT PRIMARY KEY,
    hub_id              TEXT NOT NULL,
    appointment_number  TEXT NOT NULL DEFAULT '',    -- APT-YYYYMMDD-NNNN (contador atómico → WASM)
    customer_id         TEXT,
    customer_name       TEXT NOT NULL,
    customer_phone      TEXT NOT NULL DEFAULT '',
    customer_email      TEXT NOT NULL DEFAULT '',
    staff_id            TEXT,
    staff_name          TEXT NOT NULL DEFAULT '',
    service_id          TEXT,
    service_name        TEXT NOT NULL,
    service_price       NUMERIC NOT NULL DEFAULT 0,
    start_datetime      TEXT NOT NULL,               -- ISO 8601 con tz
    end_datetime        TEXT NOT NULL,               -- ISO 8601 con tz
    duration_minutes    INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending',  -- pending|confirmed|in_progress|completed|cancelled|no_show
    notes               TEXT NOT NULL DEFAULT '',
    internal_notes      TEXT NOT NULL DEFAULT '',
    reminder_sent       INTEGER NOT NULL DEFAULT 0,
    reminder_sent_at    TEXT,
    booked_online       INTEGER NOT NULL DEFAULT 0,
    cancelled_at        TEXT,
    cancellation_reason TEXT NOT NULL DEFAULT '',
    is_deleted          INTEGER NOT NULL DEFAULT 0,
    deleted_at          TEXT,
    created_by          TEXT,
    updated_by          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_appointment_hub   ON appointments_appointment (hub_id, is_deleted);
CREATE INDEX IF NOT EXISTS ix_appointments_hub_start_status   ON appointments_appointment (hub_id, start_datetime, status);
CREATE INDEX IF NOT EXISTS ix_appointments_hub_customer       ON appointments_appointment (hub_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_appointments_hub_staff_start    ON appointments_appointment (hub_id, staff_id, start_datetime);

-- Historial / audit-trail de la cita: cada transición de estado deja una entrada.
CREATE TABLE IF NOT EXISTS appointments_history (
    id              TEXT PRIMARY KEY,
    hub_id          TEXT NOT NULL,
    appointment_id  TEXT NOT NULL,
    action          TEXT NOT NULL,   -- created|confirmed|started|rescheduled|cancelled|completed|no_show|note_added
    description     TEXT NOT NULL DEFAULT '',
    performed_by    TEXT,
    old_value       TEXT,            -- JSON
    new_value       TEXT,            -- JSON
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    deleted_at      TEXT,
    created_by      TEXT,
    updated_by      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT,
    FOREIGN KEY (appointment_id) REFERENCES appointments_appointment (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_appointments_history_hub         ON appointments_history (hub_id, is_deleted);
CREATE INDEX IF NOT EXISTS ix_appointments_history_appointment  ON appointments_history (appointment_id);

-- Plantilla de cita recurrente. La materialización de las ocurrencias (get_next_occurrence,
-- generación batch de citas) NO cabe en SQL → motor de recurrencia a WASM (ver WASM-TODO).
CREATE TABLE IF NOT EXISTS appointments_recurring (
    id               TEXT PRIMARY KEY,
    hub_id           TEXT NOT NULL,
    customer_id      TEXT,
    customer_name    TEXT NOT NULL,
    service_id       TEXT,
    service_name     TEXT NOT NULL,
    staff_id         TEXT,
    staff_name       TEXT NOT NULL DEFAULT '',
    frequency        TEXT NOT NULL,   -- daily|weekly|biweekly|monthly
    day_of_week      INTEGER,         -- 0=Lun..6=Dom (NULL para daily/monthly)
    time             TEXT NOT NULL,   -- HH:MM
    duration_minutes INTEGER NOT NULL,
    start_date       TEXT NOT NULL,   -- YYYY-MM-DD
    end_date         TEXT,            -- YYYY-MM-DD o NULL (sin fin)
    max_occurrences  INTEGER,
    is_active        INTEGER NOT NULL DEFAULT 1,
    is_deleted       INTEGER NOT NULL DEFAULT 0,
    deleted_at       TEXT,
    created_by       TEXT,
    updated_by       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_appointments_recurring_hub    ON appointments_recurring (hub_id, is_deleted);
CREATE INDEX IF NOT EXISTS ix_appointments_recurring_active  ON appointments_recurring (hub_id, is_active);
