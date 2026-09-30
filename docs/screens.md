# Appointments — Screens

The module contributes one tab to the hub navigation: **Appointments** — the agenda. Everything else
(blocked time, recurring templates, settings) is reached from inside it. The opening hours are NOT
here: they are set in the **Schedules** module (appointments#117).

## Appointments — the agenda

One compact bar above the list holds the whole scope of the query, on a **single row** at every
width (appointments#93): a day stepper — **‹ date ›** — the status filter, and the view switch. On a
phone the view switch keeps only its icons; the day is what stays readable, which is what every
appointment book does (Fresha, Vagaro, Square Appointments, Google Calendar). Measured at 390 px,
the bar went from 168 px on three stacked rows to 48 px, and the first appointment moved from 54 %
of the screen to 39 %.

The date, in the day stepper and in every booking form, is a **text field painted in the hub's own
language** (not a native browser date input, which paints the device's locale regardless of the
hub's — appointments#205), with a small calendar button next to it for picking the day with the
mouse. That button opens a compact date picker (appointments#223): one month, no Month/Agenda
switch, the week starting where the hub language starts it (Monday in Spanish, Sunday in US
English), and days you can move through with the arrow keys and pick with Enter.

Every field of the agenda — the day and the status filter in the bar, and every field of every
panel — is drawn **in its box** (an outlined field), so it is obvious where to type or pick
(appointments#204, appointments#221). The bar's day keeps its width and still shows the whole date,
year included, next to its calendar button.

The time of a booking (new appointment and «Move») is painted the same way: a text field in the
**hub language's own clock** — 24 h in Spanish, «02:30 PM» in English — typed in one go (`hh:mm`,
AM/PM accepted in English) and repainted when you leave the field, instead of a native browser time
input, which follows the device's clock (appointments#214).

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
3. Pick the start: a **Day** field and a **Time** field. Once the service, the professional and the
   day are chosen, the **free times** of that day for that professional appear as buttons under
   **Time** (`appointments.availability.slots`, the same list the assistant and WhatsApp offer: it
   already leaves out the closed hours, blocked time, the agenda and the professional's shift and
   leave). Tapping one fills the time; changing the service, the minutes, the professional or the
   day asks again. The list leaves out the next hours inside the online **minimum notice**, which the
   counter may still book: type those by hand (appointments#234). Any other time can still be typed; the door refuses
   a time that is taken, outside your hours or outside the professional's shift, with the reason.
   Both can be typed from the keyboard — typing
   «26/09/2026 10:00» in one go works (the space after the date jumps to the time) — and pasting a
   whole start («26/09/2026 10:00», or `2026-09-26T10:00`) fills both. The date is read in the
   order of the hub's language (day/month in Spanish).
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

The panel is the front desk, so it can move an appointment to **right now** — the minimum notice is
for the bookings customers make themselves (appointments#165) — and to a time that **has already
passed**, so the agenda shows when the client was really seen (appointments#156). A past time shows
a warning before saving, not a wall. Opening hours, blocked time, the maximum advance and overlaps
still apply. A client moving her own appointment through WhatsApp keeps the minimum notice. If the
move is refused, the reason shows inside the panel and in a notification.

Dragging the block on the staff agenda is the front desk too: it can drop an appointment into the
next half hour (appointments#167). It **cannot** drop it into a time that has already passed — a
block dropped there by mistake gets no warning first — so moving to the past stays in the panel.

Requires `appointments.change_appointment`.

### See the detail and the history

Opening an appointment shows everything about it plus its **audit trail**: one entry per transition,
with what changed. Cancelling stores the reason in that entry.

### Delete

Destructive, with confirmation, and **admin only** (`appointments.delete_appointment`). Prefer
cancelling — it keeps the record.

## Working hours

> The opening hours are set in the **Schedules** module, and only there (appointments#117). This
> module used to carry a second timetable of its own — its own screen, its own operations and its
> own first-run step — and a salon that changed the hours in one place kept being answered by the
> other. Now the agenda READS the hours, bank holidays and overrides of Schedules and offers only
> what fits inside them. The old rows stopped being written then and were retired altogether in
> appointments#118, so there is nothing left here to disagree with Schedules.

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

**Add** (the table's own button, appointments#209) opens the **New repeating appointment** panel:
customer, service and professional picked from their modules (only bookable services and
professionals), the frequency, the weekday (weekly and every-two-weeks patterns only), the start as
**Day + Time** — the same two fields as a new appointment, so it can be typed in one go or pasted —,
the minutes (pre-filled from the service) and, optionally, an end date or a number of appointments.
**Create repeating appointment** creates the series and books its window straight away, so it lands
on the agenda; if the booking fails the series is still created and listed, and the screen says to
use **Book appointments** on its row. Tapping **Add** while a series is being edited (or still
loading) drops that edit: the panel shows a clean new-series form and never updates the other series.

Dates and times in this view follow the **hub's language**, like the agenda's (appointments#217):
**Day**, **Until** and **Time** of a new series, and **Time** when editing one, are text fields
painted in the hub's day/month order and clock (`dd/mm/aaaa` and 24 h in Spanish, `mm/dd/yyyy` and
«02:30 PM» in English) instead of the browser's native pickers, which follow the device's locale;
**Day** and **Until** have the same calendar button. A half-typed date or time is not taken: the
save button stays off (an «Until» left half-typed never becomes a series with no end). The list
shows the pattern's time, the start and the end the same way.

Every field of both panels — new series and edit series (frequency, weekday, time, minutes) — is
drawn in its box, like the new-appointment panel (appointments#221).

If the hub refuses a save — creating a series or changing one — the reason shows **inside the
panel**, right above the save button, and the panel scrolls to it (pm#513). On a phone the panel
covers the whole screen, so a message on the list underneath would never be seen. What goes wrong in
a row action (**Book appointments**, **Delete**, pausing a series) shows on the list, and the next
save clears it.

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

### Handing a series to another professional (appointments#248)

The edit panel also has a **Professional** field, with the series' current professional picked (and
kept in the list even when they no longer take appointments). Picking someone else hands the series
to them from that occurrence **and all the following ones**, the same cut as a pattern change — the
earlier dates keep who did them. Only professionals who take appointments are offered, and the hub
refuses one who does not perform the series' service.

Before saving, the panel says how many booked appointments go to them. Each of them is judged on the
**new professional's** agenda (their shift, their blocked time, their other appointments): the ones that
fit are handed over, the ones that do not **stay as they were, with the professional they had**,
and after saving the screen lists them with the reason. The price already booked on each appointment
is kept.

A series saved without a professional says so in the panel: choosing one and saving books its
appointments straight away.

### Changing the service of a series (appointments#252)

The edit panel also has a **Service** field, with the series' current service picked. A customer
who goes from «Cut» to «Cut and colour» no longer means deleting the series and creating it again:
picking another service changes it from that occurrence **and all the following ones**, the same cut
as a pattern change — the earlier dates keep the service they had. Only active, bookable services
are offered, and the hub refuses one the series' professional does not perform.

Picking a service fills the minutes with its catalogue length, as the new-series form does; you
can still type other minutes. Before saving, the panel says how many booked
appointments take the new service. Each of them takes the new service's **name, price and length**
(her own price for it first, then the catalogue's) — so the same series never charges two prices —
if the longer slot still fits the agenda; the ones that do not **stay as they were, with the service
and price they had**, and after saving the screen lists them with the reason.

## Settings

The module keeps a per-hub settings row read with `appointments.settings.get` and written with
`appointments.settings.upsert` (needs `appointments.manage_settings` — **admin only**).

| Setting | What it controls |
|---|---|
| **Allow overlapping** | Off by default. Turning it **on disables the overlap check entirely** — the agenda still asks for confirmation before booking on top of somebody (appointments#86) |
| Default duration | Used when the service does not decide |
| Minimum booking notice | How soon before the slot a booking is still allowed. Measured on the **business clock** (appointments#88): a hub in Madrid counts from the salon's wall time, not from the server's UTC. It governs the bookings customers make themselves (online, WhatsApp, booking requests); the front desk can always book for right now (appointments#157) |
| Maximum advance booking | How far ahead you may book |
| Calendar start and end hour | The window the agenda paints |
| Slot interval | The step between offered slots |
| Reminders and cancellation rules | Recorded as policy; nothing sends messages |

> The manifest **does** declare a `settings` block (`schemas/settings_upsert.json`, read with
> `appointments.settings.get`, written with `appointments.settings.upsert`), so the shell renders
> the form itself; `tests/settings.contract.test.py` pins that wiring.
