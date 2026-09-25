DROP TABLE IF EXISTS appointments_slot_hold;
ALTER TABLE appointments_settings DROP COLUMN hold_minutes;

-- Appointments · migration 011 — the storage of slot holds is retired (appointments#187, second
-- release of ADR-0398 after appointments#184 retired the feature: no command, query or handler
-- reads or writes the table or the column since then).
--
-- THE PROSE IS AT THE BOTTOM ON PURPOSE. This file is declared `kind: "contract"`, and the
-- runtime's `migration_guard::set_aside_instead_of_dropping` turns `DROP TABLE t` into
-- `ALTER TABLE t RENAME TO _deprecated_t` and `DROP COLUMN c` into
-- `RENAME COLUMN c TO _deprecated_c`, matching the verb at the start of the statement. A comment
-- above a DROP is kept inside that statement and makes the translation miss, running a real,
-- irreversible DROP (hub#1137). `tests/slot_hold_storage_retired.postgres.test.py` goes red if
-- the prose moves up.
--
-- NOTHING IS LOST: rows of the table and each salon's hold_minutes stay under `_deprecated_*`,
-- and the set-aside column keeps its NOT NULL DEFAULT 15, so settings writes that no longer
-- name it keep working.
--
-- The column is dropped WITHOUT `IF EXISTS` on purpose: a runtime older than hub#2108 translates
-- `DROP COLUMN IF EXISTS c` into `RENAME COLUMN IF EXISTS ...`, which Postgres rejects.
-- `006_slot_hold.sql` created the column on every hub, so the guard buys nothing.
--
-- Two statements and not one: the rename accepts ONE table or column per statement.
--
-- REVERTING is a rename back:
--   ALTER TABLE _deprecated_appointments_slot_hold RENAME TO appointments_slot_hold
--   ALTER TABLE appointments_settings RENAME COLUMN _deprecated_hold_minutes TO hold_minutes
