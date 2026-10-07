UPDATE appointments_history
   SET new_value  = CASE
                      WHEN new_value IS JSON OBJECT
                        THEN CAST(jsonb_set(jsonb_set(CAST(new_value AS jsonb),
                                                      '{customer_name}', '""', false),
                                            '{reason}', '""', false) AS TEXT)
                      ELSE NULL
                    END,
       updated_by = :current_user_id,
       updated_at = :now
 WHERE hub_id = :hub_id
   AND new_value IS NOT NULL
   AND appointment_id IN (
         SELECT a.id
           FROM appointments_appointment a
          WHERE a.hub_id = :hub_id
            AND a.customer_id = :customer_id
            AND CAST(:customer_id AS TEXT) <> ''
       )
   AND CASE
         WHEN new_value IS JSON OBJECT
           THEN COALESCE(CAST(new_value AS jsonb) ->> 'customer_name', '') <> ''
             OR COALESCE(CAST(new_value AS jsonb) ->> 'reason', '') <> ''
         ELSE TRUE
       END;

-- Appointments · `customer.anonymized`, step 3/3 — the history of her appointments forgets her name
-- and her reasons (pm#637, APPOINTMENTS-F24). Same event, payload and guards as step 1.
--
-- Two lines of the trail carry the customer: `created` freezes `customer_name` in its JSON (the
-- handler's `create`), and `cancelled` carries the `reason` she or the front desk gave
-- (`_history_cancel.sql`). Both keys go to "" and every other key of the JSON stays — the times, the
-- service, the channel, the status — so the trail still says what happened and when. The rest of
-- the row (`action`, `description`, `performed_by`, the stamps of who did it) names hub USERS, not
-- the customer, and is kept: it is the audit of the staff's own work. `old_value` is not touched:
-- no writer puts the customer in it (a series move stores the professional and the service).
--
-- `new_value` is TEXT built by hand in SQL, so a row can hold something that is not a JSON object
-- (a reason with a backslash breaks the hand-made escaping). Such a value cannot be read key by key
-- and could hold anything, so it is DROPPED (NULL); the screen already reads an unreadable or empty
-- value as «no extra facts». The CASE (not an OR) keeps Postgres from casting it to jsonb at all.
--
-- Runs BEFORE nothing in particular: it finds the appointments by `customer_id`, which step 1 keeps.
-- The appointment's `hub_id` is checked inside the subselect too: an id is only trusted in the hub
-- that wrote it. IDEMPOTENT: an erased line has both keys empty (or no value) and is skipped.
