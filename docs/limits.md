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
| Slot not available — `outside_staff_hours` | That professional does not work then — their working schedule in **Staff** (shifts and break) or an approved leave covers it. Checked when booking one appointment, and the list of free slots for one professional leaves those times out (appointments#230); a professional with no schedule set up for that day is not refused. Booking a batch, booking a recurring series and moving an appointment check it too (appointments#229): the batch is refused whole, the series skips that occurrence and books the rest | Pick another time or another professional, or fix their schedule in **Staff** |
| Slot not available — `blocked` | Holiday, vacation, break or maintenance | Remove the block or book elsewhere |
| Slot not available — `too_soon` / `too_far` | Breaks the minimum notice or the maximum advance. The front desk is never refused as `too_soon`, neither when it books nor when it moves an appointment: the minimum notice applies to customer bookings only (appointments#157, #165). An automation (a flow or an API key) is not the front desk: it always keeps the minimum notice and can never book or move into the past (appointments#177) | Adjust the booking or the settings |
| Slot not available — `invalid_start` | The start is in the past or malformed. The front desk may book or move an appointment into the past (appointments#155, #156); customer channels may not | Pick a valid future time |
| Reschedule refused | The appointment is already finished, cancelled or a no-show | Create a new appointment instead |
| `appointments.staff_not_eligible` | That professional does not perform the chosen service: in **Staff** the service is assigned to other team members. Checked by every door that books or saves with a professional — one appointment, a batch, a recurring series when it is created and when its appointments are booked, a move and a series edit — so the assistant or the API cannot save a series nobody can book (appointments#283). A service assigned to nobody is performed by the whole team | Pick a professional who performs the service, or assign the service to them in **Staff** |

A refused transition rolls back **everything**: no row change, no history entry and no event.

## Required fields

| Action | Must provide |
|---|---|
| Create | `customer_id`, `customer_name`, `service_id`, `staff_id`, `start_datetime` |
| Update | `appointment_id`, `customer_name`, `start_datetime`, `end_datetime`, `duration_minutes` |
| Reschedule | `appointment_id`, `start_datetime` (optional: `duration_minutes`; `staff_id` + `service_id` together to hand it to another professional or service) |
| Cancel | `appointment_id` (plus the reason) |
| Create blocked time | `title`, `start_datetime`, `end_datetime` |
| Create a recurring template | `customer_id`, `customer_name`, `service_id`, `service_name`, `staff_id`, `frequency`, `time`, `duration_minutes`, `start_date` |

## Accepted values

| Field | Values |
|---|---|
| Status | `pending`, `confirmed`, `in_progress`, `completed`, `cancelled`, `no_show` |
| History action | `created`, `confirmed`, `started`, `rescheduled`, `staff_changed`, `service_changed`, `cancelled`, `completed`, `no_show`, `note_added` |
| Blocked time type | `holiday`, `vacation`, `break`, `maintenance`, `other` |
| Recurrence frequency | `daily`, `weekly`, `biweekly`, `monthly` |
| Day of week | 0 = Monday … 6 = Sunday |
| Time of day | `HH:MM` |

## Caps and sizes

| Limit | Value |
|---|---|
| Appointments per bulk creation | 50. Measured on a real hub: a batch of 50 books (or is refused whole with the reason) while the professional has up to ~4,000 other live appointments ahead |
| Appointments per bulk deletion | 50 |
| Appointments materialised per run of a recurring template | 50. The professional's agenda is read one page of 2,000 live appointments at a time: a run books what its page can judge — and at most 50 — and answers where the next one starts (`next_from`, with the window's `to`), and «Book appointments» goes on from there by itself, so a daily series on the default 90-day window is booked whole in one tap (appointments#299; before, the screen stopped after the first 50 and said nothing). Measured on a real hub: a daily series is materialised run after run to the 400-day horizon while the professional has ~5,600 other live appointments ahead (before appointments#267 the hub refused the run from ~4,300) |
| Appointments an edit of «this and all following» treats | All of them in one change, no per-run cap. Measured on a real hub: a daily series booked to the 400-day horizon (400 appointments from the cut) moves whole while the professional has up to ~3,400 other live appointments ahead. Beyond that the hub refuses the edit and nothing changes (the whole change is undone) |
| How far ahead a run of a recurring template books | 400 days (the professional's hours are checked that far; later occurrences are booked by a later run) |
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
**unassigned** lane. Open them with **Edit** and pick a professional (appointments#263).

**"I materialised a recurring template and got fewer appointments than expected."** Occurrences in
the past and occurrences that clash are skipped, the window is bounded by your maximum advance
booking, counted to the hour from now: on its last day, an occurrence later than the time you book
is left for a later run, not refused (appointments#289). A single run creates at most 50, but «Book appointments» goes on run after run by itself;
if the window is still unfinished when it stops, the panel says from which date nothing is booked
yet — tap «Book appointments» on the series again (appointments#299).

**"«Book appointments» on a series says it has no professional."** The series was saved without one
(before appointments#246 the assistant and the API could create it that way; the screen never
could), and a series is booked for a customer, a service and a professional from your records.
Open **Edit series**, choose who does it and save: its appointments are booked with them
(appointments#248).

**"I changed the service of a series and some appointments kept the old one."** The new service is
longer and those appointments no longer fit the agenda (her shift, blocked time or another booking
right after). They keep their service and their price, and the screen listed them after saving:
move them one by one, or book the new service on another day (appointments#252). Appointments
already in progress or already turned into a sale never change service.
