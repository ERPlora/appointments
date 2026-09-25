# Appointments — Overview

## What this module does

Appointments is the diary of a booking-based business — a salon, a clinic, a workshop. It books a
slot for a **customer**, against a **service** and a **professional**, and carries that booking
through its life: pending, confirmed, in progress, and then completed, cancelled or a no-show. It
knows when you are open (the **Schedules** module), when you are not (blocked time), and it
refuses to double-book the same professional.

It also holds recurring templates, so "every other Tuesday at 10" can be turned into real
appointments.

## What this module does NOT do

- **It does not charge anything.** Turning a finished appointment into a sale happens in the till;
  this module only records that the appointment was completed.
- **It does not send reminders.** The settings describe reminder rules, but nothing in this module
  sends an email, an SMS or a WhatsApp message.
- **It does not sync with external calendars.** Google Calendar is a separate satellite module that
  listens to the events this one emits. Nothing about an external calendar is stored here.
- **It does not define services or staff.** It reads them from `services` and `staff`.
- **It does not take online bookings from the public.** That is `online_booking`.

## Modules it connects to

**Depends on `customers`, `services` and `staff`** — all three are installed with it, and all three
are needed to book: a booking without a customer, a service and a professional is not a booking.

| It reads | For |
|---|---|
| `customers` | The customer being booked |
| `services` | The service, its price and its **default duration** |
| `staff` | The professional — only those marked bookable |

It reads them through their **public queries** and stores their ids plus a denormalised copy of the
name, phone and price. There are no cross-module foreign keys.

**Events it emits** — one per thing that happens:

| Event | When |
|---|---|
| `appointments.appointment.created` | a booking is made — one per appointment, also for each appointment of a batch booking and each occurrence a recurring series books |
| `appointments.appointment.updated` | its details change |
| `appointments.appointment.confirmed` / `.started` / `.completed` | it advances |
| `appointments.appointment.cancelled` / `.no_show` | it ends badly |
| `appointments.appointment.rescheduled` | it moves |
| `appointments.appointment.deleted` | it is removed |
| `appointments.blocked_time.created` | time is blocked |
| `appointments.recurring.created` | a recurring template is created |
| `appointments.settings.updated` | the settings are saved |

**Events it listens to** — none. Other modules react to appointments, not the other way round.

## Where its numbers come from

- **Appointment numbers** are `APT-YYYYMMDD-NNNN`, from an atomic per-day counter.
- **Service prices are integer cents** (ADR-0123), copied onto the appointment when it is booked.
- **Times are ISO 8601 with an offset** — this module is the only one in the domain with genuinely
  timezone-aware datetimes, which is why it is the natural first client for calendar sync.
- **Days of the week are 0 = Monday … 6 = Sunday.**

## The lifecycle

```
pending ──▶ confirmed ──▶ in_progress ──▶ completed
   │            │              │
   └────────────┴──────────────┴──▶ cancelled / no_show
```

Every transition is guarded, recorded in the history, and emits its own event.
