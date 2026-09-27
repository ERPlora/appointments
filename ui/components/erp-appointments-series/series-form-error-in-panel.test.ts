// pm#513 (out of pm#478) — on a phone, a refused change to a REPEATING APPOINTMENT showed NOTHING:
// the receptionist pressed «Save from this appointment on» and the sheet stayed exactly as it was.
//
// The refusal did arrive; it was painted in the wrong place. The edit form lives in the `create`
// panel of the series `ok-data-table`, and under 834 px that panel is a FULL-SCREEN sheet
// (`position: fixed; inset: 0; z-index: 1000`, outfitkit#75). The refusal went to `error`, a banner
// of the PAGE, so on a phone it sat under the sheet, out of sight (bench: hub:stable, 390 px, ios —
// the banner measured inside the viewport but `elementFromPoint` hit the sheet). The NEW-series form
// already painted its refusal inside the form (`createError`); the edit form did not.
//
// The rule, the same one Customers (customers#97), Services (services#115) and Inventory
// (inventory#118) follow:
//
//   · what goes wrong while SAVING a panel form is painted INSIDE that form, next to the button that
//     was pressed, and scrolled into view once it has painted — it travels with the panel;
//   · what goes wrong in a ROW action (book the window, delete, pause) stays on the PAGE: no panel is
//     open then, and a message inside a closed panel is just as invisible;
//   · a later save that works clears the page refusal too: it is the next thing the person did.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
// The real catalog: assertions compare against the KEY the screen paints, never prose (ADR-0055).
import esLocale from '../../../locales/es.json';

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

const OCCURRENCES = [
  { id: 'a3', occurrence_date: '2099-01-05', status: 'confirmed', converted_sale_id: null },
  { id: 'a4', occurrence_date: '2099-01-12', status: 'pending', converted_sale_id: null },
];

const CUSTOMER = { id: 'c1', name: 'Ana López', phone: '', email: '' };
const SERVICE = { id: 'sv1', name: 'Corte', price: 1200, duration_minutes: 30 };
const STAFF = { id: 's1', full_name: 'Eva Pro', is_bookable: 1, status: 'active' };

/** Command name → what it throws. An Error without message exercises the catalog fallback. */
let refusals: Record<string, Error> = {};
/** Every element scrolled into view AFTER it had painted itself, in order. Scrolling a banner that
 *  has not rendered yet measures a 0-px box and the sheet stops with it under the tab bar. */
let revealed: Element[] = [];

beforeEach(() => {
  refusals = {};
  revealed = [];
  vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
    if ((this as HTMLElement & { hasUpdated?: boolean }).hasUpdated !== false) revealed.push(this);
  });
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
          return [CUSTOMER];
        case 'services.services.list':
          return [SERVICE];
        case 'staff.members.list':
          return [STAFF];
        default:
          return [];
      }
    },
    command: async (name: string) => {
      if (refusals[name]) throw refusals[name];
      return name === 'appointments.recurring.update'
        ? { recurring_id: 'r1', pattern_changed: false, moved: 0 }
        : { ok: true, new_ids: ['r9'] };
    },
    on: () => () => {},
    t: (cat: Record<string, { ui?: Record<string, string> }>, key: string) => cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key,
    locale: 'es',
    notify: () => {},
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Wc = HTMLElement & {
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
  error: string;
  editingId: string;
  editDuration: string;
  newCustomerId: string;
  newServiceId: string;
  newStaffId: string;
  newStartDate: string;
  newStartTime: string;
  newDuration: string;
  openSeries: (row: Record<string, unknown>) => Promise<void>;
  submitEdit: (e: Event) => Promise<void>;
  createSeries: (e: Event) => Promise<void>;
  materializeSeries: (row: Record<string, unknown>) => Promise<void>;
  deleteSeries: (row: Record<string, unknown>) => Promise<void>;
};

async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
};

const submitEvent = (): Event => new Event('submit', { cancelable: true });

/** The banner INSIDE the panel form of that mode, or null. */
const inForm = (el: Wc, mode: string, testid: string): Element | null =>
  el.shadowRoot.querySelector(`form[slot="create"][data-mode="${mode}"] [data-testid="${testid}"]`);

/** …and scrolled into view once painted. */
const inFormAndRevealed = (el: Wc, mode: string, testid: string): Element | null => {
  const banner = inForm(el, mode, testid);
  return banner && revealed.includes(banner) ? banner : null;
};

/** The page banner (outside the panel), or null. */
const onPage = (el: Wc): Element | null => {
  const banner = el.shadowRoot.querySelector('[data-testid="appointments-series-error"]');
  return banner && !banner.closest('form[slot="create"]') ? banner : null;
};

/** Opens r1 for editing and changes its duration, so the save really sends an update. */
async function editAndSave(el: Wc): Promise<void> {
  await el.openSeries(SERIES_ROW);
  el.editDuration = '45';
  await settle(el);
  await el.submitEdit(submitEvent());
  await settle(el);
}

describe('a refused change to a series is seen inside the edit panel (pm#513)', () => {
  it('paints the refusal inside the edit form, scrolled into view, and not on the page under the sheet', async () => {
    refusals['appointments.recurring.update'] = new Error('appointments.series_refused');
    const el = await mount();
    await editAndSave(el);

    const banner = inFormAndRevealed(el, 'series-edit', 'appointments-series-form-error');
    expect(banner, 'the refusal travels with the sheet the person is looking at').not.toBeNull();
    expect(banner?.textContent).toContain('appointments.series_refused');
    expect(onPage(el), 'no copy on the page, hidden under the full-screen sheet').toBeNull();
    expect(el.editingId, 'the panel stays open so the change can be fixed and saved again').toBe('r1');
  });

  it('falls back to the catalog text when the refusal carries no message', async () => {
    refusals['appointments.recurring.update'] = new Error('');
    const el = await mount();
    await editAndSave(el);

    expect(inForm(el, 'series-edit', 'appointments-series-form-error')?.textContent).toContain(esLocale.ui.seriesSaveError);
  });

  it('a retry that works clears the refusal of the edit form', async () => {
    refusals['appointments.recurring.update'] = new Error('appointments.series_refused');
    const el = await mount();
    await editAndSave(el);
    expect(inForm(el, 'series-edit', 'appointments-series-form-error')).not.toBeNull();

    delete refusals['appointments.recurring.update'];
    await el.openSeries(SERIES_ROW);
    await settle(el);
    expect(inForm(el, 'series-edit', 'appointments-series-form-error'), 'reopening a series starts clean').toBeNull();

    refusals['appointments.recurring.update'] = new Error('appointments.series_refused');
    el.editDuration = '50';
    await el.submitEdit(submitEvent());
    await settle(el);
    expect(inForm(el, 'series-edit', 'appointments-series-form-error')).not.toBeNull();
    delete refusals['appointments.recurring.update'];
    el.editDuration = '55';
    await el.submitEdit(submitEvent());
    await settle(el);
    expect(el.editingId, 'the successful save closes the panel').toBe('');
    await el.openSeries(SERIES_ROW);
    await settle(el);
    expect(inForm(el, 'series-edit', 'appointments-series-form-error'), 'no stale refusal on the next opening').toBeNull();
  });

  it('pressing Save again takes the old refusal away while the retry is in flight', async () => {
    refusals['appointments.recurring.update'] = new Error('appointments.series_refused');
    const el = await mount();
    await editAndSave(el);
    expect(inForm(el, 'series-edit', 'appointments-series-form-error')).not.toBeNull();

    delete refusals['appointments.recurring.update'];
    let release: () => void = () => {};
    const api = (globalThis as { erplora: { command: (n: string) => Promise<unknown> } }).erplora;
    const answer = api.command;
    api.command = (name: string) => new Promise((r) => { release = () => r(answer(name)); });
    el.editDuration = '50';
    const retry = el.submitEdit(submitEvent());
    await settle(el);
    expect(inForm(el, 'series-edit', 'appointments-series-form-error'), 'a stale refusal next to a save in flight reads as the answer').toBeNull();
    release();
    await retry;
  });

  it('a save that works also clears the page refusal of an earlier row action', async () => {
    refusals['appointments.recurring.materialize'] = new Error('appointments.materialize_refused');
    const el = await mount();
    await el.materializeSeries(SERIES_ROW);
    await settle(el);
    expect(onPage(el), 'a ROW action has no panel open: its refusal stays on the page').not.toBeNull();

    delete refusals['appointments.recurring.materialize'];
    await editAndSave(el);
    expect(onPage(el)).toBeNull();
  });

  it('pressing Save retires a stale page refusal even when the save itself is refused', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    // On a desktop the panel sits BESIDE the table: a row action can be refused while it is open.
    refusals['appointments.recurring.materialize'] = new Error('appointments.materialize_refused');
    await el.materializeSeries(SERIES_ROW);
    await settle(el);
    expect(onPage(el)).not.toBeNull();

    refusals['appointments.recurring.update'] = new Error('appointments.series_refused');
    el.editDuration = '45';
    await settle(el);
    await el.submitEdit(submitEvent());
    await settle(el);
    expect(onPage(el), 'two refusals on screen, one of them about something else, read as one').toBeNull();
    expect(inForm(el, 'series-edit', 'appointments-series-form-error')).not.toBeNull();
  });
});

describe('what goes wrong OUTSIDE a panel save stays on the page (pm#513)', () => {
  // With no panel open, a message inside the edit form is painted nowhere: these must keep `error`.
  it('a refused delete (a row action) is said on the page', async () => {
    refusals['appointments.recurring.delete'] = new Error('appointments.delete_refused');
    const el = await mount();
    await el.deleteSeries(SERIES_ROW);
    await settle(el);

    expect(onPage(el)?.textContent).toContain('appointments.delete_refused');
  });

  it('a series that no longer exists is said on the page: the panel never opened', async () => {
    const api = (globalThis as { erplora: { query: (n: string, p?: unknown) => Promise<unknown> } }).erplora;
    const answer = api.query;
    api.query = async (name: string, p?: unknown) => (name === 'appointments.recurring.get' ? [] : answer(name, p));
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    await settle(el);

    expect(el.editingId).toBe('');
    expect(onPage(el)?.textContent).toContain(esLocale.ui.seriesNotFound);
  });

  it('a series that fails to load is said on the page: the panel never opened', async () => {
    const api = (globalThis as { erplora: { query: (n: string, p?: unknown) => Promise<unknown> } }).erplora;
    const answer = api.query;
    api.query = async (name: string, p?: unknown) => {
      if (name === 'appointments.recurring.get') throw new Error('appointments.load_refused');
      return answer(name, p);
    };
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    await settle(el);

    expect(el.editingId).toBe('');
    expect(onPage(el)?.textContent).toContain('appointments.load_refused');
  });
});

describe('a refused NEW series is seen inside its form (pm#513)', () => {
  it('paints the refusal inside the create form and scrolls it into view', async () => {
    refusals['appointments.recurring.create'] = new Error('appointments.series_create_refused');
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newServiceId = 'sv1';
    el.newStaffId = 's1';
    el.newStartDate = '2099-01-05';
    el.newStartTime = '10:00';
    el.newDuration = '30';
    await settle(el);
    await el.createSeries(submitEvent());
    await settle(el);

    expect(inFormAndRevealed(el, 'series-create', 'appointments-series-create-error')).not.toBeNull();
    expect(onPage(el)).toBeNull();
  });
});
