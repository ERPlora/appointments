// appointments#221 — every field of the series panels shows its BOX.
//
// The Hub shell pins `mode: 'ios'` (ADR-0143), and there Ionic never paints `fill` on
// ion-input/ion-select/ion-textarea: a control with no `fill` renders as loose text with no border.
// Editing a recurring series (frequency, weekday, time, minutes) was exactly that, while the «new
// series» panel next to it was boxed. The combination that paints on its own is
// `fill="outline" mode="md"` (hub#760, ERPlora/pm#152, taxes#75) — and the one the module-toolkit
// gate asks for (ERPlora/pm#479).
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it } from 'vitest';

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

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.recurring.list':
          return { rows: [SERIES_ROW], total: 1 };
        case 'appointments.recurring.get':
          return [{ ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's1', split_from_id: null }];
        case 'appointments.recurring.occurrences':
          return [{ id: 'a3', occurrence_date: '2099-01-05', status: 'confirmed', converted_sale_id: null }];
        default:
          return [];
      }
    },
    command: async () => ({ ok: true }),
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  openSeries: (row: Record<string, unknown>) => Promise<void>;
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

const fieldsOf = (el: Wc): Element[] => {
  const form = el.shadowRoot.querySelector('form[slot="create"]');
  expect(form, 'the panel form must be rendered').toBeTruthy();
  return [...form!.querySelectorAll('ion-input, ion-select, ion-textarea')];
};

function expectBox(f: Element): void {
  const id = f.getAttribute('data-testid') ?? f.tagName;
  expect(f.getAttribute('fill'), `${id}: no fill → no box in ios mode`).toBe('outline');
  expect(f.getAttribute('mode'), `${id}: fill without mode="md" never paints in ios mode`).toBe('md');
}

describe('series panels paint their field boxes in ios mode (appointments#221)', () => {
  it('edit panel: frequency, weekday, time and minutes', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('form[slot="create"]')?.getAttribute('data-mode')).toBe('series-edit');
    const fields = fieldsOf(el);
    const ids = fields.map((f) => f.getAttribute('data-testid'));
    // A weekly series shows the weekday picker: the sweep covers the conditional field too.
    for (const id of [
      'appointments-series-frequency',
      'appointments-series-day',
      'appointments-series-time',
      'appointments-series-duration',
    ]) {
      expect(ids, `${id} is in the edit form`).toContain(id);
    }
    for (const f of fields) expectBox(f);
  });

  it('new series panel: every field, including the weekday picker', async () => {
    const el = await mount();
    const fields = fieldsOf(el);
    expect(fields.length).toBeGreaterThanOrEqual(8);
    for (const f of fields) expectBox(f);
  });
});
