DROP TABLE IF EXISTS appointments_slot_hold;
ALTER TABLE appointments_settings DROP COLUMN hold_minutes;

-- Appointments · migration 011 — the storage of slot holds is retired (appointments#187, second
-- release of ADR-0398 after appointments#184 retired the feature: no command, query or handler
-- reads or writes the table or the column since then).
--
-- THE PROSE IS AT THE BOTTOM ON PURPOSE. This file is declared `kind: "contract"`, and the
-- runtime's `migration_guard::set_aside_instead_of_dropping` turns `DROP TABLE t` into
-- `ALTER TABLE t RENAME TO _deprecated_t` and `DROP COLUMN c` into
-- `RENAME COLUMN c TO _deprecated_c`. A runtime older than hub#1148 matched the verb at the
-- START of the statement text, so a comment above a DROP made the translation miss and ran a
-- real, irreversible DROP (hub#1137, fixed by ADR-0387: v1.1.29 and develop strip the leading
-- prose first). The prose stays below anyway: the Python mirror in `tests/module_migrations.py`
-- keeps the old behaviour so `tests/slot_hold_storage_retired.postgres.test.py` goes red if the
-- prose moves up, and a migration must not depend on which image a hub runs.
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
