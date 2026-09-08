-- appointments#149 — flip ONE booking setting without rewriting the other twelve.
--
-- WHY THIS FILE EXISTS. `commands/settings_upsert.sql` takes the WHOLE form, which is right for
-- the Settings tab (it paints every field and sends the snapshot back) and wrong for anybody
-- else: the runtime materialises the JSON Schema `default` of every key the caller omitted
-- (ADR-0073), so a foreign screen sending `{"auto_confirm_online": false}` writes
-- `excluded.<column>` for all thirteen and resets the salon's settings to factory values —
-- measured, 12 of 12. `whatsapp_inbox` offers this very switch on its own screen
-- (whatsapp_inbox#123), so without a narrow door the two screens overwrite each other by design.
--
-- ONE STATEMENT, TWO BRANCHES. The singleton is created lazily (a hub that never opened the
-- Settings tab has no row), so «update it, and create it if it is not there» has to be atomic or
-- two screens racing on a fresh hub end in a unique-violation. `ON CONFLICT (hub_id)` is the same
-- inference `settings_upsert.sql` uses (`uq_appointments_settings_hub`).
--
-- THE INSERT BRANCH LISTS NOTHING ELSE ON PURPOSE. Every other column carries its factory value
-- as a table DEFAULT in `001_init.sql` / `006_slot_hold.sql` / `010_auto_confirm_online.sql`, and
-- those are the same numbers the form schema declares. Repeating them here would be a second copy
-- that drifts the day one of them changes; leaving them out keeps the factory settings in one
-- place — the migration — and makes the row this command creates identical to the one
-- `settings.upsert` writes from an empty form (pinned by tests/settings_narrow_write.postgres).
--
-- THE `is_deleted = 0` GUARD. A soft-deleted singleton is invisible to `appointments.settings.get`,
-- so writing into it would lose the flip silently. Refusing to update it affects 0 rows, which the
-- command's `expect_rows` gate turns into `appointments.cannot_update_settings` — a visible error
-- instead of a write nobody can read back.
--
-- The flag binds RAW: the runtime turns a JSON boolean into 0/1 for an INTEGER column
-- (`Json::Bool` → 0/1, hub#208 / ADR-0154), like the rest of the flags (appointments#79).
INSERT INTO appointments_settings
  (id, hub_id, auto_confirm_online, created_by, updated_by, created_at, updated_at)
VALUES
  (:new_id, :hub_id, :auto_confirm_online, :current_user_id, :current_user_id, :now, :now)
ON CONFLICT (hub_id) DO UPDATE SET
  auto_confirm_online = excluded.auto_confirm_online,
  updated_by          = :current_user_id,
  updated_at          = :now
WHERE appointments_settings.is_deleted = 0;
