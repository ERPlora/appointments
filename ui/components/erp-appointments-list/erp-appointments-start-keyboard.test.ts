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
//
// appointments#205: the DATE half is no longer the native `date` input (Chromium paints it in the
// browser's locale, so a Spanish hub showed «mm/dd/yyyy»). It is a text field that shows and reads
// the date in the hub's language — «07/08/2026» in Spanish — and ISO typed in still lands.
import { beforeEach, describe, expect, it } from 'vitest';
import { pickCustomer } from '../../test/pick-customer';

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
    expect(field(el, 'appointments-list-start')?.getAttribute('type')).toBe('text');
    // appointments#214: the time is a text field painted in the hub clock (erp-appointments-hub-locale-times.test.ts).
    expect(field(el, 'appointments-list-start-time')?.getAttribute('type')).toBe('text');
  });

  it('typing the date and then the time enables «Add appointment» and books that wall clock', async () => {
    const el = await mount();
    await pickCustomer(el, 'appointments-list-customer', 'c1');
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
    expect(field(el, 'appointments-list-start')?.value).toBe('07/08/2026');
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
    expect(field(el, 'appointments-list-start')?.value, 'the typed day stays on screen').toBe('07/08/2026');
  });
});

describe('appointments#204 — reschedule: the new start is a date field + a time field', () => {
  it('pre-fills both fields and lets the hour be retyped from the keyboard', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
    await el.updateComplete;

    const form = el.shadowRoot.querySelector('form[slot="create"]')!;
    expect(form.querySelector('ion-input[type="datetime-local"]'), 'the year segment traps the caret').toBeNull();
    expect(field(el, 'appointments-list-reschedule-start')?.getAttribute('type')).toBe('text');
    expect(field(el, 'appointments-list-reschedule-start')?.value).toBe('07/08/2026');
    expect(field(el, 'appointments-list-reschedule-start-time')?.getAttribute('type')).toBe('text');
    expect(field(el, 'appointments-list-reschedule-start-time')?.value).toBe('10:00');

    await type(el, 'appointments-list-reschedule-start-time', '16:45');
    expect(el.rescheduleStart).toBe('2026-08-07T16:45');
    await type(el, 'appointments-list-reschedule-start', '2026-08-08');
    expect(el.rescheduleStart).toBe('2026-08-08T16:45');
    expect(submit(el, 'appointments-list-reschedule-submit').hasAttribute('disabled')).toBe(false);
  });
});

// Typed in ONE go («26/09/2026 10:00»): the space after the year cannot move the caret of a native
// date field (its year segment takes six digits), so the date field hands the caret to the time
// field itself — the gesture a single `datetime-local` could never offer. And a PASTED start fills
// both halves: native date/time inputs ignore pasted text.
describe('appointments#204 — typing or pasting the whole start in one go', () => {
  function keydown(el: Wc, testid: string, key: string, nativeValue: string) {
    const input = field(el, testid)!;
    input.value = nativeValue;
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
    input.dispatchEvent(ev);
    return ev;
  }

  function paste(el: Wc, testid: string, text: string) {
    const ev = new Event('paste', { bubbles: true, composed: true, cancelable: true }) as Event & {
      clipboardData: { getData: (type: string) => string };
    };
    ev.clipboardData = { getData: (type: string) => (type === 'text' || type === 'text/plain' ? text : '') };
    field(el, testid)!.dispatchEvent(ev);
    return ev;
  }

  for (const [form, dateId, timeId] of [
    ['create', 'appointments-list-start', 'appointments-list-start-time'],
    ['reschedule', 'appointments-list-reschedule-start', 'appointments-list-reschedule-start-time'],
  ] as const) {
    async function open(el: Wc) {
      if (form === 'reschedule') {
        await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
        await el.updateComplete;
      }
    }

    it(`${form}: a space, comma or «T» after a complete date jumps to the time field`, async () => {
      const el = await mount();
      await open(el);
      for (const key of [' ', ',', 'T']) {
        const time = field(el, timeId) as HTMLElement & { setFocus?: () => Promise<void> };
        let focused = 0;
        time.setFocus = async () => {
          focused++;
        };
        const ev = keydown(el, dateId, key, '2026-09-26');
        expect(focused, `«${key}» must hand the caret to the time field`).toBe(1);
        expect(ev.defaultPrevented, `«${key}» must not reach the year segment`).toBe(true);
      }
    });

    it(`${form}: digits and a separator on a half-typed date stay in the date field`, async () => {
      const el = await mount();
      await open(el);
      const time = field(el, timeId) as HTMLElement & { setFocus?: () => Promise<void> };
      let focused = 0;
      time.setFocus = async () => {
        focused++;
      };
      expect(keydown(el, dateId, '2', '2026-09-26').defaultPrevented, 'a digit is the browser’s').toBe(false);
      expect(keydown(el, dateId, ' ', '').defaultPrevented, 'no complete date yet: nothing to jump from').toBe(false);
      // appointments#205: the field is text now, so «complete» means a date parseTypedStart reads.
      expect(keydown(el, dateId, ' ', '26/09').defaultPrevented, 'half a date is not a date').toBe(false);
      expect(keydown(el, dateId, ' ', '26/09/2026').defaultPrevented, 'the date as the hub writes it is complete').toBe(true);
      expect(focused, 'only the complete date jumped').toBe(1);
    });

    it(`${form}: pasting «26/09/2026 10:00» fills the day and the hour`, async () => {
      const el = await mount();
      await open(el);
      const ev = paste(el, dateId, '26/09/2026 10:00');
      await el.updateComplete;
      expect(ev.defaultPrevented, 'the native field would drop the text').toBe(true);
      const start = form === 'create' ? el.newStart : el.rescheduleStart;
      expect(start).toBe('2026-09-26T10:00');
      expect(field(el, dateId)?.value).toBe('26/09/2026');
      expect(field(el, timeId)?.value).toBe('10:00');
    });

    it(`${form}: pasting only an hour into the time field keeps the day`, async () => {
      const el = await mount();
      await open(el);
      if (form === 'create') {
        el.newStart = '2026-08-07T11:15';
        await el.updateComplete;
      }
      paste(el, timeId, '16:45');
      await el.updateComplete;
      const start = form === 'create' ? el.newStart : el.rescheduleStart;
      expect(start).toBe('2026-08-07T16:45');
    });

    it(`${form}: pasting text that is not a date leaves the fields alone`, async () => {
      const el = await mount();
      await open(el);
      const before = form === 'create' ? el.newStart : el.rescheduleStart;
      const ev = paste(el, dateId, 'mañana a las diez');
      await el.updateComplete;
      expect(ev.defaultPrevented).toBe(false);
      expect(form === 'create' ? el.newStart : el.rescheduleStart).toBe(before);
    });
  }
});
