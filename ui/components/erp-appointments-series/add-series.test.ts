// appointments#209 — a repeating appointment can be CREATED from the «Repeating» view.
//
// The view listed the series and let them be edited, booked, switched off and deleted, but it had
// no way to create one: `appointments.recurring.create` existed in the manifest and no screen
// called it. These tests drive the REAL «Add» button of ok-data-table (never a method by hand),
// fill the same Day + Time pair the new-appointment panel uses (appointments#204), and check that
// the series is created by the existing command, gets its appointments booked (like Fresha or
// Square, a new repeating appointment lands on the agenda) and shows up in the list.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
import { dataTableLabels } from '@erplora/module-sdk';

const ES = (esLocale as { ui: Record<string, string> }).ui;
const EN = (enLocale as { ui: Record<string, string> }).ui;

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params: Record<string, unknown> | undefined }[] = [];

const SERIES_ROW = {
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
const SERIES_TEMPLATE = { ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null };

const NEW_ROW = {
  id: 'r-new',
  customer_name: 'Bea Ruiz',
  service_name: 'Tinte',
  staff_name: 'Eva Pro',
  frequency: 'biweekly',
  day_of_week: 4,
  time: '17:30',
  duration_minutes: 90,
  start_date: '2099-10-01',
  end_date: null,
  max_occurrences: 6,
  is_active: 1,
};

let created = false;
let failing = '';
/** When set, `appointments.recurring.get` waits for it (a slow «edit» opening). */
let heldGet: Promise<void> | null = null;

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  created = false;
  failing = '';
  heldGet = null;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.recurring.list':
          return { rows: created ? [SERIES_ROW, NEW_ROW] : [SERIES_ROW], total: created ? 2 : 1 };
        case 'appointments.recurring.get':
          if (heldGet) await heldGet;
          return [SERIES_TEMPLATE];
        case 'appointments.recurring.occurrences':
          return [];
        case 'customers.list':
          return {
            rows: [
              { id: 'c1', name: 'Ana López', phone: '600111222', email: '' },
              { id: 'c2', name: 'Bea Ruiz', phone: '600333444', email: 'bea@example.com' },
            ],
            total: 2,
          };
        case 'services.services.list':
          return {
            rows: [
              { id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 },
              { id: 'sv2', name: 'Tinte', price: 4500, duration_minutes: 90, is_bookable: 1 },
              { id: 'sv3', name: 'Interno', price: 0, duration_minutes: 15, is_bookable: 0 },
            ],
            total: 3,
          };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Recepción', status: 'active', is_bookable: 0 },
            ],
            total: 2,
          };
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (failing === name) throw new Error('boom');
      if (name === 'appointments.recurring.create') {
        created = true;
        return { ok: true, new_ids: ['r-new'] };
      }
      return { ok: true };
    },
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

type Table = HTMLElement & {
  updateComplete: Promise<unknown>;
  labels: Record<string, string>;
  panel: string;
};

type Wc = HTMLElement & {
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
  series: Record<string, unknown>[];
  error: string;
  editingId: string;
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

const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Table;

const field = (el: Wc, testid: string) =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { value?: unknown }) | null;

/** The real «Add» button ok-data-table paints in its toolbar. */
const tapAdd = async (el: Wc) => {
  await table(el).updateComplete;
  const btn = table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-add"]') as HTMLElement | null;
  expect(btn, 'the real «Add» button of the series table').toBeTruthy();
  btn?.click();
  await settle(el);
};

const tapEdit = async (el: Wc, id: string) => {
  await table(el).updateComplete;
  const btn = table(el).shadowRoot?.querySelector(`[data-testid="appointments-series-table-row-${id}-edit"]`) as HTMLElement | null;
  expect(btn, `the real «edit» button of row ${id}`).toBeTruthy();
  btn?.click();
};

/** What `ion-select` does on a pick: holds the value and emits `ionChange`. */
async function choose(el: Wc, testid: string, value: string) {
  const f = field(el, testid);
  expect(f, `${testid} must be rendered`).toBeTruthy();
  f!.value = value;
  f!.dispatchEvent(new CustomEvent('ionChange', { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

/** What `ion-input` does when the receptionist types: holds the value and emits `ionInput`. */
async function type(el: Wc, testid: string, value: string) {
  const f = field(el, testid);
  expect(f, `${testid} must be rendered`).toBeTruthy();
  f!.value = value;
  f!.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

const submitButton = (el: Wc) => field(el, 'appointments-series-create-submit') as HTMLElement;

async function submit(el: Wc) {
  const form = field(el, 'appointments-series-create-form') as HTMLFormElement;
  expect(form, 'the new-series form').toBeTruthy();
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(el);
}

/** Bea every two weeks on Friday at 17:30, six times, from 1 Oct 2099. */
async function fillBea(el: Wc) {
  await choose(el, 'appointments-series-create-customer', 'c2');
  await choose(el, 'appointments-series-create-service', 'sv2');
  await choose(el, 'appointments-series-create-staff', 's1');
  await choose(el, 'appointments-series-create-frequency', 'biweekly');
  await choose(el, 'appointments-series-create-day', '4');
  await type(el, 'appointments-series-create-start', '2099-10-01');
  await type(el, 'appointments-series-create-start-time', '17:30');
  await type(el, 'appointments-series-create-occurrences', '6');
}

describe('the «Repeating» view can create a series (appointments#209)', () => {
  it('the series table shows its own «Add» button', async () => {
    const el = await mount();
    await table(el).updateComplete;
    expect(table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-add"]')).toBeTruthy();
  });

  it('the «Add» button and the rest of the table toolbar speak the active language, not English', async () => {
    const el = await mount();
    await table(el).updateComplete;
    const add = table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-add"]');
    expect(add?.textContent?.trim()).toBe(dataTableLabels('es').add);
    expect(table(el).labels, 'only newRecord is overridden').toEqual({ ...dataTableLabels('es'), newRecord: ES.seriesNewTitle });
  });

  it('tapping «Add» opens the NEW-series form under a «new» header, not «Edit»', async () => {
    const el = await mount();
    await tapAdd(el);
    expect(table(el).panel).toBe('create');
    const form = field(el, 'appointments-series-create-form');
    expect(form?.getAttribute('data-mode')).toBe('series-create');
    expect(field(el, 'appointments-series-form'), 'no edit form while creating').toBeNull();
    expect(table(el).labels.newRecord).toBe(ES.seriesNewTitle);
  });

  it('customer, service and professional are picked from their modules; only bookable ones are offered', async () => {
    const el = await mount();
    await tapAdd(el);
    const opts = (testid: string) =>
      [...(field(el, testid)?.querySelectorAll('ion-select-option') ?? [])].map((o) => (o as HTMLElement & { value?: unknown }).value);
    expect(opts('appointments-series-create-customer')).toEqual(['c1', 'c2']);
    expect(opts('appointments-series-create-service')).toEqual(['sv1', 'sv2']);
    expect(opts('appointments-series-create-staff')).toEqual(['s1']);
  });

  it('the start is the same Day + Time pair as a new appointment (appointments#204), no datetime-local', async () => {
    const el = await mount();
    await tapAdd(el);
    const form = field(el, 'appointments-series-create-form')!;
    expect(form.querySelector('ion-input[type="datetime-local"]')).toBeNull();
    // appointments#217: text fields painted in the hub language — a native `date`/`time` input
    // paints the browser's locale, which was the defect (series-hub-locale.test.ts).
    expect(field(el, 'appointments-series-create-start')?.getAttribute('type')).toBe('text');
    expect(field(el, 'appointments-series-create-start')?.getAttribute('data-role')).toBe('series-start-date');
    expect(field(el, 'appointments-series-create-start-time')?.getAttribute('type')).toBe('text');
  });

  it('a start pasted as one string fills Day and Time', async () => {
    const el = await mount();
    await tapAdd(el);
    const day = field(el, 'appointments-series-create-start')!;
    const paste = new Event('paste', { bubbles: true, composed: true, cancelable: true }) as Event & {
      clipboardData: { getData: () => string };
    };
    paste.clipboardData = { getData: () => '01/10/2099 17:30' };
    day.dispatchEvent(paste);
    await el.updateComplete;
    // appointments#217: the field shows the day in the hub's order (es), not the ISO it stores.
    expect(field(el, 'appointments-series-create-start')?.value).toBe('01/10/2099');
    expect(field(el, 'appointments-series-create-start-time')?.value).toBe('17:30');
  });

  it('«Create» stays off until customer, service, professional, day and time are there; the minutes come from the service', async () => {
    const el = await mount();
    await tapAdd(el);
    expect(submitButton(el).hasAttribute('disabled')).toBe(true);
    await choose(el, 'appointments-series-create-customer', 'c2');
    await choose(el, 'appointments-series-create-service', 'sv2');
    expect(field(el, 'appointments-series-create-duration')?.value).toBe('90');
    await choose(el, 'appointments-series-create-staff', 's1');
    await type(el, 'appointments-series-create-start', '2099-10-01');
    expect(submitButton(el).hasAttribute('disabled'), 'a day without a time is not a start').toBe(true);
    await type(el, 'appointments-series-create-start-time', '17:30');
    expect(submitButton(el).hasAttribute('disabled')).toBe(false);
  });

  it('«Create» sends recurring.create with the links, their names and the rule, books its appointments, and the series appears in the list', async () => {
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    await submit(el);

    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(create?.payload).toEqual({
      customer_id: 'c2',
      customer_name: 'Bea Ruiz',
      service_id: 'sv2',
      service_name: 'Tinte',
      staff_id: 's1',
      staff_name: 'Eva Pro',
      frequency: 'biweekly',
      day_of_week: 4,
      time: '17:30',
      duration_minutes: 90,
      start_date: '2099-10-01',
      end_date: null,
      max_occurrences: 6,
    });
    // A new repeating appointment lands on the agenda: its window is booked right away, with the
    // id the runtime minted and the three links as selector (appointments#54).
    const materialize = commands.find((c) => c.name === 'appointments.recurring.materialize');
    expect(materialize?.payload).toEqual({ recurring_id: 'r-new', customer_id: 'c2', service_id: 'sv2', staff_id: 's1' });
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.create', 'appointments.recurring.materialize']);

    expect(el.series.map((s) => s.id)).toEqual(['r1', 'r-new']);
    await table(el).updateComplete;
    expect(table(el).shadowRoot?.querySelector('[data-testid="appointments-series-table-row-r-new-edit"]')).toBeTruthy();
    expect(table(el).panel, 'the panel closes once created').toBe('none');
  });

  it('appointments#239 — the time typed on a keypad without «:» («1730») creates the series at 17:30', async () => {
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    expect(field(el, 'appointments-series-create-start-time')?.getAttribute('inputmode')).toBe('numeric');
    await type(el, 'appointments-series-create-start-time', '1730');
    expect(submitButton(el).hasAttribute('disabled'), '«1730» is a whole time').toBe(false);
    await submit(el);
    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect((create?.payload as { time?: string } | undefined)?.time).toBe('17:30');
  });

  it('after creating, the next «Add» starts from a clean form', async () => {
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    await submit(el);
    await tapAdd(el);
    expect(field(el, 'appointments-series-create-customer')?.value).toBe('');
    expect(field(el, 'appointments-series-create-start')?.value).toBe('');
    expect(field(el, 'appointments-series-create-start-time')?.value).toBe('');
    expect(submitButton(el).hasAttribute('disabled')).toBe(true);
  });

  it('the weekday only travels for weekly patterns: a monthly series sends day_of_week null and offers no weekday', async () => {
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    await choose(el, 'appointments-series-create-frequency', 'monthly');
    expect(field(el, 'appointments-series-create-day')).toBeNull();
    await submit(el);
    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(create?.payload.frequency).toBe('monthly');
    expect(create?.payload.day_of_week).toBeNull();
  });

  it('a weekly series with «Any day» sends day_of_week null, not Sunday', async () => {
    // rv-appointments-213: `Number('')` is 0, so without the empty-weekday guard a weekly series
    // left on «Any day» would be pinned to weekday 0 — the receptionist asked for no fixed day.
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    await choose(el, 'appointments-series-create-frequency', 'weekly');
    await choose(el, 'appointments-series-create-day', '');
    await submit(el);
    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(create?.payload.frequency).toBe('weekly');
    expect(create?.payload.day_of_week).toBeNull();
  });

  it('it can end on a date instead of after N times, or never', async () => {
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    await type(el, 'appointments-series-create-occurrences', '');
    await type(el, 'appointments-series-create-end', '2100-03-31');
    await submit(el);
    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(create?.payload.end_date).toBe('2100-03-31');
    expect(create?.payload.max_occurrences).toBeNull();
  });

  it('appointments#240 — Day and Until typed as digits on a keypad without «/» create the series on those days', async () => {
    const el = await mount();
    await tapAdd(el);
    await fillBea(el);
    await type(el, 'appointments-series-create-start', '01102099');
    await type(el, 'appointments-series-create-occurrences', '');
    await type(el, 'appointments-series-create-end', '31032100');
    await submit(el);
    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(create?.payload.start_date).toBe('2099-10-01');
    expect(create?.payload.end_date).toBe('2100-03-31');
  });

  it('if creating fails it SAYS so next to the button and keeps what was typed', async () => {
    const el = await mount();
    failing = 'appointments.recurring.create';
    await tapAdd(el);
    await fillBea(el);
    await submit(el);
    expect(field(el, 'appointments-series-create-error')?.textContent?.trim()).toBe('boom');
    expect(table(el).panel).toBe('create');
    expect(field(el, 'appointments-series-create-customer')?.value).toBe('c2');
    expect(commands.some((c) => c.name === 'appointments.recurring.materialize')).toBe(false);
  });

  it('if the series is created but its appointments cannot be booked, it says so and the series is still listed', async () => {
    const el = await mount();
    failing = 'appointments.recurring.materialize';
    await tapAdd(el);
    await fillBea(el);
    await submit(el);
    expect(el.series.map((s) => s.id)).toEqual(['r1', 'r-new']);
    expect(el.error).toBe(ES.seriesCreatedNotBooked);
  });
});

describe('«Add» and an edit in progress (appointments#209, pm#459)', () => {
  it('«Add» after an edit was opened paints the NEW-series form, not the series being edited', async () => {
    const el = await mount();
    await tapEdit(el, 'r1');
    await settle(el);
    expect(el.editingId).toBe('r1');
    await tapAdd(el);
    expect(el.editingId).toBe('');
    expect(field(el, 'appointments-series-form'), 'the edit form is gone').toBeNull();
    expect(table(el).panel, '«Add» leaves the panel open on the new form').toBe('create');
    expect(field(el, 'appointments-series-create-form')).toBeTruthy();
    expect(table(el).labels.newRecord).toBe(ES.seriesNewTitle);
    await fillBea(el);
    await submit(el);
    expect(commands.some((c) => c.name === 'appointments.recurring.update'), 'creating never rewrites the edited series').toBe(false);
    expect(commands.some((c) => c.name === 'appointments.recurring.create')).toBe(true);
  });

  it('«Add» tapped while an edit is still loading: the late reply does not turn the new form into that edit', async () => {
    const el = await mount();
    let release: () => void = () => {};
    heldGet = new Promise<void>((r) => (release = r));
    await tapEdit(el, 'r1');
    await new Promise((r) => setTimeout(r, 0));
    await tapAdd(el);
    release();
    await settle(el);
    expect(el.editingId).toBe('');
    expect(field(el, 'appointments-series-form')).toBeNull();
    expect(field(el, 'appointments-series-create-form')).toBeTruthy();
    expect(table(el).panel).toBe('create');
  });

  it('«Add» with no edit in progress keeps the draft being typed', async () => {
    const el = await mount();
    await tapAdd(el);
    await choose(el, 'appointments-series-create-customer', 'c2');
    await tapAdd(el); // closes the panel (ok-data-table toggles it)
    await tapAdd(el); // and opens it again
    expect(field(el, 'appointments-series-create-customer')?.value).toBe('c2');
  });

  it('a tap INSIDE the edit form does not discard the edit', async () => {
    const el = await mount();
    await tapEdit(el, 'r1');
    await settle(el);
    field(el, 'appointments-series-frequency')?.click();
    await settle(el);
    expect(el.editingId).toBe('r1');
    expect(field(el, 'appointments-series-form')).toBeTruthy();
  });

  it('editing still titles the panel «Edit repeating appointment»', async () => {
    const el = await mount();
    await tapEdit(el, 'r1');
    await settle(el);
    expect(table(el).labels.newRecord).toBe(ES.seriesEditTitle);
  });
});

describe('the series forms fit the side panel on a wide screen (appointments#209)', () => {
  // At 1280 px the ok-data-table panel is ~360 px wide: a two-column grid switched on by the
  // VIEWPORT width cut Service, Repeat and Day in half. The columns must follow the width of the
  // form itself (the panel), so the rule is a container query on the form, never a viewport one.
  const styles = async () => {
    const el = await mount();
    const ctor = el.constructor as unknown as { elementStyles: { cssText: string }[] };
    return ctor.elementStyles.map((s) => s.cssText).join('\n');
  };

  it('the two-column grid is not switched on by the viewport width', async () => {
    expect(await styles()).not.toMatch(/@media[^{]*\{\s*\.grid/);
  });

  it('the form is the container whose width decides the columns', async () => {
    const css = await styles();
    expect(css).toMatch(/\.form\s*\{[^}]*container-type:\s*inline-size/);
    expect(css).toMatch(/@container[^{]*\{\s*\.grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
  });
});

describe('every new visible string of appointments#209 exists in en AND es', () => {
  it.each(['seriesNewTitle', 'seriesCreate', 'fieldEndDate', 'fieldOccurrences', 'seriesCreated', 'seriesCreatedNotBooked'])(
    '%s',
    (key) => {
      expect(EN[key], `en ${key}`).toBeTruthy();
      expect(ES[key], `es ${key}`).toBeTruthy();
    },
  );
});
