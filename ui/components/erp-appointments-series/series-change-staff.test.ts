// appointments#248 — the professional of a series can be changed for «this and following».
//
// The edit panel of a series only offered the pattern, the time and the minutes: when the
// professional left, changed shift or the series had been saved without one, the only way out was
// deleting the series and creating it again — losing its history and its link with what was
// already booked. Fresha, Square Appointments and Booksy let the front desk pick another
// professional for the following appointments. The panel now does: it says before saving how many
// booked appointments go to her, sends the series' current professional as the selector and the new
// one as `staff_id`, and after saving says which dates she could not take (they stay as they were).
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

const HANDED_ALL = {
  recurring_id: 'r1',
  split: false,
  pattern_changed: false,
  staff_changed: true,
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
  updateResult = HANDED_ALL;
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
          return { rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
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

describe('changing the professional of a series (appointments#248)', () => {
  it('offers the bookable professionals with the current one picked', async () => {
    const el = await mount();
    await openEdit(el);
    const select = byTestId(el, 'appointments-series-staff') as HTMLElement & { value?: unknown };
    expect(select).toBeTruthy();
    expect(select.value).toBe('s1');
    const options = [...select.querySelectorAll('ion-select-option')].map((o) => (o as HTMLElement & { value?: unknown }).value);
    expect(options).toEqual(['s1', 's2']);
    expect(byTestId(el, 'appointments-series-staff-hint'), 'no hint while nothing changes').toBeNull();
  });

  it('keeps the current professional on the field when she no longer takes appointments', async () => {
    // She left or stopped being bookable: the series still says who does it today, and the others
    // are offered to hand it over.
    template = { ...WITH_EVA, staff_id: 's3', staff_name: 'Back Office' };
    const el = await mount();
    await openEdit(el);
    const select = byTestId(el, 'appointments-series-staff') as HTMLElement & { value?: unknown };
    expect(select.value).toBe('s3');
    const options = [...select.querySelectorAll('ion-select-option')].map((o) => [
      (o as HTMLElement & { value?: unknown }).value,
      text(o),
    ]);
    expect(options).toEqual([
      ['s3', 'Back Office'],
      ['s1', 'Eva Pro'],
      ['s2', 'Carla Pro'],
    ]);
  });

  it('says before saving how many booked appointments go to the new professional', async () => {
    const el = await mount();
    await openEdit(el);
    await pickStaff(el, 's2');
    const hint = byTestId(el, 'appointments-series-staff-hint');
    expect(hint).toBeTruthy();
    expect(text(hint)).toBe(fill(ES.seriesStaffChangeHint, { from: '06/10/2099', upcoming: 2, staff: 'Carla Pro' }));
  });

  it('sends the current professional as the selector, the new one and the service', async () => {
    const el = await mount();
    await openEdit(el);
    await pickStaff(el, 's2');
    await save(el);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({
      recurring_id: 'r1',
      current_staff_id: 's1',
      staff_id: 's2',
      service_id: 'sv1',
      scope: 'this_and_following',
      from_occurrence_date: '2099-10-06',
    });
    // Nothing of the pattern changed: nothing new to book.
    expect(commands.some((c) => c.name === 'appointments.recurring.materialize')).toBe(false);
    expect(toasts.map((n) => n.type)).toEqual(['success']);
  });

  it('without a change of professional the payload is the one it always was', async () => {
    const el = await mount();
    await openEdit(el);
    const time = byTestId(el, 'appointments-series-time') as HTMLElement & { value?: unknown };
    time.value = '11:00';
    time.dispatchEvent(new CustomEvent('ionInput', { detail: { value: '11:00' }, bubbles: true, composed: true }));
    time.dispatchEvent(new CustomEvent('ionChange', { detail: { value: '11:00' }, bubbles: true, composed: true }));
    await settle(el);
    updateResult = { ...HANDED_ALL, staff_changed: false };
    await save(el);
    expect(updates()[0].payload).toEqual({
      recurring_id: 'r1',
      staff_id: 's1',
      scope: 'this_and_following',
      from_occurrence_date: '2099-10-06',
      time: '11:00',
    });
  });

  it('names the dates the new professional could not take, and that they stay as they were', async () => {
    updateResult = {
      ...HANDED_ALL,
      moved: 1,
      skipped: [{ occurrence_date: '2099-10-13', code: 'appointments.overlapping_appointment' }],
    };
    const el = await mount();
    await openEdit(el);
    await pickStaff(el, 's2');
    await save(el);
    const report = byTestId(el, 'appointments-series-not-moved');
    expect(report, 'what she could not take is on screen').toBeTruthy();
    expect(report!.getAttribute('tone')).toBe('warning');
    expect(text(report!.querySelector('strong'))).toBe(fill(ES.seriesReassignedSkipped, { moved: 1, skipped: 1, staff: 'Carla Pro' }));
    const line = text(byTestId(el, 'appointments-series-not-moved-2099-10-13'));
    expect(line).toContain('13/10/2099');
    expect(line).toContain(ES.seriesSkipTaken);
    expect(toasts.map((n) => n.type)).toEqual(['warning']);
  });

  it('a series saved without a professional gets one and its appointments are booked with her', async () => {
    template = WITHOUT_STAFF;
    occurrences = [];
    const el = await mount();
    await openEdit(el);
    const select = byTestId(el, 'appointments-series-staff') as HTMLElement & { value?: unknown };
    expect(select.value).toBe('');
    // The panel says what is missing and what to do, here where it can be done.
    expect(text(byTestId(el, 'appointments-series-no-staff'))).toBe(ES.seriesPickStaffToBook);
    await pickStaff(el, 's2');
    await save(el);
    expect(updates()[0].payload).toMatchObject({ current_staff_id: '', staff_id: 's2', service_id: 'sv1' });
    const materialize = commands.find((c) => c.name === 'appointments.recurring.materialize');
    expect(materialize, 'nothing of it was ever booked: saving books it').toBeTruthy();
    expect(materialize!.payload).toEqual({ recurring_id: 'r1', customer_id: 'c1', service_id: 'sv1', staff_id: 's2' });
  });

  it('«Book appointments» on a series without a professional says how to fix it: edit it', () => {
    for (const cat of [ES, EN]) {
      expect(cat.seriesNoStaff).toBeTruthy();
      expect(cat.seriesPickStaffToBook).toBeTruthy();
      expect(cat.seriesStaffChangeHint).toContain('{staff}');
      expect(cat.seriesReassignedSkipped).toContain('{skipped}');
    }
  });
});
