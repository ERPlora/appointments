// pm#637 — the «Repeating» list after a customer's personal data was erased (APPOINTMENTS-F24).
//
// The listener of `customer.anonymized` blanks the name copied into her series. The «Customer»
// column, the mobile card title, the delete question and the context line of the edit panel must
// say «Cliente borrado», not an empty gap or «¿Borrar la serie de citas de ?».
process.env.TZ = 'Europe/Madrid';

import { afterAll, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const BASE = {
  service_id: 'sv1', service_name: 'Corte', staff_id: 's1', staff_name: 'Eva Pro', frequency: 'weekly',
  day_of_week: 0, time: '10:00', duration_minutes: 30, start_date: '2099-10-05', end_date: null,
  max_occurrences: null, is_active: 1,
};
const ROWS = [
  { ...BASE, id: 'erased', customer_id: 'c9', customer_name: '' },
  { ...BASE, id: 'kept', customer_id: 'c1', customer_name: 'Ana López' },
];

const CATALOGS: Record<string, unknown> = { es: esLocale, en: enLocale };
function lookup(catalog: unknown, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
  return typeof value === 'string' ? value : undefined;
}
function interpolate(text: string, params?: Record<string, unknown>): string {
  return params ? text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole)) : text;
}

function install(locale: 'es' | 'en') {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => (name === 'appointments.recurring.list' ? { rows: ROWS, total: ROWS.length } : []),
    command: async () => ({ ok: true }),
    on: () => () => {},
    notify: () => {},
    locale,
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      interpolate(lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key) ?? key, params),
  };
}
afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Wc = HTMLElement & {
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
  cardTitle: (row: Record<string, unknown>) => string;
  confirmDeleteSeries: (row: Record<string, unknown>) => Promise<void>;
  renderEditForm: (t: (k: string) => string) => unknown;
  template: unknown;
};

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Wc;
  document.body.appendChild(el);
  await settle(el);
  const table = el.shadowRoot.querySelector('ok-data-table') as Wc;
  await table.updateComplete;
  return el;
}

const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Wc;
function rowText(el: Wc, id: string): string {
  const row = table(el).shadowRoot.querySelector(`[data-testid="appointments-series-table-row-${id}"]`);
  expect(row, `the row of series ${id} is painted`).toBeTruthy();
  return String(row!.textContent).replace(/\s+/g, ' ');
}

describe('pm#637 — the series list names an erased customer', () => {
  it('the «Cliente» column says «Cliente borrado» for her only', async () => {
    install('es');
    const el = await mount();
    expect(rowText(el, 'erased')).toContain('Cliente borrado');
    expect(rowText(el, 'kept')).toContain('Ana López');
    expect(rowText(el, 'kept')).not.toContain('Cliente borrado');
  });

  it('the card title on a phone says «Cliente borrado»', async () => {
    install('es');
    const el = await mount();
    expect(table(el).cardTitle(ROWS[0])).toBe('Cliente borrado');
    expect(table(el).cardTitle(ROWS[1])).toBe('Ana López');
  });

  it('the delete question asks about «Cliente borrado», not about nobody', async () => {
    install('es');
    const el = await mount();
    await el.confirmDeleteSeries(ROWS[0]);
    const alert = document.querySelector('ion-alert') as HTMLElement & { header: string };
    expect(alert.header).toBe('¿Borrar la serie de citas de Cliente borrado?');
  });

  it('in English the column says «Deleted customer»', async () => {
    install('en');
    const el = await mount();
    expect(rowText(el, 'erased')).toContain('Deleted customer');
  });

  it('the context line of the edit panel says «Cliente borrado»', async () => {
    install('es');
    const el = await mount();
    el.template = ROWS[0];
    await el.updateComplete;
    const host = document.createElement('div');
    const { render } = await import('lit');
    render(el.renderEditForm((k: string) => lookup(esLocale, k) ?? k) as never, host);
    const ctx = host.querySelector('[data-role="series-context"]');
    expect(String(ctx?.textContent).replace(/\s+/g, ' ')).toContain('Cliente borrado · Corte');
  });
});
