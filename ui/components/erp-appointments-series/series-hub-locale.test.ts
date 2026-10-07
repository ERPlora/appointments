// appointments#217 — the «Repeating» view paints its dates and times in the HUB's language.
//
// With the hub in Spanish, creating or editing a repeating appointment on a laptop set up in US
// English showed «10/03/2026» (month first) and «02:30 PM»: «Day», «Until» and «Time» were native
// `<input type="date|time">`, which Chromium paints with the BROWSER's locale whatever the hub
// language (the finding #205 and #214 closed for the agenda). The fix is the agenda's one: text
// fields painted by the module in the hub's own day/month order and clock, typed in one go, read
// back by `parseTypedStart`, with an inline `ok-calendar` for the dates.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { pickCustomer } from '../../test/pick-customer';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
/** The booked occurrences `appointments.recurring.occurrences` answers with (none by default). */
let occurrenceRows: Record<string, unknown>[] = [];

const SERIES_ROW = {
  id: 'r1',
  customer_name: 'Ana López',
  service_name: 'Corte',
  staff_name: 'Eva Pro',
  frequency: 'weekly',
  day_of_week: 0,
  time: '14:30',
  duration_minutes: 30,
  start_date: '2099-10-05',
  end_date: '2100-03-31',
  max_occurrences: null,
  is_active: 1,
};
const SERIES_TEMPLATE = { ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null };

const CATALOGS: Record<string, unknown> = { es: esLocale, en: enLocale };

function lookup(catalog: unknown, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
  return typeof value === 'string' ? value : undefined;
}

/** `{name}` placeholders filled from the params, the way the shell's `t` does. */
function interpolate(text: string, params?: Record<string, unknown>): string {
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;
}

function install(locale: 'es' | 'en') {
  commands.length = 0;
  occurrenceRows = [];
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.recurring.list':
          return { rows: [SERIES_ROW], total: 1 };
        case 'appointments.recurring.get':
          return [SERIES_TEMPLATE];
        case 'appointments.recurring.occurrences':
          return occurrenceRows;
        case 'customers.list':
          return { rows: [{ id: 'c2', name: 'Bea Ruiz' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv2', name: 'Tinte', duration_minutes: 90, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 }], total: 1 };
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return name === 'appointments.recurring.create' ? { ok: true, new_ids: ['r-new'] } : { ok: true };
    },
    on: () => () => {},
    notify: () => {},
    locale,
    // The real resolution the shell does: active language, then English, then the key.
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      interpolate(lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key) ?? key, params),
  };
}

afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Table = HTMLElement & { updateComplete: Promise<unknown>; panel: string; shadowRoot: ShadowRoot };
type Wc = HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };
type Field = HTMLElement & { value?: string; setFocus?: () => Promise<void> };

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
};

const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Table;
const field = (el: Wc, testid: string) => el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as Field | null;
/** Blank spaces normalized: `Intl` separates «AM/PM» with a narrow no-break space. */
const shown = (el: Wc, testid: string) => String(field(el, testid)?.value ?? '').replace(/\s/g, ' ');

const tapAdd = async (el: Wc) => {
  await table(el).updateComplete;
  (table(el).shadowRoot.querySelector('[data-testid="appointments-series-table-add"]') as HTMLElement).click();
  await settle(el);
};

const tapEdit = async (el: Wc) => {
  await table(el).updateComplete;
  const btn = table(el).shadowRoot.querySelector('[data-testid="appointments-series-table-row-r1-edit"]') as HTMLElement | null;
  expect(btn, 'the real «edit» button of the row').toBeTruthy();
  btn!.click();
  await settle(el);
};

async function choose(el: Wc, testid: string, value: string) {
  const f = field(el, testid);
  expect(f, `${testid} must be rendered`).toBeTruthy();
  f!.value = value;
  f!.dispatchEvent(new CustomEvent('ionChange', { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

/** What the browser hands over while she types into a text field: `ion-input` re-emits it as `ionInput`. */
async function type(el: Wc, testid: string, value: string) {
  const f = field(el, testid);
  expect(f, `${testid} must be rendered`).toBeTruthy();
  f!.value = value;
  f!.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

/** Leaving the field (blur / Enter): `ion-input` emits `ionChange`. */
async function leave(el: Wc, testid: string) {
  const f = field(el, testid)!;
  f.dispatchEvent(new CustomEvent('ionChange', { detail: { value: f.value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

async function paste(el: Wc, testid: string, text: string): Promise<Event> {
  const ev = new Event('paste', { bubbles: true, composed: true, cancelable: true }) as Event & {
    clipboardData: { getData: () => string };
  };
  ev.clipboardData = { getData: () => text };
  field(el, testid)!.dispatchEvent(ev);
  await el.updateComplete;
  return ev;
}

type Calendar = HTMLElement & { value: string; locale: string; updateComplete: Promise<unknown> };

/** The `max-width` the MODULE's own CSS gives `ok-calendar`. In a browser a rule of the host's
 *  shadow root beats the calendar's own `:host([picker]) { max-width: 20rem }`, so a wider value
 *  here would stretch the picker again; happy-dom resolves it the other way round, hence the
 *  stylesheet text and not `getComputedStyle`. */
function moduleCalendarMaxWidth(calendar: HTMLElement): string | undefined {
  const host = (calendar.getRootNode() as ShadowRoot).host;
  const styles = (host.constructor as unknown as { styles: { cssText: string } | { cssText: string }[] }).styles;
  const css = [styles].flat().map((sheet) => sheet.cssText).join('\n');
  return css.match(/(?:^|[}\s])ok-calendar\s*\{[^}]*max-width:\s*([^;}]+)/)?.[1].trim();
}

/** Taps the cell of `iso` in the open inline calendar, the way a finger does. */
async function pickInCalendar(el: Wc, testid: string, iso: string) {
  const picker = field(el, testid) as Calendar | null;
  expect(picker, `${testid} must be open`).toBeTruthy();
  expect(picker!.tagName.toLowerCase(), 'ion-datetime is not registered by the hub shell').toBe('ok-calendar');
  await picker!.updateComplete;
  // appointments#223 — a date field opens OutfitKit's compact DATE PICKER, not the events
  // calendar: no Month/Agenda switch, days are real buttons with one tab stop, and the module CSS
  // does not stretch it past the picker's 20rem.
  expect((picker as Calendar & { picker?: boolean }).picker, `${testid} is in date picker mode`).toBe(true);
  expect(picker!.hasAttribute('picker'), `${testid} carries the picker attribute`).toBe(true);
  expect(picker!.shadowRoot!.querySelector('.toggle'), `${testid} has no Month/Agenda switch`).toBeNull();
  expect(picker!.shadowRoot!.querySelectorAll('button[data-date][tabindex="0"]').length, `${testid} has a single tab stop`).toBe(1);
  expect(moduleCalendarMaxWidth(picker!), `${testid} keeps the compact picker width`).toBe('20rem');
  const cell = picker!.shadowRoot!.querySelector<HTMLElement>(`button[data-date="${iso}"]:not(.other-month)`);
  expect(cell, `day ${iso} must be a cell of the open month`).toBeTruthy();
  cell!.click();
  await settle(el);
}

const submitCreate = async (el: Wc) => {
  (field(el, 'appointments-series-create-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(el);
};

const submitEdit = async (el: Wc) => {
  (field(el, 'appointments-series-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(el);
};

const createDisabled = (el: Wc) => (field(el, 'appointments-series-create-submit') as HTMLElement & { disabled: boolean }).hasAttribute('disabled');

async function fillAllButDates(el: Wc) {
  await pickCustomer(el, 'appointments-series-create-customer', 'c2');
  await choose(el, 'appointments-series-create-service', 'sv2');
  await choose(el, 'appointments-series-create-staff', 's1');
}

const EXPECTED = {
  es: {
    typedStart: '05/10/2099',
    typedEnd: '31/03/2100',
    typedTime: '17:30',
    shownTime: '17:30',
    rowTime: '14:30',
    datePlaceholder: 'dd/mm/aaaa',
    shownStart: '05/10/2099',
    shownEnd: '31/03/2100',
    pickedStart: '07/10/2099',
    cutoff: '12/10/2099',
  },
  en: {
    typedStart: '10/05/2099',
    typedEnd: '03/31/2100',
    typedTime: '5:30 pm',
    shownTime: '05:30 PM',
    rowTime: '02:30 PM',
    datePlaceholder: 'mm/dd/yyyy',
    shownStart: '10/05/2099',
    shownEnd: '03/31/2100',
    pickedStart: '10/07/2099',
    cutoff: '10/12/2099',
  },
} as const;

for (const locale of ['es', 'en'] as const) {
  const want = EXPECTED[locale];

  describe(`appointments#217 — a NEW repeating appointment in the hub language (${locale})`, () => {
    beforeEach(() => install(locale));

    it('Day, Until and Time are not the native inputs, whose format the browser decides', async () => {
      const el = await mount();
      await tapAdd(el);
      for (const testid of ['appointments-series-create-start', 'appointments-series-create-end']) {
        expect(field(el, testid)?.getAttribute('type'), `${testid}: a native date field paints the browser locale`).toBe('text');
        expect(field(el, testid)?.getAttribute('placeholder')).toBe(want.datePlaceholder);
      }
      const time = field(el, 'appointments-series-create-start-time');
      expect(time?.getAttribute('type'), 'a native time field paints the browser clock').toBe('text');
      expect(time?.getAttribute('placeholder')).toBe('hh:mm');
      expect(el.shadowRoot.querySelector('ion-input[type="date"], ion-input[type="time"]')).toBeNull();
    });

    it('dates and time typed in the hub order create the series with the right ISO values', async () => {
      const el = await mount();
      await tapAdd(el);
      await fillAllButDates(el);
      await type(el, 'appointments-series-create-start', want.typedStart);
      await type(el, 'appointments-series-create-start-time', want.typedTime);
      await type(el, 'appointments-series-create-end', want.typedEnd);
      await leave(el, 'appointments-series-create-start-time');
      expect(shown(el, 'appointments-series-create-start-time'), 'repainted in the hub clock on leaving').toBe(want.shownTime);
      await submitCreate(el);
      const create = commands.find((c) => c.name === 'appointments.recurring.create');
      expect(create?.payload).toMatchObject({ start_date: '2099-10-05', time: '17:30', end_date: '2100-03-31' });
    });

    it('a half-typed Day or Time stays as typed and is not a start yet', async () => {
      const el = await mount();
      await tapAdd(el);
      await fillAllButDates(el);
      await type(el, 'appointments-series-create-start', want.typedStart);
      await type(el, 'appointments-series-create-start-time', want.typedTime);
      expect(createDisabled(el)).toBe(false);
      await type(el, 'appointments-series-create-start', '05/1');
      expect(shown(el, 'appointments-series-create-start')).toBe('05/1');
      expect(createDisabled(el), 'a half-typed day must not keep the last valid one').toBe(true);
      await leave(el, 'appointments-series-create-start');
      expect(shown(el, 'appointments-series-create-start'), 'leaving repaints the committed (empty) day').toBe('');
      await type(el, 'appointments-series-create-start', want.typedStart);
      await type(el, 'appointments-series-create-start-time', '17:');
      expect(shown(el, 'appointments-series-create-start-time')).toBe('17:');
      expect(createDisabled(el), 'a half-typed time must not keep the last valid one').toBe(true);
    });

    it('a half-typed «Until» blocks saving instead of creating a series with no end', async () => {
      const el = await mount();
      await tapAdd(el);
      await fillAllButDates(el);
      await type(el, 'appointments-series-create-start', want.typedStart);
      await type(el, 'appointments-series-create-start-time', want.typedTime);
      await type(el, 'appointments-series-create-end', want.typedEnd);
      expect(createDisabled(el)).toBe(false);
      await type(el, 'appointments-series-create-end', '31/0');
      expect(createDisabled(el), 'a half-typed «Until» must not keep the last valid one').toBe(true);
      await submitCreate(el);
      expect(commands.some((c) => c.name === 'appointments.recurring.create')).toBe(false);
      await type(el, 'appointments-series-create-end', '');
      expect(createDisabled(el), 'an empty «Until» is a valid open-ended series').toBe(false);
    });

    it('a start pasted as one string fills Day and Time, painted in the hub format', async () => {
      const el = await mount();
      await tapAdd(el);
      await type(el, 'appointments-series-create-start', '05/1');
      await type(el, 'appointments-series-create-start-time', '1');
      const ev = await paste(el, 'appointments-series-create-start', `${want.typedStart} 17:30`);
      expect(ev.defaultPrevented).toBe(true);
      expect(shown(el, 'appointments-series-create-start'), 'the paste wins over a half-typed day').toBe(want.shownStart);
      expect(shown(el, 'appointments-series-create-start-time'), 'the paste wins over a half-typed time').toBe(want.shownTime);
      await paste(el, 'appointments-series-create-start-time', '08:15');
      expect(shown(el, 'appointments-series-create-start-time')).toBe(locale === 'es' ? '08:15' : '08:15 AM');
    });

    it('a space after a complete Day hands the caret to Time; after a half-typed one it does not', async () => {
      const el = await mount();
      await tapAdd(el);
      const time = field(el, 'appointments-series-create-start-time')!;
      let focused = 0;
      time.setFocus = async () => {
        focused++;
      };
      await type(el, 'appointments-series-create-start', '05/1');
      const early = new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true });
      field(el, 'appointments-series-create-start')!.dispatchEvent(early);
      expect(early.defaultPrevented).toBe(false);
      expect(focused).toBe(0);
      await type(el, 'appointments-series-create-start', want.typedStart);
      const done = new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true, cancelable: true });
      field(el, 'appointments-series-create-start')!.dispatchEvent(done);
      expect(done.defaultPrevented).toBe(true);
      expect(focused).toBe(1);
    });

    it('Day and Until each open an inline calendar in the hub language that fills the field', async () => {
      const el = await mount();
      await tapAdd(el);
      await type(el, 'appointments-series-create-start', want.typedStart);
      (field(el, 'appointments-series-create-start-calendar') as HTMLElement).click();
      await settle(el);
      const startPicker = field(el, 'appointments-series-create-start-calendar-picker') as Calendar | null;
      expect(startPicker?.locale).toBe(locale);
      expect(startPicker?.value).toBe('2099-10-05');
      await pickInCalendar(el, 'appointments-series-create-start-calendar-picker', '2099-10-07');
      expect(shown(el, 'appointments-series-create-start')).toBe(want.pickedStart);
      expect(field(el, 'appointments-series-create-start-calendar-picker'), 'closes once a day is picked').toBeNull();

      (field(el, 'appointments-series-create-end-calendar') as HTMLElement).click();
      await settle(el);
      expect(field(el, 'appointments-series-create-start-calendar-picker'), 'only one calendar at a time').toBeNull();
      // Before an «Until» is picked, the calendar opens on the series' first day.
      expect((field(el, 'appointments-series-create-end-calendar-picker') as Calendar | null)?.value).toBe('2099-10-07');
      await pickInCalendar(el, 'appointments-series-create-end-calendar-picker', '2099-10-28');
      expect(shown(el, 'appointments-series-create-end')).toBe(locale === 'es' ? '28/10/2099' : '10/28/2099');
    });

    it('after creating with a calendar open, the next «Add» starts with no calendar and no «Until»', async () => {
      const el = await mount();
      await tapAdd(el);
      await fillAllButDates(el);
      await type(el, 'appointments-series-create-start', want.typedStart);
      await type(el, 'appointments-series-create-start-time', want.typedTime);
      await type(el, 'appointments-series-create-end', want.typedEnd);
      (field(el, 'appointments-series-create-end-calendar') as HTMLElement).click();
      await settle(el);
      await submitCreate(el);
      expect(commands.some((c) => c.name === 'appointments.recurring.create')).toBe(true);
      await tapAdd(el);
      expect(field(el, 'appointments-series-create-end-calendar-picker'), 'a new series opens with its calendars closed').toBeNull();
      expect(shown(el, 'appointments-series-create-end')).toBe('');
    });
  });

  describe(`appointments#217 — EDITING a repeating appointment in the hub language (${locale})`, () => {
    beforeEach(() => install(locale));

    it('Time is not the native input and shows the series time in the hub clock', async () => {
      const el = await mount();
      await tapEdit(el);
      const time = field(el, 'appointments-series-time');
      expect(time?.getAttribute('type')).toBe('text');
      expect(time?.getAttribute('placeholder')).toBe('hh:mm');
      expect(shown(el, 'appointments-series-time')).toBe(want.rowTime);
    });

    it('a time typed in the hub clock is what the series moves to', async () => {
      const el = await mount();
      await tapEdit(el);
      await type(el, 'appointments-series-time', want.typedTime);
      await leave(el, 'appointments-series-time');
      expect(shown(el, 'appointments-series-time')).toBe(want.shownTime);
      await submitEdit(el);
      const update = commands.find((c) => c.name === 'appointments.recurring.update');
      expect(update?.payload).toMatchObject({ time: '17:30' });
    });

    it('opening the series again drops a half-typed time and shows the stored one', async () => {
      const el = await mount();
      await tapEdit(el);
      await type(el, 'appointments-series-time', '17:');
      await tapEdit(el);
      expect(shown(el, 'appointments-series-time')).toBe(want.rowTime);
    });

    it('a half-typed time blocks saving instead of silently keeping the old one', async () => {
      const el = await mount();
      await tapEdit(el);
      await type(el, 'appointments-series-time', '17:');
      expect(shown(el, 'appointments-series-time')).toBe('17:');
      expect((field(el, 'appointments-series-submit') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
      await submitEdit(el);
      expect(commands.some((c) => c.name === 'appointments.recurring.update')).toBe(false);
    });
  });

  describe(`appointments#220 — the date the change applies from, in the hub language (${locale})`, () => {
    beforeEach(() => {
      install(locale);
      occurrenceRows = [
        { id: 'o1', occurrence_date: '2099-10-12', status: 'confirmed', converted_sale_id: null },
        { id: 'o2', occurrence_date: '2099-10-19', status: 'confirmed', converted_sale_id: null },
      ];
    });

    const text = (el: Wc, testid: string) => (field(el, testid)?.textContent ?? '').replace(/\s+/g, ' ');

    it('the booked count names the cut-off day in the hub date order, not as a raw ISO date', async () => {
      const el = await mount();
      await tapEdit(el);
      const counts = (el.shadowRoot.querySelector('[data-role="series-counts"]')?.textContent ?? '').replace(/\s+/g, ' ');
      expect(counts).toContain(want.cutoff);
      expect(counts).not.toContain('2099-10-12');
    });

    it('the scope hint names the same cut-off day in the hub date order', async () => {
      const el = await mount();
      await tapEdit(el);
      const hint = text(el, 'appointments-series-scope-hint');
      expect(hint).toContain(want.cutoff);
      expect(hint).not.toContain('2099-10-12');
    });

    it('the update still cuts at the ISO date the server reads', async () => {
      const el = await mount();
      await tapEdit(el);
      await type(el, 'appointments-series-time', want.typedTime);
      await leave(el, 'appointments-series-time');
      await submitEdit(el);
      const update = commands.find((c) => c.name === 'appointments.recurring.update');
      expect(update?.payload).toMatchObject({ from_occurrence_date: '2099-10-12' });
    });
  });

  describe(`appointments#217 — the series list in the hub language (${locale})`, () => {
    beforeEach(() => install(locale));

    it('the pattern, start and end of a row read in the hub clock and date order', async () => {
      const el = await mount();
      await table(el).updateComplete;
      const text = (table(el).shadowRoot.textContent ?? '').replace(/\s/g, ' ');
      expect(text).toContain(want.rowTime);
      expect(text).toContain(want.shownStart);
      expect(text).toContain(want.shownEnd);
      expect(text, 'no raw ISO date in the list').not.toContain('2099-10-05');
    });
  });
}
