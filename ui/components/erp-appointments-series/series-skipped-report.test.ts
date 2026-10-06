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
/** appointments#267 — when set, each `materialize` run answers the next of these, in order. */
let materializePages: unknown[] = [];
let failing = '';
const UPDATE_PATTERN_CHANGED = {
  recurring_id: 'r2',
  split: true,
  pattern_changed: true,
  moved: 0,
  cancelled_pattern_change: 0,
  locked_invoiced: 0,
  skipped: [],
};
let updateResult: Record<string, unknown> = UPDATE_PATTERN_CHANGED;

/** The shell's `t`: looks the key up and fills `{placeholders}`, like the real client. */
function translate(cat: Record<string, { ui?: Record<string, string> }>, key: string, params?: Record<string, unknown>) {
  const raw = cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}

beforeEach(() => {
  commands.length = 0;
  toasts.length = 0;
  materializeResult = NONE_SKIPPED;
  materializePages = [];
  updateResult = UPDATE_PATTERN_CHANGED;
  failing = '';
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
      if (failing === name) throw new Error('boom');
      if (name === 'appointments.recurring.create') return { ok: true, new_ids: ['r1'] };
      // What `erplora().command` really resolves to: the dispatcher's `data`, where a WASM
      // handler's own answer travels in `result` (seen on the hub:stable bench, not assumed).
      if (name === 'appointments.recurring.materialize') {
        if (materializePages.length) return { ok: true, new_ids: [], operations: 1, result: materializePages.shift() };
        return { ok: true, new_ids: ['a4', 'a5'], operations: 6, ...(materializeResult === undefined ? {} : { result: materializeResult }) };
      }
      if (name === 'appointments.recurring.update') {
        // Same envelope: the handler's answer is in `result`, never at the top (appointments#236).
        return { ok: true, operations: 1, new_ids: [], result: updateResult };
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
  editTime: string;
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

  it('a later booking that FAILS does not leave the old report standing next to its error', async () => {
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await createThroughTheForm(el);
    expect(byTestId(el, 'appointments-series-skipped')).toBeTruthy();
    failing = 'appointments.recurring.materialize';
    await tapBook(el);
    expect(byTestId(el, 'appointments-series-error')?.textContent?.trim()).toBe('boom');
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });

  it('switching a series on or off (which reloads the list) clears the old report', async () => {
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await createThroughTheForm(el);
    expect(byTestId(el, 'appointments-series-skipped')).toBeTruthy();
    await table(el).updateComplete;
    const toggle = table(el).shadowRoot?.querySelector('[data-testid="appointments-series-active-r1"]') as
      | (HTMLElement & { checked: boolean })
      | null;
    expect(toggle, 'the real active toggle of the row').toBeTruthy();
    toggle!.checked = false;
    toggle!.dispatchEvent(new CustomEvent('ionChange', { detail: { checked: false }, bubbles: true, composed: true }));
    await settle(el);
    expect(commands.some((c) => c.name === 'appointments.recurring.deactivate')).toBe(true);
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

  // Every refusal code the handler sends for a skipped occurrence has its own reason on screen: a
  // mistyped or dropped entry of the map would fall back to «could not be booked» in silence.
  it.each([
    ['appointments.outside_staff_hours', 'seriesSkipStaffHours'],
    ['appointments.outside_schedule', 'seriesSkipClosed'],
    ['appointments.blocked', 'seriesSkipBlocked'],
    ['appointments.overlapping_appointment', 'seriesSkipTaken'],
    ['appointments.invalid_start', 'seriesSkipPast'],
    ['appointments.too_soon', 'seriesSkipTooSoon'],
    ['appointments.too_far', 'seriesSkipTooFar'],
  ])('%s reads as its own reason', async (code, key) => {
    materializeResult = { booked: 1, already_booked: 0, skipped: [{ occurrence_date: '2099-10-13', code }] };
    const el = await mount();
    await tapBook(el);
    expect(byTestId(el, 'appointments-series-skipped-2099-10-13')?.textContent).toContain(ES[key]);
  });

  // A retry finds the dates a previous run booked already on the agenda: they are booked, so the
  // header counts them — «0 appointments booked» would read as if the series had none.
  it('a retry counts the dates already on the agenda as booked', async () => {
    materializeResult = {
      booked: 0,
      already_booked: 3,
      skipped: [{ occurrence_date: '2099-10-13', code: 'appointments.blocked' }],
    };
    const el = await mount();
    await tapBook(el);
    expect(byTestId(el, 'appointments-series-skipped')?.textContent?.replace(/\s+/g, ' ')).toContain(
      translate({ es: esLocale } as never, 'ui.seriesBookedSkipped', { booked: 3, skipped: 1 }),
    );
  });

  it('an answer that carries no report is still a success, not a failure', async () => {
    materializeResult = undefined;
    const el = await mount();
    await tapBook(el);
    expect(toasts.map((n) => n.message)).toContain(ES.seriesMaterialized);
    expect(el.error).toBe('');
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });

  it('a result without the list of skipped dates is still a success, not a crash', async () => {
    materializeResult = { booked: 4, already_booked: 0 };
    const el = await mount();
    await tapBook(el);
    expect(toasts.map((n) => n.message)).toContain(ES.seriesMaterialized);
    expect(el.error).toBe('');
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });

  it('with every date booked it keeps the plain success', async () => {
    const el = await mount();
    await tapBook(el);
    expect(toasts.map((n) => n.message)).toContain(ES.seriesMaterialized);
    expect(byTestId(el, 'appointments-series-skipped')).toBeNull();
  });
});

// appointments#267 — a professional with thousands of bookings ahead: one run of the series reads
// one page of her agenda and, when the page ends before the window does, answers where to go on
// (`next_from`) and up to when (`to`). The screen follows it, so the whole window is booked with
// one tap and the report adds every page up — instead of a series half booked with «booked» on
// screen, and a second tap that could never get past that page.
describe('a series against an agenda too long for one run is booked page by page (appointments#267)', () => {
  const FIRST_PAGE = { booked: 7, already_booked: 0, skipped: [], next_from: '2099-11-10', to: '2100-01-05' };
  const materializeRuns = () => commands.filter((c) => c.name === 'appointments.recurring.materialize');

  it('«Book appointments» goes on from `next_from` to the same `to` and reports both pages', async () => {
    materializePages = [
      { ...FIRST_PAGE, already_booked: 2, skipped: [{ occurrence_date: '2099-11-03', code: 'appointments.blocked' }] },
      { booked: 3, already_booked: 0, skipped: [{ occurrence_date: '2099-11-17', code: 'appointments.blocked' }] },
    ];
    const el = await mount();
    await tapBook(el);
    const runs = materializeRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].payload.from).toBeUndefined();
    expect(runs[1].payload).toMatchObject({ recurring_id: 'r1', staff_id: 's1', from: '2099-11-10', to: '2100-01-05' });
    expect(byTestId(el, 'appointments-series-skipped')?.textContent?.replace(/\s+/g, ' ')).toContain(
      translate({ es: esLocale } as never, 'ui.seriesBookedSkipped', { booked: 12, skipped: 2 }),
    );
    expect(byTestId(el, 'appointments-series-skipped-2099-11-03')).toBeTruthy();
    expect(byTestId(el, 'appointments-series-skipped-2099-11-17')).toBeTruthy();
  });

  it('creating a series books every page before saying «created and booked»', async () => {
    materializePages = [FIRST_PAGE, { booked: 2, already_booked: 0, skipped: [] }];
    const el = await mount();
    await createThroughTheForm(el);
    const runs = materializeRuns();
    expect(runs).toHaveLength(2);
    expect(runs[1].payload).toMatchObject({ from: '2099-11-10', to: '2100-01-05' });
    expect(toasts.map((n) => n.message)).toContain(ES.seriesCreated);
  });

  it('a `next_from` that does not move on stops instead of asking forever', async () => {
    materializePages = [FIRST_PAGE, { ...FIRST_PAGE, booked: 0 }, { ...FIRST_PAGE, booked: 0 }];
    const el = await mount();
    await tapBook(el);
    expect(materializeRuns()).toHaveLength(2);
    expect(el.error).toBe('');
  });

  it('an agenda that keeps answering a later `next_from` is followed for 20 runs at most', async () => {
    materializePages = Array.from({ length: 30 }, (_, i) => ({
      ...FIRST_PAGE,
      booked: 1,
      next_from: `2099-11-${String(i + 10).padStart(2, '0')}`,
    }));
    const el = await mount();
    await tapBook(el);
    expect(materializeRuns()).toHaveLength(20);
    expect(el.error).toBe('');
  });
});

// appointments#299 — a run books at most 50 occurrences. The cap now answers `next_from` like the
// end of a page, so a daily series is booked whole with one tap; and if the screen ever stops
// following before the window ends, it SAYS from which date nothing is booked yet instead of
// toasting «booked» over a series that stops halfway.
describe('a series with more dates than one run books (appointments#299)', () => {
  const CAPPED = { booked: 50, already_booked: 0, skipped: [], next_from: '2099-11-25', to: '2100-01-05' };
  const materializeRuns = () => commands.filter((c) => c.name === 'appointments.recurring.materialize');
  const endless = () =>
    Array.from({ length: 30 }, (_, i) => ({
      ...CAPPED,
      next_from: `2100-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`,
    }));

  it('creating a daily series books past the first 50 and only then says «created and booked»', async () => {
    materializePages = [CAPPED, { booked: 14, already_booked: 0, skipped: [] }];
    const el = await mount();
    await createThroughTheForm(el);
    const runs = materializeRuns();
    expect(runs).toHaveLength(2);
    expect(runs[1].payload).toMatchObject({ recurring_id: 'r1', from: '2099-11-25', to: '2100-01-05' });
    expect(toasts.map((n) => n.message)).toContain(ES.seriesCreated);
    expect(byTestId(el, 'appointments-series-pending')).toBeNull();
  });

  it('a window still unfinished after the last run says from which date nothing is booked yet', async () => {
    materializePages = endless();
    const el = await mount();
    await tapBook(el);
    expect(materializeRuns()).toHaveLength(20);
    const pending = byTestId(el, 'appointments-series-pending');
    expect(pending, 'the dates still to book are said').toBeTruthy();
    expect(pending!.textContent?.replace(/\s+/g, ' ')).toContain(
      translate({ es: esLocale } as never, 'ui.seriesPendingFrom', { date: '20/01/2100' }),
    );
    const report = byTestId(el, 'appointments-series-skipped');
    expect(report?.getAttribute('tone')).toBe('warning');
    expect(report?.textContent?.replace(/\s+/g, ' ')).toContain(
      translate({ es: esLocale } as never, 'ui.seriesBookedSoFar', { booked: 1000 }),
    );
    expect(toasts.some((n) => n.message === ES.seriesMaterialized), 'no «booked» toast over a half-booked series').toBe(false);
  });

  it('a retry over an unfinished window counts what a previous tap already booked', async () => {
    materializePages = endless();
    materializePages[0] = { ...CAPPED, booked: 0, already_booked: 50 };
    const el = await mount();
    await tapBook(el);
    expect(byTestId(el, 'appointments-series-skipped')?.textContent?.replace(/\s+/g, ' ')).toContain(
      translate({ es: esLocale } as never, 'ui.seriesBookedSoFar', { booked: 1000 }),
    );
  });

  it('an unfinished window with dates left out names both', async () => {
    materializePages = endless();
    materializePages[0] = { ...CAPPED, skipped: [{ occurrence_date: '2099-10-13', code: 'appointments.blocked' }] };
    const el = await mount();
    await createThroughTheForm(el);
    expect(byTestId(el, 'appointments-series-skipped')?.textContent?.replace(/\s+/g, ' ')).toContain(
      translate({ es: esLocale } as never, 'ui.seriesBookedSkipped', { booked: 1000, skipped: 1 }),
    );
    expect(byTestId(el, 'appointments-series-skipped-2099-10-13')).toBeTruthy();
    expect(byTestId(el, 'appointments-series-pending')).toBeTruthy();
    expect(toasts.some((n) => n.message === ES.seriesCreated)).toBe(false);
  });

  it.each(['seriesPendingFrom', 'seriesBookedSoFar'])('%s exists in en AND es', (key) => {
    expect(EN[key], `en ${key}`).toBeTruthy();
    expect(ES[key], `es ${key}`).toBeTruthy();
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

// appointments#236 — «this and following» now judges every occurrence it moves like a single
// reschedule (opening hours, her shift, blocked time, another appointment, the past, the lead time)
// and LEAVES on its own slot the ones that do not fit, as Mindbody, Acuity or SimplyBook.me do.
// The command answers them in `result.skipped`; the screen has to say which dates stayed and why —
// Square moves them on top of other appointments without a word, and that is the complaint.
const TWO_NOT_MOVED = {
  recurring_id: 'r2',
  split: true,
  pattern_changed: false,
  moved: 1,
  cancelled_pattern_change: 0,
  locked_invoiced: 0,
  skipped: [
    { occurrence_date: '2099-10-13', code: 'appointments.blocked' },
    { occurrence_date: '2099-10-20', code: 'appointments.outside_schedule' },
  ],
};

async function moveTheTime(el: Wc) {
  await el.openSeries(SERIES_ROW);
  el.editTime = '12:30';
  await el.submitEdit(new Event('submit'));
  await settle(el);
}

describe('moving a series lists the dates that stayed where they were (appointments#236)', () => {
  it('names each date left on its slot with the reason, after saving', async () => {
    updateResult = TWO_NOT_MOVED;
    const el = await mount();
    await moveTheTime(el);

    const report = byTestId(el, 'appointments-series-not-moved');
    expect(report, 'the dates that could not be moved are on screen').toBeTruthy();
    expect(report!.getAttribute('tone')).toBe('warning');
    const text = report!.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain(translate({ es: esLocale } as never, 'ui.seriesMovedSkipped', { moved: 1, skipped: 2 }));
    const first = byTestId(el, 'appointments-series-not-moved-2099-10-13')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(first).toContain('13/10/2099');
    expect(first).toContain(ES.seriesSkipBlocked);
    const second = byTestId(el, 'appointments-series-not-moved-2099-10-20')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(second).toContain('20/10/2099');
    expect(second).toContain(ES.seriesSkipClosed);
    // A time change books nothing: only the move ran.
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.update']);
  });

  it('the counts of the toast are the ones the command answered, not zero', async () => {
    updateResult = { ...TWO_NOT_MOVED, moved: 3, skipped: [] };
    const el = await mount();
    await moveTheTime(el);
    expect(byTestId(el, 'appointments-series-not-moved')).toBeNull();
    expect(toasts.at(-1)?.message).toBe(
      translate({ es: esLocale } as never, 'ui.seriesUpdateOutcome', { moved: 3, cancelled: 0, locked: 0 }),
    );
    expect(toasts.at(-1)?.type).toBe('success');
  });

  it('with dates left behind the toast is a warning, not a success', async () => {
    updateResult = TWO_NOT_MOVED;
    const el = await mount();
    await moveTheTime(el);
    expect(toasts.at(-1)?.type).toBe('warning');
  });

  it('an occurrence handed to another professional and an unknown code read as sentences, never the raw code', async () => {
    updateResult = {
      ...TWO_NOT_MOVED,
      skipped: [
        { occurrence_date: '2099-10-13', code: 'appointments.staff_hours_unavailable' },
        { occurrence_date: '2099-10-20', code: 'appointments.something_new' },
      ],
    };
    const el = await mount();
    await moveTheTime(el);
    const first = byTestId(el, 'appointments-series-not-moved-2099-10-13')?.textContent ?? '';
    expect(first).toContain(ES.seriesSkipStaffUnknown);
    const second = byTestId(el, 'appointments-series-not-moved-2099-10-20')?.textContent ?? '';
    expect(second).toContain(ES.seriesMoveSkipOther);
    expect(first + second).not.toContain('appointments.');
  });

  it('a pattern change paints BOTH: the dates not moved and the new dates not booked', async () => {
    updateResult = { ...TWO_NOT_MOVED, pattern_changed: true };
    materializeResult = TWO_SKIPPED;
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    el.editFrequency = 'biweekly';
    await el.submitEdit(new Event('submit'));
    await settle(el);
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.update', 'appointments.recurring.materialize']);
    expect(byTestId(el, 'appointments-series-not-moved')).toBeTruthy();
    expectReportOfTwoSkipped(el);
  });

  it('the next action clears an old «not moved» report', async () => {
    updateResult = TWO_NOT_MOVED;
    const el = await mount();
    await moveTheTime(el);
    expect(byTestId(el, 'appointments-series-not-moved')).toBeTruthy();
    updateResult = { ...TWO_NOT_MOVED, skipped: [] };
    await moveTheTime(el);
    expect(byTestId(el, 'appointments-series-not-moved')).toBeNull();
  });

  it('switching a series on or off (which reloads the list) clears the old «not moved» report', async () => {
    updateResult = TWO_NOT_MOVED;
    const el = await mount();
    await moveTheTime(el);
    expect(byTestId(el, 'appointments-series-not-moved')).toBeTruthy();
    await table(el).updateComplete;
    const toggle = table(el).shadowRoot?.querySelector('[data-testid="appointments-series-active-r1"]') as
      | (HTMLElement & { checked: boolean })
      | null;
    expect(toggle, 'the real active toggle of the row').toBeTruthy();
    toggle!.checked = false;
    toggle!.dispatchEvent(new CustomEvent('ionChange', { detail: { checked: false }, bubbles: true, composed: true }));
    await settle(el);
    expect(commands.some((c) => c.name === 'appointments.recurring.deactivate')).toBe(true);
    expect(byTestId(el, 'appointments-series-not-moved')).toBeNull();
  });
});

describe('every new visible string of appointments#236 exists in en AND es', () => {
  it.each(['seriesMovedSkipped', 'seriesSkipStaffUnknown', 'seriesMoveSkipOther'])('%s', (key) => {
    expect(EN[key], `en ${key}`).toBeTruthy();
    expect(ES[key], `es ${key}`).toBeTruthy();
  });
});
