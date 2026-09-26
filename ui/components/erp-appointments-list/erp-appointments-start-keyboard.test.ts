// appointments#204 — the «Start» of a booking must be fillable from the KEYBOARD.
//
// The create and reschedule panels asked for the start in ONE native `datetime-local` field. In
// Chromium its year segment takes up to six digits (275760), so after typing «2026» the caret
// stays in the year and never reaches the hour: typing «26/09/2026 10:00» (or «260920261000», or
// pasting it) leaves the input EMPTY, no `ionInput` is ever emitted, and «Add appointment» stays
// greyed out. Reproduced with real key presses on Ionic 8.8.9 + Chromium; the same keystrokes on a
// `date` field followed by a `time` field land «2026-09-26» and «10:00».
//
// The fix is the convention the rest of the suite already follows (reservations, schedules,
// staff) and the booking screens of the market use (Square, Fresha, Odoo): a DATE field and a
// TIME field. These tests drive the panels through the events the browser emits from those two
// fields — never by assigning the component state — so a single `datetime-local` cannot pass.
import { beforeEach, describe, expect, it } from 'vitest';

process.env.TZ = 'Europe/Madrid';

const commands: { name: string; payload: Record<string, unknown> }[] = [];

const APPOINTMENT = {
  id: 'a1',
  appointment_number: 'APT-1',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Haircut',
  service_price: 2000,
  staff_id: 's1',
  staff_name: 'Eva Pro',
  start_datetime: '2026-08-07T10:00:00+02:00',
  end_datetime: '2026-08-07T10:30:00+02:00',
  duration_minutes: 30,
  status: 'confirmed',
};

beforeEach(() => {
  commands.length = 0;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return [APPOINTMENT];
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '600111222', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 }], total: 1 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  newCustomerId: string;
  newServiceId: string;
  newStaffId: string;
  newStart: string;
  rescheduleStart: string;
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  updateComplete: Promise<unknown>;
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const field = (el: Wc, testid: string) =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { value?: string }) | null;

/** What the browser does when the receptionist finishes typing into a native field: the input
 *  holds the parsed value and `ion-input` re-emits the native `input` as `ionInput`. */
async function type(el: Wc, testid: string, value: string) {
  const input = field(el, testid);
  expect(input, `${testid} must be rendered`).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

const submit = (el: Wc, testid: string) => field(el, testid) as HTMLElement;

describe('appointments#204 — new appointment: Start is a date field + a time field', () => {
  it('offers no datetime-local: the date and the time are two keyboard-friendly fields', async () => {
    const el = await mount();
    const form = el.shadowRoot.querySelector('form[slot="create"]')!;
    expect(form.querySelector('ion-input[type="datetime-local"]'), 'the year segment traps the caret').toBeNull();
    expect(field(el, 'appointments-list-start')?.getAttribute('type')).toBe('date');
    expect(field(el, 'appointments-list-start-time')?.getAttribute('type')).toBe('time');
  });

  it('typing the date and then the time enables «Add appointment» and books that wall clock', async () => {
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newServiceId = 'sv1';
    el.newStaffId = 's1';
    await el.updateComplete;

    await type(el, 'appointments-list-start', '2026-09-26');
    expect(submit(el, 'appointments-list-submit').hasAttribute('disabled'), 'a date without a time is not a start').toBe(true);

    await type(el, 'appointments-list-start-time', '10:00');
    expect(submit(el, 'appointments-list-submit').hasAttribute('disabled'), 'date + time typed → bookable').toBe(false);
    expect(el.newStart).toBe('2026-09-26T10:00');
  });

  it('the time can be typed first and the date afterwards', async () => {
    const el = await mount();
    await type(el, 'appointments-list-start-time', '17:30');
    expect(el.newStart, 'half a start is no start').toBe('');
    await type(el, 'appointments-list-start', '2026-09-27');
    expect(el.newStart).toBe('2026-09-27T17:30');
  });

  it('a start set from the timeline shows up split in both fields, and editing one keeps the other', async () => {
    const el = await mount();
    el.newStart = '2026-08-07T11:15';
    await el.updateComplete;
    expect(field(el, 'appointments-list-start')?.value).toBe('2026-08-07');
    expect(field(el, 'appointments-list-start-time')?.value).toBe('11:15');

    await type(el, 'appointments-list-start-time', '12:45');
    expect(el.newStart, 'changing the hour must not drop the day').toBe('2026-08-07T12:45');
  });

  it('clearing the time (the native field empties) takes the start away again', async () => {
    const el = await mount();
    el.newStart = '2026-08-07T11:15';
    await el.updateComplete;
    await type(el, 'appointments-list-start-time', '');
    expect(el.newStart).toBe('');
    expect(field(el, 'appointments-list-start')?.value, 'the typed day stays on screen').toBe('2026-08-07');
  });
});

describe('appointments#204 — reschedule: the new start is a date field + a time field', () => {
  it('pre-fills both fields and lets the hour be retyped from the keyboard', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
    await el.updateComplete;

    const form = el.shadowRoot.querySelector('form[slot="create"]')!;
    expect(form.querySelector('ion-input[type="datetime-local"]'), 'the year segment traps the caret').toBeNull();
    expect(field(el, 'appointments-list-reschedule-start')?.getAttribute('type')).toBe('date');
    expect(field(el, 'appointments-list-reschedule-start')?.value).toBe('2026-08-07');
    expect(field(el, 'appointments-list-reschedule-start-time')?.getAttribute('type')).toBe('time');
    expect(field(el, 'appointments-list-reschedule-start-time')?.value).toBe('10:00');

    await type(el, 'appointments-list-reschedule-start-time', '16:45');
    expect(el.rescheduleStart).toBe('2026-08-07T16:45');
    await type(el, 'appointments-list-reschedule-start', '2026-08-08');
    expect(el.rescheduleStart).toBe('2026-08-08T16:45');
    expect(submit(el, 'appointments-list-reschedule-submit').hasAttribute('disabled')).toBe(false);
  });
});
