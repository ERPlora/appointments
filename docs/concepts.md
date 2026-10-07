# Appointments — Concepts

The things people get wrong on their first day.

## Capacity is the number of professionals, not a number of slots

Overlap is checked **per professional**. Two different people can be booked at the same time — that
is a salon with two chairs, not a conflict. A **second booking for the same professional** inside an
existing appointment's window is refused.

That single rule is what makes the agenda behave like a real diary.

## `allow_overlapping` switches the check off completely — but the agenda still WARNS

It is off by default, and it is not a subtle knob: turning it **on disables the overlap check
entirely**, so anyone can be booked any number of times at once. Use it only for a business that
genuinely works that way (a class, a walk-in queue).

What "on" does **not** mean is "book on top of somebody in silence". Since appointments#86 the
agenda asks first: creating, moving or dragging an appointment onto a live one raises a
Confirm/Cancel prompt naming **who** it clashes with and **at what time**, and nothing is written
until you accept. It is the shape the whole sector uses — Phorest prompts, Square warns before
double-booking from the staff calendar, DaySmart ships it as *Warn* / *Don't Allow*, Fresha allows
it in-store only and Vagaro behind an explicit *Double Book* action.

One place deliberately does **not** ask:

- **Moving a whole series** (`appointments.recurring.update`, scope *this and following*). That is
  N occurrences the server relocates, not one slot. Since appointments#236 each of them is judged
  like a single move (opening hours, her shift, blocked time, the past, the minimum notice and —
  with the toggle off — another appointment): the ones that do not fit stay on their own slot and
  the screen lists them with the reason, instead of the whole series being refused or moved on top
  of somebody. Handing the series to another professional (appointments#248) follows the same rule
  on the **new** professional's agenda: what does not fit keeps its slot and its professional.
  Changing the series' service (appointments#252) too: an appointment that does not fit the new
  service's length keeps its service and its price.

With the toggle **off** nothing changed: no prompt, and the server refuses the booking
(`_appointment_overlap_assert.sql`). Offering a "book anyway" that always fails would be worse than
not offering it.

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

The same move can hand the appointment to another professional and/or service (appointments#263).
Then the slot is judged on the **new** professional's agenda, hours and blocked time, and she must
be bookable and perform the service — exactly what booking it fresh would check. The history line
says what changed, from who to who.

## Availability has reasons, and they are worth reading

When a slot is not free, the availability check tells you **why**:

| Reason | Meaning |
|---|---|
| `outside_schedule` | You are closed at that hour |
| `outside_staff_hours` | You asked about one professional, and they do not work then: off-shift, on their break or on approved leave |
| `overlap` | That professional is already booked then |
| `blocked` | Holiday, vacation, break or maintenance covers it |
| `too_soon` | It breaks the minimum booking notice |
| `too_far` | It is beyond how far ahead you allow bookings |
| `invalid_start` | The start is in the past or unparseable |

Being **closed** is on that list again since appointments#122, and it is the same verdict the
booking door gives: asking whether Tuesday at 8 is free used to answer YES from a salon that opens
at nine, and you only found out when the booking was refused. The opening hours belong to
**Schedules** and no SQL of this module can reach another module's tables, so the check reads them
the way the door does — through the handler — and answers with them. An hour it calls free is an
hour a booking will be accepted at.

`appointments.availability.day_opening` still answers the stretches you are open on a date, which
is what a calendar needs to draw the day; the check answers about ONE slot.

"No slots today" almost always means the opening hours of **Schedules** close that date, not
that the day is full — the booking screen asks `appointments.availability.day_opening` and hides
the slots outside what it answers.

These reasons are not only advice any more. `outside_schedule`, `blocked`, `too_soon`, `too_far`
and `invalid_start` are **refused at the door**: whoever books — the screen, the assistant, a flow,
`whatsapp_inbox`, the public API — gets the same answer, because the rule is checked where the
appointment is written and not only where it is drawn (appointments#89). Opening hours are read on
the **business clock**, so the two days a year the clock moves do not shift what counts as open.

**Where the opening hours come from** (appointments#102). They are the ones you set in
**Schedules**, not a second timetable of this module: the weekly hours, the **special days** (bank
holidays, one-off closures), the **overrides** (a range of dates with different hours) and the
split shifts of both. A special day that closes the salon closes it here too, and a lunch break is
closed time — an appointment that runs into it does not fit. Precedence, when several rules touch
the same date: the special day of that exact date, then a yearly one, then an override covering the
date, then the weekly hours. An overnight shift (20:00–02:00) holds a booking past midnight.

**And the screen shows the same set** (appointments#105). The list of free slots used to be
computed from this module's own older timetable, so a business whose hours had already moved to
Schedules was offered times the door then refused — better than not refusing them at all, but the
screen and the door disagreeing. The screen now asks the agenda for the open stretches of the date
it is showing, resolved by exactly the function the door runs, and offers only slots that fit
inside them: an appointment has to END before closing time, so the half slot that runs past it is
not offered either. A day the authority closes is shown as **closed**, not as a full diary. If
those hours cannot be read — a role without `appointments.view_schedule`, for instance — booking
still works with the old, wider list; when the cause is a fault rather than a permission, the panel
says so, because a list that has quietly stopped being checked looks exactly like one that was.

This module no longer keeps a timetable of its own at all (appointments#118). It used to answer
while Schedules carried no rule reaching the date — the salon configured before the hours moved.
Two things retired it: nothing had been able to WRITE those rows since appointments#117, and
Schedules now seeds a full week when it is installed (schedules#36), so «this hub has no hours»
stopped being the normal state of a new business. What was left was a refusal the owner could not
explain with anything visible: old hours nobody could reach, let alone edit.

So when Schedules carries no rule for the date, the door refuses **nothing**: a hub that has **not
configured its opening hours anywhere** can still book at any hour. «I have not set my schedule»
must not mean «I cannot take bookings» — the same call the trade makes (Setmore ships an off-hours
toggle, Acuity and Square let the counter book anyway). It is a state a fresh hub should never
reach, which is why `schedules` is a hard dependency from the version that seeds the week on.

The **professional's** own hours are a second door (appointments#98): booking one appointment,
asking whether a slot is free for a given professional, or listing the free slots of a day for one
professional (appointments#230), also checks that person's shifts, breaks and approved leave in
Staff — `outside_staff_hours` when they do not work then. A professional
with no working schedule set up for that day is not refused (only an approved absence refuses
there), for the same reason as above. Booking a batch, booking a recurring series and moving an
appointment check it too (appointments#229): a batch with one slot outside those hours is refused
whole; a series skips that occurrence — like a blocked day — and books the rest; a move is refused.
A series is checked against the professional's next 400 days: occurrences further out are booked
by a later run, as the series' window advances.

## Blocked time with no professional blocks everybody

Leaving the professional empty on a block means it applies to the **whole hub** — that is how a
public holiday is expressed. Set a professional to block only that person's vacation.

## A recurring template is not a set of appointments

The template describes the pattern. Nothing exists in the agenda until you **materialise** it, and
materialising:

- only fills the window you ask for (by default from now up to your maximum advance booking, to
  the hour: on the window's last day, an occurrence later than the time you book is not refused —
  it is booked by a later run, once it is within your maximum advance; appointments#289);
- **skips** occurrences in the past and occurrences that would clash;
- respects the template's end date and maximum number of occurrences;
- creates at most **50** appointments per run.

Monthly recurrence keeps the same day of the month, clamping when the month is shorter.

## Editing a series: two scopes, and «all events» is not one of them

Moving an appointment that belongs to a repeating series asks **which appointments the change
applies to — at save time, not when the panel opens** (Google, Apple and Fresha ask on save;
Outlook asks on open, which is the friction people report: you decide the scope before you know
what you are changing).

| Scope | What it does |
|---|---|
| **This appointment only** *(preselected)* | The `reschedule` of always, over one row. The rest of the series does not move. |
| **This and all following** | The series is **split in two**: the original template stops the day before, a new one starts at this occurrence, and **every** appointment already booked from here on moves to the new time, in one change. The whole series fits: measured on a real hub, a daily series booked to the 400-day horizon moves whole while the professional has up to ~3,400 other live appointments ahead; past that the edit is refused and nothing moves. |

**«All events» does not exist, on purpose.** It means rewriting a past that is already charged,
invoiced and chained into VeriFactu. No product of the salon vertical offers it — Fresha gives «all
future», Apple «All Future Events» — Odoo blocks it the moment you touch the time, Google hides it,
and RFC 5545 deprecated `RANGE=THISANDPRIOR` outright. Nothing is lost: cutting at the first future
occurrence already is «all the ones that still matter».

**Why a split and not a version of the same template.** The unique index is
`(hub_id, recurring_id, occurrence_date)`. A versioned template would hold two truths for the same
wall day under one id — exactly the duplicate that index exists to prevent. Two ids do not collide,
and `split_from_id` keeps the trail between the halves.

What editing the following occurrences never touches:

- **anything before today** — the cut is pulled forward to the business day if it points at the past;
- **a cancelled occurrence** — it is the *exception* of the series («not that week»), and an edit
  that resurrects it is the one that makes the receptionist stop trusting the screen;
- **an occurrence already turned into a sale** — it carries a fiscal record (ADR-0331).

And what did **not** move is **counted in the answer** (`moved`, `locked_invoiced`,
`kept_cancelled`). Doing this in silence is the failure every forum reports about the feature:
Google documents that it «resets any exceptions» and Microsoft repeats it, and neither warns first.

The occurrences that do move are rewritten **in place** — same row, same appointment number, same
history. Deleting and re-materializing would throw away exactly what the stylist needs at the chair.

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

## A flag is `true`/`false` on the wire and `0`/`1` at rest

One idea, one type at each boundary — and the two boundaries are deliberately different
(appointments#79):

- **At rest** a flag is an `INTEGER` 0/1. That is the hub's row contract (§2.5 / ADR-0007): the
  portable DDL has no `BOOLEAN`, and money and counters share the same column type.
- **On the wire** a flag is a JSON `boolean`, in **both** directions. The commands already declared
  it (`allow_overlapping`, `all_day`, `is_default`, `booked_online`…), so the queries say the same
  by projecting `col <> 0 AS col`.

Both halves are free, because the runtime already speaks both (`hub/crates/db/src/lib.rs`): a JSON
boolean is bound into an `INTEGER` column as 0/1 (hub#208 / ADR-0154 — no `CASE WHEN` needed), and
a boolean SQL expression comes back as JSON `true`/`false`, while a plain `INTEGER` column always
comes back as a number.

**Why it matters, and it is not the screen.** The Settings tab is generated *from* the schema, so
the form always sent booleans and never noticed the mismatch. What broke was everything that reads
before it writes — the assistant, the flows, the public API, any configuration script: `settings.get`
handed back `allow_overlapping: 0` and `settings.upsert` answered `422 … 0 is not of type "boolean"`.
The most ordinary operation an API has (read a row, change one field, save it back) was impossible.

Keeping `boolean` as the wire type — rather than relaxing the schemas to accept `0/1` as well — is
what preserves that generated form: a property that is no longer plainly `boolean` stops being a
toggle. Relaxing the schemas would also have kept the asymmetry instead of removing it.

`tests/flag_round_trip.postgres.test.py` holds the line: it fails if any query hands back a flag as
the bare `INTEGER` column, and it round-trips `settings` and `blocked_times` through a real Postgres
built from these migrations. **`services` and `schedules` still expose entity flags as
`"type": "integer", "enum": [0, 1]`** and should converge on this convention when they are next
touched — the rule is the same one, not an appointments-only habit.
