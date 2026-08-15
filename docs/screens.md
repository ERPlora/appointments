# Appointments — Screens

The module contributes one tab to the hub navigation: **Appointments** — the agenda. Everything else
(schedules, blocked time, recurring templates, settings) is reached from inside it.

## Appointments — the agenda

Two ways of looking at the same day, with a switch between them:

- **List** — the appointments of the scope you chose (day, status), with the customer, the service
  and the state of each.
- **Per professional** — a timeline with **one row per bookable professional**, plus an
  **"unassigned"** lane for older bookings that have no professional. Tapping an empty gap
  pre-fills a new booking with that professional and that time.

Requires `appointments.view_appointment`.

### Book an appointment

1. Press to create. **Customer, service and professional are all required** — you pick them from
   real lists, not by typing a name.
2. The **service decides the duration** by default; you can override it for this one booking.
3. Pick the start time. Free slots for the day are shown
   (`appointments.availability.slots`).
4. Save.

Before writing, the hub checks the slot is really free **for that professional**. If it is not, you
get a plain explanation — not a database error. The booking is created `pending` with its number
`APT-YYYYMMDD-NNNN`, and its creation is written to the history.

Requires `appointments.add_appointment` — an employee has this.

### Move an appointment through its states

| Action | From | Needs |
|---|---|---|
| **Confirm** | `pending` | `appointments.change_appointment` |
| **Start** | `confirmed` | `appointments.change_appointment` |
| **Complete** | `in_progress` | `appointments.change_appointment` |
| **Cancel** (with a reason) | anything not already finished | `appointments.change_appointment` |
| **No-show** | a booking whose time passed | `appointments.change_appointment` |

Each writes its own history entry and emits its own event. An action that does not apply is
**refused with a clear code** — see [limits.md](limits.md).

### Reschedule

Pick the new date and time. The check that the slot is free **excludes the appointment itself**, so
moving it by ten minutes does not report a clash with its own old slot.

Rescheduling an appointment that is already finished, cancelled or a no-show **fails** — it does not
silently pretend to work.

Requires `appointments.change_appointment`.

### See the detail and the history

Opening an appointment shows everything about it plus its **audit trail**: one entry per transition,
with what changed. Cancelling stores the reason in that entry.

### Delete

Destructive, with confirmation, and **admin only** (`appointments.delete_appointment`). Prefer
cancelling — it keeps the record.

## Working hours (schedules)

A schedule is a named availability template, with one or more **time slots** per weekday.

1. Create the schedule, giving it a name. One can be the default.
2. Add time slots: **day of the week** (0 = Monday … 6 = Sunday), start time and end time, as
   `HH:MM`.
3. The agenda only offers slots inside them.

Listing needs `appointments.view_schedule`; creating and deleting need
`appointments.manage_schedule`. A slot is unique per schedule, day and start time.

## Blocked time

Holidays, vacations, breaks, maintenance — time when nothing can be booked.

1. Create a block with a **title**, a **start** and an **end**.
2. Choose its type: `holiday`, `vacation`, `break`, `maintenance` or `other`.
3. Mark it all-day if it covers whole days.
4. Leave the professional empty to block **the whole hub**, or set one to block only that person.

Needs `appointments.manage_schedule` to create or delete, `appointments.view_schedule` to list.

## Recurring appointments

A template that says "this customer, this service, every week at this time".

1. Create it with the customer, the service, the **frequency** (`daily`, `weekly`, `biweekly` or
   `monthly`), the **time**, the **duration** and a **start date**.
2. Optionally add a day of the week, an end date or a maximum number of occurrences.
3. **Materialise** it to turn the template into real appointments in a date window.

Materialising skips slots in the past and slots that clash, and creates at most **50** appointments
per run. Creating a template needs `appointments.add_appointment`; deleting one needs
`appointments.change_appointment`.

## Settings

The module keeps a per-hub settings row read with `appointments.settings.get` and written with
`appointments.settings.upsert` (needs `appointments.manage_settings` — **admin only**).

| Setting | What it controls |
|---|---|
| **Allow overlapping** | Off by default. Turning it **on disables the overlap check entirely** |
| Default duration | Used when the service does not decide |
| Minimum booking notice | How soon before the slot a booking is still allowed |
| Maximum advance booking | How far ahead you may book |
| Calendar start and end hour | The window the agenda paints |
| Slot interval | The step between offered slots |
| Reminders and cancellation rules | Recorded as policy; nothing sends messages |

> The manifest declares **no settings tab today**, so these are reached through the agenda screen and
> the API rather than a shell-generated form. <!-- TODO: verify where the UI exposes them -->

## First-run setup

Appointments contributes an **optional** setup step called **"Your working hours"**: *Tell the hub
the days and times you work, so the agenda only offers slots while you are open.* It is done once the
business has active schedules with weekly time slots, and needs `appointments.manage_schedule`.
