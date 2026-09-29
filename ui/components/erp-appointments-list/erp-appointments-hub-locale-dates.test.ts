// appointments#205 — the dates of the agenda follow the HUB's language, not the browser's.
//
// With the hub in Spanish, the day of the list read «09/26/2026» and the «Day» field of a new
// appointment showed the marker «mm/dd/yyyy». Both were native `<input type="date">`: Chromium
// paints that control with the BROWSER's (operating system's) locale and ignores `<html lang>`, so
// a Spanish salon on a laptop set up in English got the US order — and there is no attribute the
// module can set to change it (same finding as saas#2351). The fix is the one that closed it in
// the SaaS: the module paints the date itself, in the hub's language, and offers an
// OutfitKit `ok-calendar` with that same `locale` for the mouse. Not `ion-datetime`: the hub shell
// registers a closed list of Ionic components and `ion-datetime` is not on it, so on a real hub it
// never upgraded and the calendar opened as an empty 0×0 box — hence these tests drive the REAL
// `ok-calendar` (the module bundles it) and tap a day cell inside its shadow root.
//
// The field stays typeable in one go (appointments#204/#210): what it shows is the order
// `parseTypedStart` reads, so the receptionist types the date exactly the way she sees it.
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

/** ok-calendar label → module catalog key (its defaults are English only). */
const CALENDAR_LABEL_KEYS = {
  month: 'ui.calendarMonth',
  agenda: 'ui.calendarAgenda',
  agendaEmpty: 'ui.calendarAgendaEmpty',
  more: 'ui.calendarMore',
  prevMonth: 'ui.calendarPrevMonth',
  nextMonth: 'ui.calendarNextMonth',
} as const;

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

async function click(el: Wc, testid: string) {
  const button = byTestId(el, testid);
  expect(button, `${testid} must be rendered`).toBeTruthy();
  button!.click();
  await el.updateComplete;
}

type Calendar = HTMLElement & { value: string; locale: string; labels: Record<string, string>; updateComplete: Promise<unknown> };

/** The open calendar of a date field, once `ok-calendar` has rendered its month. */
async function openCalendar(el: Wc, testid: string): Promise<Calendar> {
  const picker = byTestId(el, testid) as Calendar | null;
  expect(picker, `${testid} must be open`).toBeTruthy();
  expect(picker!.tagName.toLowerCase(), 'ion-datetime is not registered by the hub shell').toBe('ok-calendar');
  expect(customElements.get('ok-calendar'), 'the module bundle registers ok-calendar itself').toBeTruthy();
  await picker!.updateComplete;
  expectDatePicker(picker!, testid);
  return picker!;
}

/** appointments#223 — a date field opens OutfitKit's compact DATE PICKER, not the events
 *  calendar: no Month/Agenda switch (its Agenda view is empty here), days are real buttons (one
 *  tab stop, arrow keys), and the module CSS does not stretch it past the picker's 20rem. */
function expectDatePicker(picker: Calendar, testid: string) {
  expect((picker as Calendar & { picker?: boolean }).picker, `${testid} is in date picker mode`).toBe(true);
  expect(picker.hasAttribute('picker'), `${testid} carries the picker attribute`).toBe(true);
  const root = picker.shadowRoot!;
  expect(root.querySelector('.toggle'), `${testid} has no Month/Agenda switch`).toBeNull();
  const days = root.querySelectorAll('button[data-date]');
  expect(days.length, `${testid} paints its days as buttons`).toBeGreaterThanOrEqual(28);
  expect(root.querySelectorAll('button[data-date][tabindex="0"]').length, `${testid} has a single tab stop`).toBe(1);
  expect(moduleCalendarMaxWidth(picker), `${testid} keeps the compact picker width`).toBe('20rem');
}

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

/** Taps the cell of `iso` (a day of the month the calendar shows) the way a finger does. */
async function pickInCalendar(el: Wc, testid: string, iso: string) {
  const picker = await openCalendar(el, testid);
  const cell = picker.shadowRoot!.querySelector<HTMLElement>(`button[data-date="${iso}"]:not(.other-month)`);
  expect(cell, `day ${iso} must be a cell of the open month`).toBeTruthy();
  cell!.click();
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

const EXPECTED = {
  // OutfitKit writes the month in sentence case, and the week starts where the hub language
  // starts it: Monday in Spanish, Sunday in US English (outfitkit#209).
  es: { day: '17/08/2026', typed: '18/08/2026', placeholder: 'dd/mm/aaaa', month: 'Agosto de 2026', weekday: 'lun' },
  en: { day: '08/17/2026', typed: '08/18/2026', placeholder: 'mm/dd/yyyy', month: 'August 2026', weekday: 'Sun' },
} as const;

for (const locale of ['es', 'en'] as const) {
  const want = EXPECTED[locale];

  describe(`appointments#205 — the day of the agenda in the hub language (${locale})`, () => {
    beforeEach(() => install(locale));

    it('is not the native date input, whose format the browser decides', async () => {
      const el = await mount();
      const day = byTestId(el, 'appointments-list-day');
      expect(day?.getAttribute('type'), 'a native date field paints the browser locale').toBe('text');
      expect(day?.value).toBe(want.day);
      expect(day?.getAttribute('placeholder')).toBe(want.placeholder);
    });

    it('typing a date in the hub order moves the agenda to that day', async () => {
      const el = await mount();
      await type(el, 'appointments-list-day', want.typed);
      expect(el.day).toBe('2026-08-18');
      expect(
        queries.some((q) => q.name === 'appointments.appointments.list' && String(q.params.day_start ?? '').startsWith('2026-08-17T22:00')),
        'the list is fetched for the typed day',
      ).toBe(true);
    });

    it('a half-typed date does not move the day, and leaving the field shows the current day again', async () => {
      const el = await mount();
      await type(el, 'appointments-list-day', '18/08');
      expect(el.day).toBe('2026-08-17');
      await leave(el, 'appointments-list-day');
      expect(byTestId(el, 'appointments-list-day')?.value).toBe(want.day);
    });

    it('the stepper repaints the field in the hub format, even over a half-typed date', async () => {
      const el = await mount();
      await type(el, 'appointments-list-day', '2');
      await click(el, 'appointments-list-next-day');
      expect(byTestId(el, 'appointments-list-day')?.value).toBe(locale === 'es' ? '18/08/2026' : '08/18/2026');
    });

    it('the calendar speaks the hub language and picks the tapped day', async () => {
      const el = await mount();
      await click(el, 'appointments-list-day-calendar');
      const picker = await openCalendar(el, 'appointments-list-day-calendar-picker');
      expect(picker.locale).toBe(locale);
      const root = picker.shadowRoot!;
      expect(root.querySelector('.title')?.textContent?.trim(), 'month and year in the hub language').toBe(want.month);
      expect(root.querySelector('.weekday')?.textContent?.trim().toLowerCase().replace('.', '')).toBe(want.weekday.toLowerCase());
      // Every visible word of the calendar comes from the module catalog, never OutfitKit's English defaults.
      for (const [label, key] of Object.entries(CALENDAR_LABEL_KEYS)) {
        const text = lookup(CATALOGS[locale], key);
        expect(text, `${key} must be in the ${locale} catalog`).toBeTruthy();
        expect(picker.labels[label], `ok-calendar label ${label}`).toBe(text);
      }
      queries.length = 0;
      await pickInCalendar(el, 'appointments-list-day-calendar-picker', '2026-08-20');
      expect(el.day).toBe('2026-08-20');
      expect(
        queries.some((q) => q.name === 'appointments.appointments.list' && String(q.params.day_start ?? '').startsWith('2026-08-19T22:00')),
        'the agenda is fetched for the picked day',
      ).toBe(true);
      expect(byTestId(el, 'appointments-list-day-calendar-picker'), 'the calendar closes once a day is picked').toBeNull();
    });

    it('the calendar opens on the day the agenda shows, and the button closes it again', async () => {
      const el = await mount();
      await click(el, 'appointments-list-day-calendar');
      const picker = await openCalendar(el, 'appointments-list-day-calendar-picker');
      expect(picker.shadowRoot!.querySelector('button[aria-pressed="true"]')?.textContent?.trim()).toBe('17');
      await click(el, 'appointments-list-day-calendar');
      expect(byTestId(el, 'appointments-list-day-calendar-picker')).toBeNull();
      expect(el.day).toBe('2026-08-17');
    });
  });

  describe(`appointments#205 — the Day of a new appointment in the hub language (${locale})`, () => {
    beforeEach(() => install(locale));

    it('is a text field with the hub marker, and a start set from the timeline shows in the hub format', async () => {
      const el = await mount();
      const start = byTestId(el, 'appointments-list-start');
      expect(start?.getAttribute('type')).toBe('text');
      expect(start?.getAttribute('placeholder')).toBe(want.placeholder);
      // A slot clicked on the timeline wins over a half-typed day.
      await type(el, 'appointments-list-start', '2');
      el.newStart = '2026-08-18T11:15';
      await el.updateComplete;
      expect(byTestId(el, 'appointments-list-start')?.value).toBe(want.typed);
    });

    it('typing the date the way it is shown books that day', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start', want.typed);
      await type(el, 'appointments-list-start-time', '10:00');
      expect(el.newStart).toBe('2026-08-18T10:00');
    });

    it('a date that does not exist is not a start, even after a valid one', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start', want.typed);
      await type(el, 'appointments-list-start', '31/02/2026');
      await type(el, 'appointments-list-start-time', '10:00');
      expect(el.newStart).toBe('');
    });

    it('the calendar fills the day', async () => {
      const el = await mount();
      await click(el, 'appointments-list-start-calendar');
      const picker = await openCalendar(el, 'appointments-list-start-calendar-picker');
      expect(picker.locale).toBe(locale);
      await pickInCalendar(el, 'appointments-list-start-calendar-picker', '2026-08-18');
      await type(el, 'appointments-list-start-time', '10:00');
      expect(el.newStart).toBe('2026-08-18T10:00');
      expect(byTestId(el, 'appointments-list-start')?.value).toBe(want.typed);
    });
  });

  describe(`appointments#205 — moving an appointment shows its day in the hub language (${locale})`, () => {
    beforeEach(() => install(locale));

    it('pre-fills the day in the hub format and reads it back typed the same way', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      const field = byTestId(el, 'appointments-list-reschedule-start');
      expect(field?.getAttribute('type')).toBe('text');
      expect(field?.value).toBe(locale === 'es' ? '07/08/2026' : '08/07/2026');
      await type(el, 'appointments-list-reschedule-start', want.typed);
      expect(el.rescheduleStart).toBe('2026-08-18T10:00');
    });

    it('its calendar opens on the appointment day and moves it to the tapped one', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      await click(el, 'appointments-list-reschedule-start-calendar');
      const picker = await openCalendar(el, 'appointments-list-reschedule-start-calendar-picker');
      expect(picker.locale).toBe(locale);
      expect(picker.shadowRoot!.querySelector('button[aria-pressed="true"]')?.textContent?.trim()).toBe('7');
      await pickInCalendar(el, 'appointments-list-reschedule-start-calendar-picker', '2026-08-18');
      expect(el.rescheduleStart).toBe('2026-08-18T10:00');
      expect(byTestId(el, 'appointments-list-reschedule-start')?.value).toBe(want.typed);
      expect(byTestId(el, 'appointments-list-reschedule-start-calendar-picker')).toBeNull();
    });
  });
}

// appointments#240 — on an iPhone the date fields open the numeric keypad, which has no «/». A day
// typed as eight digits is read in the hub's day/month order: «18082026» in Spanish, «08182026» in
// English, and «03042026» is the 3rd of April in Spanish but the 4th of March in English.
const KEYPAD = {
  es: { typed: '18082026', aprilThird: '03042026' },
  en: { typed: '08182026', aprilThird: '04032026' },
} as const;

for (const locale of ['es', 'en'] as const) {
  const want = EXPECTED[locale];
  const keypad = KEYPAD[locale];

  describe(`appointments#240 — a date typed on a keypad without a slash (${locale})`, () => {
    beforeEach(() => install(locale));

    it('the agenda day moves to the eight digits read in the hub order, and leaving repaints it', async () => {
      const el = await mount();
      expect(byTestId(el, 'appointments-list-day')?.getAttribute('inputmode'), 'the phone opens its numeric keypad').toBe('numeric');
      await type(el, 'appointments-list-day', keypad.typed);
      expect(el.day).toBe('2026-08-18');
      await leave(el, 'appointments-list-day');
      expect(byTestId(el, 'appointments-list-day')?.value).toBe(want.typed);
    });

    it('a new appointment books the day typed as digits, in the hub order', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start', keypad.aprilThird);
      await type(el, 'appointments-list-start-time', '1000');
      expect(el.newStart).toBe('2026-04-03T10:00');
      await leave(el, 'appointments-list-start');
      expect(byTestId(el, 'appointments-list-start')?.value).toBe(locale === 'es' ? '03/04/2026' : '04/03/2026');
    });

    it('half-typed digits are not a day yet', async () => {
      const el = await mount();
      await type(el, 'appointments-list-start', keypad.typed.slice(0, 7));
      await type(el, 'appointments-list-start-time', '1000');
      expect(el.newStart).toBe('');
    });

    it('moving an appointment reads the day typed as digits', async () => {
      const el = await mount();
      await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
      await el.updateComplete;
      expect(byTestId(el, 'appointments-list-reschedule-start')?.getAttribute('inputmode')).toBe('numeric');
      await type(el, 'appointments-list-reschedule-start', keypad.typed);
      expect(el.rescheduleStart).toBe('2026-08-18T10:00');
    });
  });
}
