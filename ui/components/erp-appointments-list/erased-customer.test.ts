// pm#637 — the agenda after a customer's personal data was erased (APPOINTMENTS-F24).
//
// The listener of `customer.anonymized` blanks the name copied into her appointments. Every place
// the agenda shows that name — the «Customer» column, the block on the per-professional timeline
// and the overlap question — must say «Cliente borrado» instead of an empty gap, in the user's
// language, and must not say it of a row that never had a sheet.
process.env.TZ = 'Europe/Madrid';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

vi.mock('@erplora/outfitkit/ok-timeline', () => ({}));

const at = (h: number) => new Date(2026, 8, 26, h, 0).toISOString();
const BASE = {
  service_id: 'sv1', service_name: 'Corte', service_price: 2000, staff_id: 's1', staff_name: 'Eva',
  duration_minutes: 30, status: 'confirmed',
};
const DAY = [
  { ...BASE, id: 'erased', appointment_number: 'APT-1', customer_id: 'c9', customer_name: '', start_datetime: at(10), end_datetime: at(11) },
  { ...BASE, id: 'kept', appointment_number: 'APT-2', customer_id: 'c1', customer_name: 'Ana López', start_datetime: at(12), end_datetime: at(13) },
  { ...BASE, id: 'nosheet', appointment_number: 'APT-3', customer_id: '', customer_name: '', start_datetime: at(14), end_datetime: at(15) },
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

let locale: 'es' | 'en' = 'es';
beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return DAY;
        case 'customers.list':
        case 'services.services.list':
        case 'staff.members.list':
          return { rows: [], total: 0 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 8, calendar_end_hour: 20 }];
        default:
          return [];
      }
    },
    command: async () => ({}),
    on: () => () => {},
    notify: () => {},
    get locale() {
      return locale;
    },
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      interpolate(lookup(CATALOGS[locale], key) ?? lookup(CATALOGS.en, key) ?? key, params),
  };
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  schedulerEvents: { id: string; title: string }[];
  overlapPrompt: string;
  askOverlap: (conflicts: unknown[]) => Promise<boolean>;
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
  const table = el.shadowRoot.querySelector('ok-data-table') as Wc;
  await table.updateComplete;
  return el;
}

function rowText(el: Wc, id: string): string {
  const table = el.shadowRoot.querySelector('ok-data-table') as Wc;
  const row = table.shadowRoot.querySelector(`[data-testid="appointments-list-table-row-${id}"]`);
  expect(row, `the row of appointment ${id} is painted`).toBeTruthy();
  return String(row!.textContent).replace(/\s+/g, ' ');
}

describe('pm#637 — the agenda names an erased customer', () => {
  it('the «Cliente» column says «Cliente borrado» for her, and nothing of the kind for the others', async () => {
    locale = 'es';
    const el = await mount();
    expect(rowText(el, 'erased')).toContain('Cliente borrado');
    expect(rowText(el, 'kept')).toContain('Ana López');
    expect(rowText(el, 'kept')).not.toContain('Cliente borrado');
    expect(rowText(el, 'nosheet')).not.toContain('Cliente borrado');
  });

  it('in English the column says «Deleted customer»', async () => {
    locale = 'en';
    const el = await mount();
    expect(rowText(el, 'erased')).toContain('Deleted customer');
  });

  it('her block on the per-professional timeline is titled «Cliente borrado · Corte»', async () => {
    locale = 'es';
    const el = await mount();
    const title = (id: string) => el.schedulerEvents.find((e) => e.id === id)?.title;
    expect(title('erased')).toBe('Cliente borrado · Corte');
    expect(title('kept')).toBe('Ana López · Corte');
    expect(title('nosheet')).toBe('Corte');
  });

  it('the overlap question names her as «Cliente borrado»', async () => {
    locale = 'es';
    const el = await mount();
    void el.askOverlap([DAY[0]]);
    expect(el.overlapPrompt).toContain('Cliente borrado');
  });

  it('both catalogues carry the label', () => {
    expect(lookup(esLocale, 'ui.erasedCustomer')).toBe('Cliente borrado');
    expect(lookup(enLocale, 'ui.erasedCustomer')).toBe('Deleted customer');
  });
});
