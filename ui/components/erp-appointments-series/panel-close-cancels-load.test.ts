// appointments#211 — closing the series panel while an edit loads cancels the load.
//
// «Edit series» awaits the FULL series (`recurring.get` + `recurring.occurrences`) and only then
// fills the form and opens the panel. With the panel already open (another series, or «Add»), the
// person taps «edit» on a row and closes the panel — the X, the backdrop or Escape — before the
// read lands: the late reply must neither reopen the panel nor fill the form. ok-data-table ≥0.1.97
// emits `panelClose` (outfitkit#195) on every open→closed transition; the screen retires the
// pending load on it. Every tap and close below goes through the REAL table (its shadow DOM),
// never a handler called by hand.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';

const ROW_A = {
  id: 'r1',
  customer_name: 'Ana López',
  service_name: 'Corte',
  staff_name: 'Eva Pro',
  frequency: 'weekly',
  day_of_week: 0,
  time: '11:00',
  duration_minutes: 30,
  start_date: '2020-01-06',
  end_date: null,
  max_occurrences: null,
  is_active: 1,
};
const ROW_B = { ...ROW_A, id: 'r9', customer_name: 'Bea Ruiz', time: '17:30', frequency: 'monthly' };
const template = (row: typeof ROW_A) => ({ ...row, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null });

type Query = (name: string, params?: Record<string, unknown>) => Promise<unknown>;
const baseQuery: Query = async (name, params) => {
  switch (name) {
    case 'appointments.recurring.list':
      return { rows: [ROW_A, ROW_B], total: 2 };
    case 'appointments.recurring.get':
      return [template(params?.recurring_id === 'r9' ? ROW_B : ROW_A)];
    default:
      return [];
  }
};
let query: Query;

beforeEach(() => {
  query = baseQuery;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: (name: string, params?: Record<string, unknown>) => query(name, params),
    command: async () => ({ ok: true }),
    on: () => () => {},
    t: (cat: Record<string, { ui?: Record<string, string> }>, key: string) =>
      cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key,
    locale: 'es',
    notify: () => {},
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Table = HTMLElement & { panel: string; shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };
type Mounted = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  editingId: string;
  editTime: string;
  editFrequency: string;
  error: string;
};

async function mount(): Promise<Mounted> {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Mounted;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const table = (el: Mounted) => el.shadowRoot.querySelector('ok-data-table') as unknown as Table;
const settle = async (el: Mounted) => {
  for (let i = 0; i < 3; i++) {
    await tick();
    await el.updateComplete;
    await table(el).updateComplete;
  }
};

async function tapEdit(el: Mounted, id: string): Promise<void> {
  await table(el).updateComplete;
  const btn = table(el).shadowRoot.querySelector(`[data-testid="appointments-series-table-row-${id}-edit"]`) as HTMLElement | null;
  expect(btn, `the real «edit» button of row ${id}`).toBeTruthy();
  btn?.click();
}

function hold(): { wait: Promise<void>; release: () => void; fail: () => void } {
  let release: () => void = () => {};
  let fail: () => void = () => {};
  const wait = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = () => reject(new Error('boom'));
  });
  return { wait, release, fail };
}

const CLOSES: Array<[string, (t: Table) => void]> = [
  ['the X button', (t) => (t.shadowRoot.querySelector('.drawer .dh ion-button') as HTMLElement).click()],
  ['the backdrop', (t) => (t.shadowRoot.querySelector('.tk-scrim') as HTMLElement).click()],
  ['Escape', (t) => t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }))],
];

/** Holds the read of series B (`recurring.get` for r9) until the returned gate opens. */
function holdSeriesB(): ReturnType<typeof hold> & { reads: () => number } {
  const gate = hold();
  let reads = 0;
  query = async (name, params) => {
    if (name === 'appointments.recurring.get' && params?.recurring_id === 'r9') {
      reads++;
      await gate.wait;
    }
    return baseQuery(name, params);
  };
  return { ...gate, reads: () => reads };
}

/** Opens series A for editing through the REAL row button, then taps «edit» on B with its read held. */
async function editAThenTapB(el: Mounted): Promise<ReturnType<typeof holdSeriesB>> {
  await tapEdit(el, 'r1');
  await settle(el);
  expect(table(el).panel, 'positive control: «edit» opens the edit panel').toBe('edit');
  expect(el.editingId).toBe('r1');
  const gate = holdSeriesB();
  await tapEdit(el, 'r9');
  await tick();
  expect(gate.reads(), 'the read of B is in flight').toBe(1);
  return gate;
}

async function close(el: Mounted, how: (t: Table) => void): Promise<void> {
  how(table(el));
  await table(el).updateComplete;
  expect(table(el).panel, 'the close really closed the panel').toBe('none');
}

describe('closing the series panel while an edit loads cancels the load (appointments#211)', () => {
  it.each(CLOSES)('closed with %s: the late series neither reopens the panel nor fills the form', async (_how, how) => {
    const el = await mount();
    const gate = await editAThenTapB(el);
    await close(el, how);
    gate.release();
    await settle(el);
    expect(table(el).panel, 'the panel the person closed stays closed').toBe('none');
    expect(el.editingId, 'a read nobody waits for must not turn the form into B').not.toBe('r9');
    expect(el.editTime).not.toBe('17:30');
    expect(el.editFrequency).not.toBe('monthly');
  });

  it.each(CLOSES)('closed with %s: a late FAILURE paints no error under the closed panel', async (_how, how) => {
    const el = await mount();
    const gate = await editAThenTapB(el);
    await close(el, how);
    gate.fail();
    await settle(el);
    expect(el.error).toBe('');
    expect(table(el).panel).toBe('none');
  });

  it('closed with the X after «Add»: the late series does not reopen the panel as an edit', async () => {
    const el = await mount();
    (table(el).shadowRoot.querySelector('[data-testid="appointments-series-table-add"]') as HTMLElement).click();
    await settle(el);
    expect(table(el).panel, 'positive control: «Add» opens the create panel').toBe('create');
    const gate = holdSeriesB();
    await tapEdit(el, 'r9');
    await tick();
    expect(gate.reads()).toBe(1);
    await close(el, CLOSES[0][1]);
    gate.release();
    await settle(el);
    expect(table(el).panel).toBe('none');
    expect(el.editingId).toBe('');
  });

  it('positive control: with the panel left OPEN the same slow read does fill the form', async () => {
    const el = await mount();
    const gate = await editAThenTapB(el);
    gate.release();
    await settle(el);
    expect(el.editingId).toBe('r9');
    expect(el.editTime).toBe('17:30');
    expect(table(el).panel).toBe('edit');
    expect(table(el).shadowRoot.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      (esLocale as { ui: Record<string, string> }).ui.seriesEditTitle,
    );
  });
});
