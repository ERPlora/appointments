-- The hub's recurring appointment templates, active AND inactive (appointments#110): a paused
-- series cannot become invisible, or «deactivate» would be a trap with no way back. Whoever wants
-- only the active ones uses the `is_active` filter the manifest's `list` block already declares.
-- Runtime injects :hub_id.
-- `customer_id` travels too (pm#637): once a customer's data is erased the name is blank, and the
-- list tells «Deleted customer» from a series that never had a customer by the link it keeps.
SELECT id, customer_id, customer_name, service_name, staff_name, frequency, day_of_week,
       time, duration_minutes, start_date, end_date, max_occurrences, is_active
FROM appointments_recurring
WHERE hub_id = :hub_id AND is_deleted = 0
