// appointments#252 — the service of a series can be changed for «this and following».
//
// The edit panel offered the professional, the pattern, the time and the minutes, but not the
// service: a customer who went from «Corte» to «Corte y color» meant deleting the series and
// creating it again, losing its history and its link with what was already booked. The panel now
// offers the service like the professional: picking another one pre-fills «Min.» with its length,
// says before saving how many booked appointments take it, and sends the series' current service
// as the selector and the new one as `service_id`.
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
const WITH_EVA = { ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null };
const WITHOUT_STAFF = { ...WITH_EVA, staff_id: '', staff_name: '' };
const OCCURRENCES = [
  { id: 'a1', occurrence_date: '2099-10-06', status: 'confirmed', converted_sale_id: null },
  { id: 'a2', occurrence_date: '2099-10-13', status: 'pending', converted_sale_id: null },
];

let template: Record<string, unknown> = WITH_EVA;
let occurrences: unknown[] = OCCURRENCES;
let updateResult: Record<string, unknown> = {};

const RECOLOURED = {
  recurring_id: 'r1',
  split: false,
  pattern_changed: false,
  staff_changed: false,
  service_changed: true,
  moved: 2,
  cancelled_pattern_change: 0,
  locked_invoiced: 0,
  skipped: [],
};

/** The shell's `t`: looks the key up and fills `{placeholders}`, like the real client. */
function translate(cat: Record<string, { ui?: Record<string, string> }>, key: string, params?: Record<string, unknown>) {
  const raw = cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}
const fill = (raw: string, params: Record<string, unknown>) =>
  raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));

beforeEach(() => {
  commands.length = 0;
  toasts.length = 0;
  template = WITH_EVA;
  occurrences = OCCURRENCES;
  updateResult = RECOLOURED;
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
          return occurrences;
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '', email: '' }], total: 1 };
        case 'services.services.list':
          return {
            rows: [
              { id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 },
              { id: 'sv2', name: 'Corte y color', price: 4500, duration_minutes: 60, is_bookable: 1 },
              { id: 'sv4', name: 'Corte premium', price: 3000, duration_minutes: 30, is_bookable: 1 },
              { id: 'sv3', name: 'Uso interno', price: 0, duration_minutes: 15, is_bookable: 0 },
            ],
            total: 4,
          };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Carla Pro', status: 'active', is_bookable: 1 },
              { id: 's3', full_name: 'Back Office', status: 'active', is_bookable: 0 },
            ],
            total: 3,
          };
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (name === 'appointments.recurring.materialize') {
        return { ok: true, new_ids: [], operations: 0, result: { booked: 2, already_booked: 0, skipped: [] } };
      }
      if (name === 'appointments.recurring.update') {
        // The dispatcher's envelope: the handler's answer travels in `result` (appointments#236).
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
  openSeries: (row: Record<string, unknown>) => Promise<void>;
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
const text = (node: Element | null) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function openEdit(el: Wc) {
  await el.openSeries({ id: 'r1' });
  await settle(el);
}

async function pickStaff(el: Wc, id: string) {
  const select = byTestId(el, 'appointments-series-staff') as (HTMLElement & { value?: unknown }) | null;
  expect(select, 'the edit panel offers the professional').toBeTruthy();
  select!.value = id;
  select!.dispatchEvent(new CustomEvent('ionChange', { detail: { value: id }, bubbles: true, composed: true }));
  await settle(el);
}

async function save(el: Wc) {
  (byTestId(el, 'appointments-series-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(el);
}

const updates = () => commands.filter((c) => c.name === 'appointments.recurring.update');

async function pickService(el: Wc, id: string) {
  const select = byTestId(el, 'appointments-series-service') as (HTMLElement & { value?: unknown }) | null;
  expect(select, 'the edit panel offers the service').toBeTruthy();
  select!.value = id;
  select!.dispatchEvent(new CustomEvent('ionChange', { detail: { value: id }, bubbles: true, composed: true }));
  await settle(el);
}

describe('changing the service of a series (appointments#252)', () => {
  it('offers the bookable services with the current one picked', async () => {
    const el = await mount();
    await openEdit(el);
    const select = byTestId(el, 'appointments-series-service') as HTMLElement & { value?: unknown };
    expect(select).toBeTruthy();
    expect(select.value).toBe('sv1');
    const options = [...select.querySelectorAll('ion-select-option')].map((o) => (o as HTMLElement & { value?: unknown }).value);
    expect(options).toEqual(['sv1', 'sv2', 'sv4']);
    expect(byTestId(el, 'appointments-series-service-hint'), 'no hint while nothing changes').toBeNull();
  });

  it('keeps the current service on the field when it can no longer be booked', async () => {
    template = { ...WITH_EVA, service_id: 'sv3', service_name: 'Uso interno' };
    const el = await mount();
    await openEdit(el);
    const select = byTestId(el, 'appointments-series-service') as HTMLElement & { value?: unknown };
    expect(select.value).toBe('sv3');
    const options = [...select.querySelectorAll('ion-select-option')].map((o) => [
      (o as HTMLElement & { value?: unknown }).value,
      text(o),
    ]);
    expect(options).toEqual([
      ['sv3', 'Uso interno'],
      ['sv1', 'Corte'],
      ['sv2', 'Corte y color'],
      ['sv4', 'Corte premium'],
    ]);
  });

  it('pre-fills the minutes with the new service and says before saving what changes', async () => {
    const el = await mount();
    await openEdit(el);
    await pickService(el, 'sv2');
    const minutes = byTestId(el, 'appointments-series-duration') as HTMLElement & { value?: unknown };
    expect(minutes.value).toBe('60');
    const hint = byTestId(el, 'appointments-series-service-hint');
    expect(hint).toBeTruthy();
    expect(text(hint)).toBe(fill(ES.seriesServiceChangeHint, { from: '06/10/2099', upcoming: 2, service: 'Corte y color' }));
    // Back to the series' own service: its own minutes come back and nothing is announced.
    await pickService(el, 'sv1');
    expect(minutes.value).toBe('30');
    expect(byTestId(el, 'appointments-series-service-hint')).toBeNull();
  });

  it('sends the current service as the selector, the new one and its minutes', async () => {
    const el = await mount();
    await openEdit(el);
    await pickService(el, 'sv2');
    await save(el);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({
      recurring_id: 'r1',
      staff_id: 's1',
      current_service_id: 'sv1',
      service_id: 'sv2',
      scope: 'this_and_following',
      from_occurrence_date: '2099-10-06',
      duration_minutes: 60,
    });
    expect(commands.some((c) => c.name === 'appointments.recurring.materialize')).toBe(false);
    expect(toasts.map((n) => n.type)).toEqual(['success']);
  });

  it('a service of the same length is a change too: it is sent, not dropped as «nothing changed»', async () => {
    const el = await mount();
    await openEdit(el);
    await pickService(el, 'sv4');
    await save(el);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({
      recurring_id: 'r1',
      staff_id: 's1',
      current_service_id: 'sv1',
      service_id: 'sv4',
      scope: 'this_and_following',
      from_occurrence_date: '2099-10-06',
    });
  });

  it('changes the professional and the service in one save', async () => {
    const el = await mount();
    await openEdit(el);
    await pickStaff(el, 's2');
    await pickService(el, 'sv2');
    await save(el);
    expect(updates()[0].payload).toEqual({
      recurring_id: 'r1',
      current_staff_id: 's1',
      staff_id: 's2',
      current_service_id: 'sv1',
      service_id: 'sv2',
      scope: 'this_and_following',
      from_occurrence_date: '2099-10-06',
      duration_minutes: 60,
    });
  });

  it('books the new days of a new pattern with the new service', async () => {
    updateResult = { ...RECOLOURED, pattern_changed: true };
    const el = await mount();
    await openEdit(el);
    await pickService(el, 'sv2');
    const freq = byTestId(el, 'appointments-series-frequency') as HTMLElement & { value?: unknown };
    freq.value = 'biweekly';
    freq.dispatchEvent(new CustomEvent('ionChange', { detail: { value: 'biweekly' }, bubbles: true, composed: true }));
    await settle(el);
    await save(el);
    const booked = commands.find((c) => c.name === 'appointments.recurring.materialize');
    expect(booked?.payload).toMatchObject({ service_id: 'sv2', staff_id: 's1', customer_id: 'c1' });
  });

  it('has the hint in English and Spanish', () => {
    expect(EN.seriesServiceChangeHint).toContain('{service}');
    expect(ES.seriesServiceChangeHint).toContain('{service}');
    expect(ES.seriesServiceChangeHint).not.toBe(EN.seriesServiceChangeHint);
  });
});
