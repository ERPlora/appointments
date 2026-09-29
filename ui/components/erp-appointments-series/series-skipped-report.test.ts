// appointments#238 — a series that could not book some of its dates SAYS which and why.
//
// `appointments.recurring.materialize` skips the occurrences it cannot book (her day off, a blocked
// day, a time already taken, the past) and books the rest. The screen answered «Repeating
// appointment created and its appointments booked.» whatever happened, so the front desk found out
// the day the customer arrived and was not on the agenda. Fresha, Square and Booksy tell the person
// how many were booked and which dates were not, with the reason. The command now answers
// `{ booked, already_booked, skipped: [{ occurrence_date, code }] }` and the three doors that book a
// series (create, «Book appointments» on a row, a pattern change) paint it.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const ES = (esLocale as { ui: Record<string, string> }).ui;
const EN = (enLocale as { ui: Record<string, string> }).ui;

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const toasts: { type: string; message: string }[] = [];

const SERIES_ROW = {
  id: 'r1',
  customer_name: 'Ana López',
  service_name: 'Corte',
  staff_name: 'Eva Pro',
  frequency: 'weekly',
  day_of_week: 1,
  time: '10:00',
  duration_minutes: 30,
  start_date: '2099-10-06',
  end_date: null,
  max_occurrences: 4,
  is_active: 1,
};
const SERIES_TEMPLATE = { ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null };
const OCCURRENCES = [{ id: 'a3', occurrence_date: '2099-10-06', status: 'confirmed', converted_sale_id: null }];

const TWO_SKIPPED = {
  booked: 2,
  already_booked: 0,
  skipped: [
    { occurrence_date: '2099-10-13', code: 'appointments.outside_staff_hours' },
    { occurrence_date: '2099-10-20', code: 'appointments.overlapping_appointment' },
  ],
};
const NONE_SKIPPED = { booked: 4, already_booked: 0, skipped: [] };

let materializeResult: unknown = NONE_SKIPPED;

/** The shell's `t`: looks the key up and fills `{placeholders}`, like the real client. */
function translate(cat: Record<string, { ui?: Record<string, string> }>, key: string, params?: Record<string, unknown>) {
  const raw = cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}

beforeEach(() => {
  commands.length = 0;
  toasts.length = 0;
  materializeResult = NONE_SKIPPED;
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
          return OCCURRENCES;
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 }], total: 1 };
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (name === 'appointments.recurring.create') return { ok: true, new_ids: ['r1'] };
      if (name === 'appointments.recurring.materialize') return materializeResult;
      if (name === 'appointments.recurring.update') {
        return { recurring_id: 'r2', split: true, pattern_changed: true, moved: 0, cancelled_pattern_change: 0, locked_invoiced: 0 };
      }
      return { ok: true };
    },
    on: () => () => {},
    t: translate,
    locale: 'es',
    notify: (n: { type: string; message: string }) => toasts.push(n),
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Wc = HTMLElement & {
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
  error: string;
  editFrequency: string;
  openSeries: (row: Record<string, unknown>) => Promise<void>;
  submitEdit: (e: Event) => Promise<void>;
};

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

const byTestId = (el: Wc, testid: string) => el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as HTMLElement & { updateComplete: Promise<unknown> };

/** The real «Add» button of ok-data-table, then the real form filled and submitted. */
async function createThroughTheForm(el: Wc) {
  await table(el).updateComplete;
  (table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-add"]') as HTMLElement).click();
  await settle(el);
  const set = async (testid: string, value: string, event: string) => {
    const f = byTestId(el, testid) as HTMLElement & { value?: unknown };
    expect(f, `${testid} must be rendered`).toBeTruthy();
    f.value = value;
    f.dispatchEvent(new CustomEvent(event, { detail: { value }, bubbles: true, composed: true }));
    await el.updateComplete;
  };
  await set('appointments-series-create-customer', 'c1', 'ionChange');
  await set('appointments-series-create-service', 'sv1', 'ionChange');
  await set('appointments-series-create-staff', 's1', 'ionChange');
  await set('appointments-series-create-frequency', 'weekly', 'ionChange');
  await set('appointments-series-create-day', '1', 'ionChange');
  await set('appointments-series-create-start', '2099-10-06', 'ionInput');
  await set('appointments-series-create-start-time', '10:00', 'ionInput');
  await set('appointments-series-create-occurrences', '4', 'ionInput');
  (byTestId(el, 'appointments-series-create-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(el);
}

/** The real «Book appointments» button of the row. */
async function tapBook(el: Wc) {
  await table(el).updateComplete;
  const btn = table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-row-r1-materialize"]') as HTMLElement | null;
  expect(btn, 'the real «Book appointments» button').toBeTruthy();
  btn!.click();
  await settle(el);
}

function expectReportOfTwoSkipped(el: Wc) {
  const report = byTestId(el, 'appointments-series-skipped');
  expect(report, 'the dates that could not be booked are on screen').toBeTruthy();
  expect(report!.getAttribute('tone')).toBe('warning');
  const text = report!.textContent?.replace(/\s+/g, ' ') ?? '';
  expect(text).toContain(translate({ es: esLocale } as never, 'ui.seriesBookedSkipped', { booked: 2, skipped: 2 }));
  const first = byTestId(el, 'appointments-series-skipped-2099-10-13')?.textContent?.replace(/\s+/g, ' ') ?? '';
  expect(first).toContain('13/10/2099');
  expect(first).toContain(ES.seriesSkipStaffHours);
  const second = byTestId(el, 'appointments-series-skipped-2099-10-20')?.textContent?.replace(/\s+/g, ' ') ?? '';
  expect(second).toContain('20/10/2099');
  expect(second).toContain(ES.seriesSkipTaken);
}

describe('creating a series whose dates could not all be booked (appointments#238)', () => {
  it('lists the dates left out with their reason instead of «series created»', async () => {
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await createThroughTheForm(el);
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.create', 'appointments.recurring.materialize']);
    expectReportOfTwoSkipped(el);
    expect(toasts.some((n) => n.message === ES.seriesCreated), 'no «all booked» toast when dates are missing').toBe(false);
  });

  it('with every date booked it keeps the plain success and paints no report', async () => {
    const el = await mount();
    await createThroughTheForm(el);
    expect(toasts.map((n) => n.message)).toContain(ES.seriesCreated);
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });

  it('with NOTHING booked it still names the dates and why, not only «could not be booked»', async () => {
    materializeResult = {
      booked: 0,
      already_booked: 0,
      skipped: [
        { occurrence_date: '2099-10-06', code: 'appointments.blocked' },
        { occurrence_date: '2099-10-13', code: 'appointments.outside_schedule' },
      ],
    };
    const el = await mount();
    await createThroughTheForm(el);
    const report = byTestId(el, 'appointments-series-skipped');
    expect(report).toBeTruthy();
    expect(report!.textContent).toContain(translate({ es: esLocale } as never, 'ui.seriesBookedSkipped', { booked: 0, skipped: 2 }));
    expect(byTestId(el, 'appointments-series-skipped-2099-10-06')?.textContent).toContain(ES.seriesSkipBlocked);
    expect(byTestId(el, 'appointments-series-skipped-2099-10-13')?.textContent).toContain(ES.seriesSkipClosed);
  });

  it('a code the screen does not know still gets a readable reason, never the raw code', async () => {
    materializeResult = { booked: 1, already_booked: 0, skipped: [{ occurrence_date: '2099-10-13', code: 'appointments.something_new' }] };
    const el = await mount();
    await createThroughTheForm(el);
    const line = byTestId(el, 'appointments-series-skipped-2099-10-13')?.textContent ?? '';
    expect(line).toContain(ES.seriesSkipOther);
    expect(line).not.toContain('appointments.something_new');
  });

  it('the next action clears an old report', async () => {
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await createThroughTheForm(el);
    expect(byTestId(el, 'appointments-series-skipped')).toBeTruthy();
    materializeResult = NONE_SKIPPED;
    await tapBook(el);
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });
});

describe('«Book appointments» on a row reports the dates left out (appointments#238)', () => {
  it('lists them with their reason instead of «appointments booked»', async () => {
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await tapBook(el);
    expectReportOfTwoSkipped(el);
    expect(toasts.some((n) => n.message === ES.seriesMaterialized)).toBe(false);
  });

  it('with every date booked it keeps the plain success', async () => {
    const el = await mount();
    await tapBook(el);
    expect(toasts.map((n) => n.message)).toContain(ES.seriesMaterialized);
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });
});

describe('a pattern change that books the new days reports the dates left out (appointments#238)', () => {
  it('lists them after saving', async () => {
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    el.editFrequency = 'biweekly';
    await el.submitEdit(new Event('submit'));
    await settle(el);
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.update', 'appointments.recurring.materialize']);
    expectReportOfTwoSkipped(el);
  });
});

describe('every new visible string of appointments#238 exists in en AND es', () => {
  it.each([
    'seriesBookedSkipped',
    'seriesSkipStaffHours',
    'seriesSkipClosed',
    'seriesSkipBlocked',
    'seriesSkipTaken',
    'seriesSkipPast',
    'seriesSkipTooSoon',
    'seriesSkipTooFar',
    'seriesSkipOther',
  ])('%s', (key) => {
    expect(EN[key], `en ${key}`).toBeTruthy();
    expect(ES[key], `es ${key}`).toBeTruthy();
  });
});
