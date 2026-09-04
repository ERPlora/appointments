# Appointments — Screens

The module contributes one tab to the hub navigation: **Appointments** — the agenda. Everything else
(schedules, blocked time, recurring templates, settings) is reached from inside it.

## Appointments — the agenda

One compact bar above the list holds the whole scope of the query, on a **single row** at every
width (appointments#93): a day stepper — **‹ date ›** — the status filter, and the view switch. On a
phone the view switch keeps only its icons; the day is what stays readable, which is what every
appointment book does (Fresha, Vagaro, Square Appointments, Google Calendar). Measured at 390 px,
the bar went from 168 px on three stacked rows to 48 px, and the first appointment moved from 54 %
of the screen to 39 %.

Three ways of looking at the agenda, with a switch between them:

- **List** — the appointments of the scope you chose (day, status), with the customer, the service
  and the state of each.
- **Per professional** — a timeline with **one row per bookable professional**, plus an
  **"unassigned"** lane for older bookings that have no professional. Tapping an empty gap
  pre-fills a new booking with that professional and that time.
- **Repeating** — the repeating appointments themselves, not their occurrences
  (see [Repeating appointments](#repeating-appointments) below). The day stepper and the status
  filter are the scope of the *day's* query, so they are hidden here rather than left promising a
  filter that does not apply.

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

If the hub has **Allow overlapping** on, the agenda asks before double-booking: a Confirm/Cancel
prompt naming who the slot clashes with and at what time ("Ana López · 11:00"). *Book anyway*
creates it; *Pick another time* writes nothing and leaves the panel as you left it. The same
question guards **moving** an appointment and **dragging** it in the per-professional view — there,
cancelling puts the block back where it was. With the toggle off nothing changed: the booking is
refused, as it always was.

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

> ⚠️ **Set your opening hours in the Schedules module, not here** (appointments#102). Since that
> change the booking door reads the hours, bank holidays and overrides of **Schedules**, which is
> where the rest of the product asks whether the business is open. This screen is the module's own
> older timetable: it still answers while Schedules has no rule at all, so a salon configured
> before the change keeps working, and it is being retired in appointments#105.
>
> Since appointments#105 the **times a screen offers are the times the door accepts**: before
> listing free slots, the booking panel asks the agenda which stretches the business is open on
> that date and drops whatever falls outside them, so a salon whose hours live in Schedules is no
> longer offered 10:00 and refused at 10:00. On a day Schedules closes, the panel says the business
> is **closed** rather than that the diary is full — they are different problems and only one of
> them is fixed by trying another professional.

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

## Repeating appointments

A template that says "this customer, this service, every week at this time".

1. Create it with the customer, the service, the **frequency** (`daily`, `weekly`, `biweekly` or
   `monthly`), the **time**, the **duration** and a **start date**.
2. Optionally add a day of the week, an end date or a maximum number of occurrences.
3. **Materialise** it to turn the template into real appointments in a date window.

Materialising skips slots in the past and slots that clash, and creates at most **50** appointments
per run. Creating a template needs `appointments.add_appointment`; deleting one needs
`appointments.change_appointment`.

### The Repeating view (appointments#91)

Until it existed, the only way into a series was through one of its occurrences in the agenda — so a
series whose occurrences had not been materialised yet, or whose window had already passed, had no
row anywhere to open it from. It is a **view of the agenda**, not a menu entry of its own: no
product in the sector hangs a "series page" off the menu, because the series is managed where the
agenda is.

The list shows, per series: customer, service, professional, the pattern in words ("Every week ·
Monday · 11:00"), when it starts and when it ends. Each row offers three actions:

- **Edit series** — opens the panel below.
- **Book appointments** — materialises the window for that series.
- **Delete** — destructive, as before.

Opening a series shows how many appointments it already has on the books, from which date the change
will apply, how many are still ahead, and — when the series came out of a split — that it continues
an earlier one. Appointments that are **already charged** are named before you save, because they
are the ones that will *not* move.

### Changing the pattern (appointments#90)

The panel edits the **time**, the **duration**, the **frequency** and the **day of the week**, and
the change always applies to that occurrence **and all the following ones**. The series is split in
two: the old half stops the day before, a new one starts at the cut.

Changing the frequency or the weekday moves the series to **different days**, so there is no
one-to-one match with what is already booked:

- an appointment whose date still falls on the new pattern is **moved**, keeping its number and its
  history;
- one that no longer fits is **cancelled** — never deleted, so the customer's record survives, and
  never if it is already in progress or already turned into a sale;
- the appointments of the new pattern are then **booked** (the same "Book appointments" step, run
  for you), because a day change that leaves the new day empty is only half the job.

After saving you are told what happened: how many moved, how many were cancelled because they no
longer fit, and how many were left alone because they are already charged. Anything before today is
never touched.

## Settings

The module keeps a per-hub settings row read with `appointments.settings.get` and written with
`appointments.settings.upsert` (needs `appointments.manage_settings` — **admin only**).

| Setting | What it controls |
|---|---|
| **Allow overlapping** | Off by default. Turning it **on disables the overlap check entirely** — the agenda still asks for confirmation before booking on top of somebody (appointments#86) |
| Default duration | Used when the service does not decide |
| Minimum booking notice | How soon before the slot a booking is still allowed. Measured on the **business clock** (appointments#88): a hub in Madrid counts from the salon's wall time, not from the server's UTC |
| Maximum advance booking | How far ahead you may book |
| Calendar start and end hour | The window the agenda paints |
| Slot interval | The step between offered slots |
| Reminders and cancellation rules | Recorded as policy; nothing sends messages |

> The manifest **does** declare a `settings` block (`schemas/settings_upsert.json`, read with
> `appointments.settings.get`, written with `appointments.settings.upsert`), so the shell renders
> the form itself; `tests/settings.contract.test.py` pins that wiring.

## First-run setup

Appointments contributes an **optional** setup step called **"Your working hours"**: *Tell the hub
the days and times you work, so the agenda only offers slots while you are open.* It is done once the
business has active schedules with weekly time slots, and needs `appointments.manage_schedule`.
