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

## The clock is the business's, and the business does not own it

There is exactly one authority for what time it is here, and it is **the core**: the hub resolves
the business timezone with `settings::timezone_of` (the declared `hub_settings.timezone`, or the one
deduced from the country/region) and hands it to everything that needs it —
`context.timezone` for a WASM handler, `:timezone` for declarative SQL, `erplora.timezone` for the
Web Component. This module keeps **no timezone of its own**: a second copy is a second answer
waiting to rot.

**The device never rules.** Not the receptionist's tablet, not the stylist's phone, not the session
clock of the database. A tablet set to another country used to paint the salon's day shifted and
write bookings on its own clock — the failure Square carried for years and closed by locking the
zone to the business.

Two natures, deliberately kept apart:

| | What it is | How it travels |
|---|---|---|
| **Instant** | a point in time (`start_datetime`, `end_datetime`) | ISO 8601 with **the business wall clock and its offset** (`2026-08-03T11:00:00+02:00`) |
| **Wall time** | a civil clock reading (a recurring template's `time`, a schedule's hours) | `HH:MM` + the business zone; **never converted at rest** |

The stored text carries both readings on purpose: the instant (offset applied) and the salon's wall
clock (the first 19 characters), which is what the availability engine compares row against row.

### Daylight saving is decided, not guessed

The three answers are the **core's**, so a `cron` trigger and a recurring series can never disagree
about what «02:30 on the day the clock changes» means:

- a **normal** wall time is itself;
- an **ambiguous** one (the hour that happens twice in autumn) is the **first** pass;
- a **non-existent** one (the hour the spring jump skips) is refused at the screen
  (`appointments.invalid_local_time` — never quietly moved to the hour next door), and for a series
  already on the books it lands on **the instant the clock jumped into it**, because losing an
  occurrence in silence means losing it until the client is at the door.

A recurring series **keeps its wall time** across a change: an 11:00 appointment is at 11:00 in
March and at 11:00 in April, and the instant is what moves. The agenda's day window is the business
day, which lasts **23 or 25 hours** on those two days — never `midnight + 24 h`.

Cost, stated out loud: the handler links the full IANA table (`chrono-tz`, the same crate the
runtime uses), which is most of `dist/handler.wasm`'s size. The cheap alternative was our own
timezone engine, which fails silently twice a year.

## Numbers, prices and times

- Appointment numbers are `APT-YYYYMMDD-NNNN`, allocated atomically per hub per day — and the day
  is the **business** day, the same one the cash register closes on, not the UTC one.
- The service price is copied onto the appointment in **integer cents** (ADR-0123).
- Datetimes are **ISO 8601 with offset**. The per-professional timeline positions blocks by reading
  the time it is given, so it must be handed **business wall-clock time**, not a UTC instant.
- Weekdays are **0 = Monday** through **6 = Sunday**.
