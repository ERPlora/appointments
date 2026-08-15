# Appointments — Concepts

The things people get wrong on their first day.

## Capacity is the number of professionals, not a number of slots

Overlap is checked **per professional**. Two different people can be booked at the same time — that
is a salon with two chairs, not a conflict. A **second booking for the same professional** inside an
existing appointment's window is refused.

That single rule is what makes the agenda behave like a real diary.

## `allow_overlapping` switches the check off completely

It is off by default, and it is not a subtle knob: turning it **on disables the overlap check
entirely**, so anyone can be booked any number of times at once. Use it only for a business that
genuinely works that way (a class, a walk-in queue).

## A booking must name a customer, a service and a professional

Free-text bookings are rejected — not just discouraged by the form, but **refused by the runtime**,
because the payload schema requires the three ids.

There is a reason for each:

- the **service** provides the duration, so without it there is no window to check;
- the **professional** is what overlap is measured against;
- the **customer** is who the appointment is for.

Older bookings that predate the professional requirement have none, and they appear in the
**"unassigned"** lane so they do not become invisible.

## A transition that does not apply is refused, not ignored

Each state change is guarded by the state it comes from, and returns a domain error when it does not
apply:

| Action | Requires | Refusal |
|---|---|---|
| Confirm | `pending` | `appointments.cannot_confirm` |
| Start | `confirmed` | `appointments.cannot_start` |
| Complete | `in_progress` | `appointments.cannot_complete` |
| Cancel | not already finished | `appointments.cannot_cancel` |
| No-show | a state where it makes sense | `appointments.cannot_mark_no_show` |

This matters more than it looks. A refused transition **rolls back everything** — no row change, no
history entry, no event. Previously a repeated action returned OK and **emitted the event again**, so
whoever was listening heard twice about something that happened once.

The history entry is deliberately tied to the update that produced it, so a repeat cannot leave a
history row behind and fool the guard.

## Cancel and no-show are outcomes, not deletions

Both keep the appointment and its history — one records that the customer called, the other that they
did not come. That is the data you need to spot a customer who never shows up.

**Deleting** is a separate, destructive, admin-only action. In day-to-day work you cancel.

## Rescheduling excludes the appointment from its own overlap check

Moving a booking by ten minutes would otherwise clash with the slot it currently occupies. The check
knows to ignore the appointment being moved.

Rescheduling something already completed, cancelled or marked no-show **fails** rather than quietly
succeeding.

## Availability has reasons, and they are worth reading

When a slot is not free, you are told **why**:

| Reason | Meaning |
|---|---|
| `overlap` | That professional is already booked then |
| `outside_schedule` | You are not open at that time |
| `blocked` | Holiday, vacation, break or maintenance covers it |
| `too_soon` | It breaks the minimum booking notice |
| `too_far` | It is beyond how far ahead you allow bookings |
| `invalid_start` | The start is in the past or unparseable |

"No slots today" almost always means a schedule is missing, not that the day is full.

## Blocked time with no professional blocks everybody

Leaving the professional empty on a block means it applies to the **whole hub** — that is how a
public holiday is expressed. Set a professional to block only that person's vacation.

## A recurring template is not a set of appointments

The template describes the pattern. Nothing exists in the agenda until you **materialise** it, and
materialising:

- only fills the window you ask for (by default from today up to your maximum advance booking);
- **skips** occurrences in the past and occurrences that would clash;
- respects the template's end date and maximum number of occurrences;
- creates at most **50** appointments per run.

Monthly recurrence keeps the same day of the month, clamping when the month is shorter.

## Nothing sends reminders

The settings hold reminder and cancellation policy, and the appointment has reminder flags. **No code
in this module sends anything.** If you expect a customer to be texted the day before, that comes
from somewhere else.

## External calendars are somebody else's job

There is no Google Calendar field here, on purpose. A satellite module listens to the events this one
already emits and injects itself into this screen — so uninstalling it leaves no trace in the
appointments data.

## Numbers, prices and times

- Appointment numbers are `APT-YYYYMMDD-NNNN`, allocated atomically per hub per day.
- The service price is copied onto the appointment in **integer cents** (ADR-0123).
- Datetimes are **ISO 8601 with offset**. The per-professional timeline positions blocks by reading
  the time it is given, so it must be handed **local wall-clock time**, not a UTC instant.
- Weekdays are **0 = Monday** through **6 = Sunday**.
