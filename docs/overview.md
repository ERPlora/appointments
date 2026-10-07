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
name, phone and price. There are no cross-module foreign keys. The phone is copied in international
form (`+34600111222`, read in the business's country), the form the «appointment confirmed» WhatsApp
looks the conversation up by.

**Scheduled task** — `phones_to_e164`, every 15 minutes (appointments#313): the upcoming pending or
confirmed appointments whose phone is still saved as typed («600 111 222», booked before phones were
saved in international form) get it rewritten in international form, read in the business's country.
A phone that cannot be read as a number is left as it is; a phone edited meanwhile is not overwritten.
It writes no history line and sends no notice: the number is the same, only its form changes.

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

`appointments.appointment.created` has **one payload whatever the door** — one by one, a batch, a
recurring series (appointments#174) — built from the row that was written: `appointment_id` (also
as `new_id`, its old name), `customer_id`/`customer_name`, `service_id`/`service_name`/
`service_price` (cents), `staff_id`/`staff_name`, `start_datetime`/`end_datetime`,
`duration_minutes`, `status`, `notes`, `booked_online` and `recurring_id`. Contact details and internal notes are not in it: read the
appointment.

**Events it listens to**

| Event | Command | What it does |
|---|---|---|
| `sales.sale.created_from_appointment` (from `sales`) | `appointments._mark_converted` | Marks the appointment as converted into that sale |
| `customer.merged` (from `customers`) | `appointments._on_customer_merged` | When two customer sheets are merged, every appointment (live or deleted, any status) and every recurring series of the absorbed sheet moves to the surviving one, in this hub only; names on the booking stay as they were written (customers#86) |
| `customer.anonymized` (from `customers`) | `appointments._on_customer_anonymized` | When a customer's personal data is erased (GDPR), every appointment of that customer in this hub (live or deleted, any status) loses the customer's name, phone, email, both notes and the cancellation reason; their recurring series lose the name; the history of those appointments loses the name and the cancellation reasons. The appointment itself, its number, service, price, professional, time, status and sale stay; a future appointment is not cancelled. Where the name was, the agenda shows «Deleted customer» (pm#637) |

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
