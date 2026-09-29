// appointments#246 — a series with no professional (or no customer, or no service) SAYS why its
// appointments cannot be booked, instead of sending a command that can only fail.
//
// `appointments.recurring.create` used to accept a series without the professional (the assistant
// and the API could; the screen never did), and «Book appointments» on its row then sent
// `appointments.recurring.materialize` with `staff_id: ''`: the schema refused it and the front desk
// read the raw `invalid_payload` text. The create door is closed now (tests/
// recurring_create_booking_ids.contract.test.py); what is left is the series already saved that
// way. The screen does not send what it knows the kernel will refuse: it tells the person what the
// series is missing and what to do about it, in their language.
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
  staff_name: '',
  frequency: 'weekly',
  day_of_week: 1,
  time: '10:00',
  duration_minutes: 30,
  start_date: '2099-10-06',
  end_date: null,
  max_occurrences: 4,
  is_active: 1,
};
const COMPLETE = { ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null };

let template: Record<string, unknown> = COMPLETE;

/** The shell's `t`: looks the key up and fills `{placeholders}`, like the real client. */
function translate(cat: Record<string, { ui?: Record<string, string> }>, key: string, params?: Record<string, unknown>) {
  const raw = cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}

beforeEach(() => {
  commands.length = 0;
  toasts.length = 0;
  template = COMPLETE;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.recurring.list':
          return { rows: [SERIES_ROW], total: 1 };
        case 'appointments.recurring.get':
          return [template];
        case 'appointments.recurring.occurrences':
          return [];
        default:
          return { rows: [], total: 0 };
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (name === 'appointments.recurring.materialize') {
        return { ok: true, result: { booked: 4, already_booked: 0, skipped: [] } };
      }
      if (name === 'appointments.recurring.update') {
        return { recurring_id: 'r1', split: false, pattern_changed: true, moved: 0, cancelled_pattern_change: 0, locked_invoiced: 0 };
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
  editError: string;
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

/** The real «Book appointments» button of the row. */
async function tapBook(el: Wc) {
  await table(el).updateComplete;
  const btn = table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-row-r1-materialize"]') as HTMLElement | null;
  expect(btn, 'the real «Book appointments» button').toBeTruthy();
  btn!.click();
  await settle(el);
}

describe('«Book appointments» on a series missing one of its links (appointments#246)', () => {
  it.each([
    ['staff_id', 'seriesNoStaff'],
    ['customer_id', 'seriesNoCustomer'],
    ['service_id', 'seriesNoService'],
  ])('without %s it sends nothing and says what is missing', async (field, key) => {
    template = { ...COMPLETE, [field]: null };
    const el = await mount();
    await tapBook(el);
    expect(commands.map((c) => c.name)).not.toContain('appointments.recurring.materialize');
    expect(byTestId(el, 'appointments-series-error')?.textContent?.trim()).toBe(ES[key]);
    expect(toasts).toEqual([]);
  });

  it('an EMPTY id counts as missing, like the kernel counts it', async () => {
    template = { ...COMPLETE, staff_id: '' };
    const el = await mount();
    await tapBook(el);
    expect(commands.map((c) => c.name)).not.toContain('appointments.recurring.materialize');
    expect(el.error).toBe(ES.seriesNoStaff);
  });

  it('a complete series still books (the guard does not refuse everything)', async () => {
    const el = await mount();
    await tapBook(el);
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.materialize']);
    expect(el.error).toBe('');
    expect(toasts.map((n) => n.message)).toContain(ES.seriesMaterialized);
  });
});

describe('a pattern change on a series without professional (appointments#246)', () => {
  it('saves the change and says why the new days are not booked, never the raw refusal', async () => {
    template = { ...COMPLETE, staff_id: null };
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    await settle(el);
    el.editFrequency = 'biweekly';
    await el.submitEdit(new Event('submit'));
    await settle(el);
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.update']);
    expect(el.editError).toBe(ES.seriesNoStaff);
  });
});

describe('every new visible string of appointments#246 exists in en AND es', () => {
  it.each(['seriesNoStaff', 'seriesNoCustomer', 'seriesNoService'])('%s', (key) => {
    expect(EN[key], `en ${key}`).toBeTruthy();
    expect(ES[key], `es ${key}`).toBeTruthy();
    expect(ES[key]).not.toBe(EN[key]);
  });
});
