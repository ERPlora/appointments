# Appointments — Limits and troubleshooting

## Errors you will actually see

| Error | What happened | What to do |
|---|---|---|
| `appointments.cannot_confirm` | It is no longer `pending` | Check the current state; it may already be confirmed |
| `appointments.cannot_start` | It is not `confirmed` | Confirm it first |
| `appointments.cannot_complete` | It was never started | Start it first |
| `appointments.cannot_cancel` | It is already finished, cancelled or a no-show | Nothing to cancel |
| `appointments.cannot_mark_no_show` | Its state does not allow it | Check the state |
| Slot not available — `overlap` | That professional is already booked | Pick another time or another professional |
| Slot not available — `outside_schedule` | You are not open then — your **Schedules** hours, special days and overrides, read on the business clock and refused by every door, not just the screen. Since appointments#105 the booking screen no longer offers those times at all | Fix it in **Schedules** (a bank holiday there closes the agenda too); a hub with no hours anywhere still books at any hour |
| Slot not available — `blocked` | Holiday, vacation, break or maintenance | Remove the block or book elsewhere |
| Slot not available — `too_soon` / `too_far` | Breaks the minimum notice or the maximum advance. The front desk is never refused as `too_soon`, neither when it books nor when it moves an appointment: the minimum notice applies to customer bookings only (appointments#157, #165). An automation (a flow or an API key) is not the front desk: it always keeps the minimum notice and can never book or move into the past (appointments#177) | Adjust the booking or the settings |
| Slot not available — `invalid_start` | The start is in the past or malformed. The front desk may book or move an appointment into the past (appointments#155, #156); customer channels may not | Pick a valid future time |
| Reschedule refused | The appointment is already finished, cancelled or a no-show | Create a new appointment instead |

A refused transition rolls back **everything**: no row change, no history entry and no event.

## Required fields

| Action | Must provide |
|---|---|
| Create | `customer_id`, `customer_name`, `service_id`, `staff_id`, `start_datetime` |
| Update | `appointment_id`, `customer_name`, `start_datetime`, `end_datetime`, `duration_minutes` |
| Reschedule | `appointment_id`, `start_datetime`, `end_datetime`, `duration_minutes` |
| Cancel | `appointment_id` (plus the reason) |
| Create blocked time | `title`, `start_datetime`, `end_datetime` |
| Create a recurring template | `customer_name`, `service_name`, `frequency`, `time`, `duration_minutes`, `start_date` |

## Accepted values

| Field | Values |
|---|---|
| Status | `pending`, `confirmed`, `in_progress`, `completed`, `cancelled`, `no_show` |
| History action | `created`, `confirmed`, `started`, `rescheduled`, `cancelled`, `completed`, `no_show`, `note_added` |
| Blocked time type | `holiday`, `vacation`, `break`, `maintenance`, `other` |
| Recurrence frequency | `daily`, `weekly`, `biweekly`, `monthly` |
| Day of week | 0 = Monday … 6 = Sunday |
| Time of day | `HH:MM` |

## Caps and sizes

| Limit | Value |
|---|---|
| Appointments per bulk creation | 50 |
| Appointments per bulk deletion | 50 |
| Appointments materialised per run of a recurring template | 50 |
| Rows per page (blocked time, recurring) | 50 |
| Maximum rows a paginated request may ask for | 500 |
| Appointments per day per hub, by numbering | 9999 |

Bulk creation collects errors per item, including clashes **inside the batch**; if not a single item
is valid the whole call fails with the detail.

## Permissions per action

| To do this | You need |
|---|---|
| See appointments, their detail and history; see recurring templates | `appointments.view_appointment` |
| Book an appointment | `appointments.add_appointment` |
| Confirm, start, complete, cancel, no-show, reschedule, update | `appointments.change_appointment` |
| Delete an appointment | `appointments.delete_appointment` |
| See blocked time and availability | `appointments.view_schedule` |
| Create or delete blocked time | `appointments.manage_schedule` |
| Change the module settings | `appointments.manage_settings` |

By role: **admin** has everything. **manager** has everything except deleting appointments and
changing settings. **employee** can **see and book** appointments and see the schedule, but
**cannot** confirm, start, complete, cancel, mark a no-show or reschedule, and cannot manage
blocked time.

The opening hours themselves are **not** managed here at all: they live in the **Schedules**
module, with its own permissions (appointments#117).

That split is deliberate: taking a booking at the counter is routine; moving somebody's diary is not.

## Dependencies — what breaks if something is missing

**`customers`, `services` and `staff` are all required** and are installed with Appointments. You
cannot uninstall any of them while it is installed, because a booking cannot exist without all three.

- Without `services` there is no duration, so there is no window to check availability against.
- Without `staff` there is nobody to measure overlap against.

**Nothing depends on Appointments.** Removing it removes the agenda; the till, the catalogue and the
customer directory are unaffected.

## When something looks wrong

**"There are no free slots today."** Almost always the opening hours, and they are set in the
**Schedules** module: check the weekly hours of that weekday there, and whether a special day or an
override closes the date. Then check blocked time.

**"It says overlap but the professional is free."** Look at whether the clashing booking is a
cancelled one — those are excluded — and at whether you are booking the same professional. Overlap is
per professional, never global.

**"Two people are booked at the same time and nothing complained."** Either they are different
professionals (correct), or **allow overlapping** is on, which switches the check off entirely.

**"Rescheduling says the slot is taken by itself."** It should not — the check excludes the
appointment being moved. If it happens, the exclusion was not passed.

**"I confirmed twice and got an error the second time."** Correct behaviour. The first confirm
succeeded; the second is refused because it is no longer pending. Previously it would have emitted a
duplicate event.

**"The customer was never reminded."** Nothing in this module sends reminders. The settings only
record the policy.

**"The appointment does not appear in Google Calendar."** External calendar sync is a separate
module; nothing here writes to it.

**"Appointments show at the wrong time in the per-professional view."** That timeline reads the time
it is given literally. It must be handed local wall-clock time, not a UTC instant.

**"Old appointments have no professional."** They predate the requirement and live in the
**unassigned** lane. Edit them to assign someone.

**"I materialised a recurring template and got fewer appointments than expected."** Occurrences in
the past and occurrences that clash are skipped, the window is bounded by your maximum advance
booking, and a single run creates at most 50.
