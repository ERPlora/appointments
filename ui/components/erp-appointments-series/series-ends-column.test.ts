// appointments#254 — the «Ends» column of the «Repeating» list says WHEN a series ends.
//
// A series created as «4 sessions» (a fixed number of appointments, no end date) showed «No end» in
// the list, so whoever read it understood it repeats forever. The column must say «After 4
// appointments» (with the right singular for one), the end date when there is one, both when the
// series has both (it stops at whichever comes first), and «No end» only when it has neither.
process.env.TZ = 'Europe/Madrid';

import { afterAll, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const BASE = {
  customer_name: 'Ana López',
  service_name: 'Corte',
  staff_name: 'Eva Pro',
  frequency: 'weekly',
  day_of_week: 0,
  time: '10:00',
  duration_minutes: 30,
  start_date: '2099-10-05',
  is_active: 1,
};

const ROWS = [
  { ...BASE, id: 'count4', end_date: null, max_occurrences: 4 },
  { ...BASE, id: 'count1', end_date: null, max_occurrences: 1 },
  { ...BASE, id: 'date', end_date: '2100-03-31', max_occurrences: null },
  { ...BASE, id: 'never', end_date: null, max_occurrences: null },
  { ...BASE, id: 'both', end_date: '2100-03-31', max_occurrences: 6 },
  // What a driver may hand over for an INTEGER column: a numeric string. It is still a count.
  { ...BASE, id: 'count-text', end_date: null, max_occurrences: '3' },
  // A zero budget is not a real limit (the form never stores it): it reads as no end.
  { ...BASE, id: 'count0', end_date: null, max_occurrences: 0 },
];

const CATALOGS: Record<string, unknown> = { es: esLocale, en: enLocale };

function lookup(catalog: unknown, key: string): string | undefined {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), catalog);
  return typeof value === 'string' ? value : undefined;
}

/** `{name}` placeholders filled from the params, the way the shell's `t` does. */
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

type Wc = HTMLElement & { updateComplete: Promise<unknown>; shadowRoot: ShadowRoot };

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

/** The text the row of series `id` paints, blanks normalized. */
function rowText(el: Wc, id: string): string {
  const table = el.shadowRoot.querySelector('ok-data-table') as Wc;
  const row = table.shadowRoot.querySelector(`[data-testid="appointments-series-table-row-${id}"]`);
  expect(row, `the row of series ${id} is painted`).toBeTruthy();
  return String(row!.textContent).replace(/\s+/g, ' ');
}

describe('appointments#254 — the «Ends» column of the series list', () => {
  it('in Spanish: «Tras N citas», the date, both, and «Sin fin» only with neither', async () => {
    install('es');
    const el = await mount();

    expect(rowText(el, 'count4')).toContain('Tras 4 citas');
    expect(rowText(el, 'count4')).not.toContain('Sin fin');
    // One appointment is singular: «Tras 1 cita», never «Tras 1 citas».
    expect(rowText(el, 'count1')).toContain('Tras 1 cita');
    expect(rowText(el, 'count1')).not.toContain('Tras 1 citas');
    expect(rowText(el, 'count-text')).toContain('Tras 3 citas');

    expect(rowText(el, 'date')).toContain('31/03/2100');
    expect(rowText(el, 'date')).not.toContain('Sin fin');
    expect(rowText(el, 'date')).not.toContain('Tras');

    // Both limits: the series stops at whichever comes first, so the list says both.
    expect(rowText(el, 'both')).toContain('31/03/2100');
    expect(rowText(el, 'both')).toContain('Tras 6 citas');
    expect(rowText(el, 'both')).not.toContain('Sin fin');

    expect(rowText(el, 'never')).toContain('Sin fin');
    expect(rowText(el, 'count0')).toContain('Sin fin');
    expect(rowText(el, 'count0')).not.toContain('Tras');
  });

  it('in English: «After N appointments» with the singular for one', async () => {
    install('en');
    const el = await mount();

    expect(rowText(el, 'count4')).toContain('After 4 appointments');
    expect(rowText(el, 'count4')).not.toContain('No end');
    expect(rowText(el, 'count1')).toContain('After 1 appointment');
    expect(rowText(el, 'count1')).not.toContain('After 1 appointments');
    expect(rowText(el, 'both')).toContain('After 6 appointments');
    expect(rowText(el, 'never')).toContain('No end');
  });

  it('both catalogues carry the singular and plural strings', () => {
    for (const catalog of [esLocale, enLocale]) {
      expect(lookup(catalog, 'ui.seriesEndsAfterOne'), 'singular').toBeTruthy();
      expect(lookup(catalog, 'ui.seriesEndsAfter'), 'plural').toContain('{n}');
    }
  });
});
