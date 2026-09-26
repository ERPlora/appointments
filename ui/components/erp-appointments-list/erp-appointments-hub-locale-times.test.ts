// appointments#214 — the TIME of an appointment follows the HUB's language, not the browser's.
//
// With the hub in Spanish, the «Time» field of a new appointment (and of the move panel) read
// «02:30 PM» on a laptop set up in US English. Both were native `<input type="time">`: Chromium
// paints that control with the BROWSER's (operating system's) locale and ignores `<html lang>` —
// the same finding #205 closed for the date. The fix is the same one: the module paints the time
// itself, in the hub's clock (24 h in Spanish), as a text field typed in one go and read back by
// `parseTypedStart`.
import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

process.env.TZ = 'Europe/Madrid';

const queries: { name: string; params: Record<string, unknown> }[] = [];

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

const CATALOGS: Record<string, unknown> = { es: esLocale, en: enLocale };

function lookup(catalog: unknown, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
  return typeof value === 'string' ? value : undefined;
}

function install(locale: 'es' | 'en') {
  queries.length = 0;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.appointments.list':
          return [APPOINTMENT];
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60 }];
        default:
          return [];
      }
    },
    command: async () => ({}),
    on: () => () => {},
    notify: () => {},
    locale,
    // The real resolution the shell does: active language, then English, then the key.
    t: (_catalog: unknown, key: string) => lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key) ?? key,
  };
}

beforeEach(() => install('es'));

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  day: string;
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
  el.day = '2026-08-17';
  await el.updateComplete;
  return el;
}

const byTestId = (el: Wc, testid: string) =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { value?: string }) | null;

/** What the browser hands over while she types into a text field: `ion-input` re-emits it as `ionInput`. */
async function type(el: Wc, testid: string, value: string) {
  const input = byTestId(el, testid);
  expect(input, `${testid} must be rendered`).toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

/** Leaving the field (blur / Enter): `ion-input` emits `ionChange`. */
async function leave(el: Wc, testid: string) {
  const input = byTestId(el, testid)!;
  input.dispatchEvent(new CustomEvent('ionChange', { detail: { value: input.value }, bubbles: true, composed: true }));
  await el.updateComplete;
}


/** Blank spaces normalized: `Intl` separates «AM/PM» with a narrow no-break space. */
const shown = (el: Wc, testid: string) => String(byTestId(el, testid)?.value ?? '').replace(/\s/g, ' ');

const EXPECTED = {
  es: { tenAm: '10:00', afternoon: '14:30', typedAfternoon: '14:30', placeholder: 'hh:mm' },
  en: { tenAm: '10:00 AM', afternoon: '02:30 PM', typedAfternoon: '2:30 pm', placeholder: 'hh:mm' },
} as const;

for (const locale of ['es', 'en'] as const) {
  const want = EXPECTED[locale];

  describe(`appointments#214 — the Time of a new appointment in the hub clock (${locale})`, () => {
    beforeEach(() => install(locale));

    it('is not the native time input, whose clock the browser decides', async () => {
      const el = await mount();
      const time = byTestId(el, 'appointments-list-start-time');
      expect(time?.getAttribute('type'), 'a native time field paints the browser locale').toBe('text');
      expect(time?.getAttribute('placeholder')).toBe(want.placeholder);
    });

    it('a start set from the timeline shows its time in the hub clock', async () => {
      const el = await mount();
      el.newStart = '2026-08-18T14:30';
      await el.updateComplete;
      expect(shown(el, 'appointments-list-start-time')).toBe(want.afternoon);
    });

    it('typing the time the way it is shown books that hour, and leaving repaints it in the hub clock', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start', locale === 'es' ? '18/08/2026' : '08/18/2026');
      await type(el, 'appointments-list-start-time', want.typedAfternoon);
      expect(el.newStart).toBe('2026-08-18T14:30');
      await leave(el, 'appointments-list-start-time');
      expect(shown(el, 'appointments-list-start-time')).toBe(want.afternoon);
    });

    it('a half-typed time stays on screen as typed and is not a start yet', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start', locale === 'es' ? '18/08/2026' : '08/18/2026');
      await type(el, 'appointments-list-start-time', '14:30');
      await type(el, 'appointments-list-start-time', '14:');
      expect(byTestId(el, 'appointments-list-start-time')?.value).toBe('14:');
      expect(el.newStart, 'a half-typed time must not keep the last valid hour').toBe('');
    });

    it('a slot clicked on the timeline wins over a half-typed time', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start-time', '1');
      el.newStart = '2026-08-18T10:00';
      await el.updateComplete;
      expect(shown(el, 'appointments-list-start-time')).toBe(want.tenAm);
    });

    it('a start pasted into the time field repaints it in the hub clock', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start-time', '9');
      const field = byTestId(el, 'appointments-list-start-time')!;
      const paste = new Event('paste', { bubbles: true, composed: true, cancelable: true }) as Event & {
        clipboardData: { getData: () => string };
      };
      paste.clipboardData = { getData: () => (locale === 'es' ? '18/08/2026 14:30' : '08/18/2026 14:30') };
      field.dispatchEvent(paste);
      await el.updateComplete;
      expect(el.newStart).toBe('2026-08-18T14:30');
      expect(shown(el, 'appointments-list-start-time')).toBe(want.afternoon);
    });
  });

  describe(`appointments#214 — moving an appointment shows its time in the hub clock (${locale})`, () => {
    beforeEach(() => install(locale));

    it('pre-fills the time in the hub clock and reads it back typed the same way', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      const field = byTestId(el, 'appointments-list-reschedule-start-time');
      expect(field?.getAttribute('type')).toBe('text');
      expect(field?.getAttribute('placeholder')).toBe(want.placeholder);
      expect(shown(el, 'appointments-list-reschedule-start-time')).toBe(want.tenAm);
      await type(el, 'appointments-list-reschedule-start-time', want.typedAfternoon);
      expect(el.rescheduleStart).toBe('2026-08-07T14:30');
      await leave(el, 'appointments-list-reschedule-start-time');
      expect(shown(el, 'appointments-list-reschedule-start-time')).toBe(want.afternoon);
    });

    it('a half-typed time is not a new start', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      await type(el, 'appointments-list-reschedule-start-time', '1');
      expect(el.rescheduleStart).toBe('');
      expect(byTestId(el, 'appointments-list-reschedule-start-time')?.value).toBe('1');
    });

    it('moving another appointment shows ITS time, not what was half-typed for the previous one', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      await type(el, 'appointments-list-reschedule-start-time', '1');
      const later = { ...APPOINTMENT, id: 'a2', start_datetime: '2026-08-07T14:30:00+02:00', end_datetime: '2026-08-07T15:00:00+02:00' };
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: later } }));
      await el.updateComplete;
      expect(shown(el, 'appointments-list-reschedule-start-time')).toBe(want.afternoon);
    });

    it('a start pasted into its time field repaints it in the hub clock', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      await type(el, 'appointments-list-reschedule-start-time', '9');
      const paste = new Event('paste', { bubbles: true, composed: true, cancelable: true }) as Event & {
        clipboardData: { getData: () => string };
      };
      paste.clipboardData = { getData: () => '14:30' };
      byTestId(el, 'appointments-list-reschedule-start-time')!.dispatchEvent(paste);
      await el.updateComplete;
      expect(el.rescheduleStart).toBe('2026-08-07T14:30');
      expect(shown(el, 'appointments-list-reschedule-start-time')).toBe(want.afternoon);
    });
  });
}
