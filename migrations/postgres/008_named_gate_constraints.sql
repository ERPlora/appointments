-- Each gate refuses UNDER ITS OWN NAME, so a rolled-back command can say what happened
-- (appointments#103, pattern from verifactu#40 / verifactu migration 012).
--
-- `appointments__gate` was created (migration 003) with one anonymous column check,
-- `CHECK (ok = 1)`, which Postgres auto-names `appointments__gate_ok_check`. Every gate that ever
-- fails therefore fails with the SAME message, and the name of the gate that refused travels in
-- the separate DETAIL field of the wire protocol:
--
--     ERROR:   new row for relation "appointments__gate" violates check constraint "appointments__gate_ok_check"
--     DETAIL:  Failing row contains (appointment_no_overlap, 0).
--
-- The caller never sees that second line. A refusal reaches the browser through
-- `sqlx::Error::Database` wrapping `PgDatabaseError`, whose `Display` writes the PRIMARY message
-- and nothing else (sqlx-postgres `src/error.rs`), and `message()` does not carry DETAIL. So any
-- code that branches on the text to say WHY a command was refused can never match, and the two
-- gates of this module — `appointment_no_overlap` (reschedule/update, appointments#20) and
-- `appointment_reschedulable` (reschedule, appointments#21) — collapse into one indistinguishable
-- refusal.
--
-- The fix moves the gate's identity from the ROW into the CONSTRAINT NAME, which IS part of the
-- primary message. One named constraint per gate, each scoped to its own gate value, so for any
-- given row EXACTLY ONE of them can be violated and the message is deterministic. Postgres does
-- not promise an evaluation order between constraints, and this removes the need for it to. It is
-- also why the anonymous check has to GO rather than stay on as a belt: while both exist, an
-- `ok = 0` row violates both and either name may be the one reported.
--
-- `appointments__gate_is_declared` is what lets the anonymous check go without opening a hole: an
-- `ok = 0` for a gate nobody declared here is refused by the whitelist instead of slipping
-- through. A new gate must be added to BOTH lists in the same migration, and forgetting fails
-- CLOSED and loudly, which is the only acceptable direction for a guard table.
--
-- Declared `contract` because of that one DROP. It is an atomic SWAP, not a deferred cleanup: the
-- replacement lands in this same file, so there is no window in which the table is unguarded. The
-- table has no clearing statement of its own (each assert's row lives only inside its own command
-- transaction, rolled back on refusal and left behind otherwise), but that is also exactly why
-- validating the new constraints has nothing to scan: this migration itself inserts no rows.

ALTER TABLE appointments__gate DROP CONSTRAINT IF EXISTS appointments__gate_ok_check;

ALTER TABLE appointments__gate ADD CONSTRAINT appointment_no_overlap
    CHECK (gate <> 'appointment_no_overlap' OR ok = 1);

ALTER TABLE appointments__gate ADD CONSTRAINT appointment_reschedulable
    CHECK (gate <> 'appointment_reschedulable' OR ok = 1);

ALTER TABLE appointments__gate ADD CONSTRAINT appointments__gate_is_declared
    CHECK (gate IN (
        'appointment_no_overlap',
        'appointment_reschedulable'
    ));
