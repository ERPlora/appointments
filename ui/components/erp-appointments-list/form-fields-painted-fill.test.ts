// appointments#204 / ERPlora/pm#152 — the create and «Move» panels must show a BOX around every
// field. The Hub shell pins `mode: 'ios'` (ADR-0143) and there Ionic never paints `fill` on
// ion-input/ion-select/ion-textarea: a `fill="outline"` alone is a silent no-op and the Day, Time
// and Minutes fields render as loose text, with no border and no surface — the receptionist cannot
// see where to type. The one combination that paints is `fill="outline" mode="md"`, which is what
// the shell and the modules already swept by pm#152 use (same test as cash_register#98).
import { beforeEach, describe, expect, it } from 'vitest';

const APPOINTMENT = {
  id: 'a1',
  appointment_number: 'APT-1',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Haircut',
  staff_id: 's1',
  staff_name: 'Eva Pro',
  start_datetime: '2026-08-07T10:00:00+02:00',
  end_datetime: '2026-08-07T10:30:00+02:00',
  duration_minutes: 30,
  status: 'confirmed',
};

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => (name === 'appointments.appointments.list' ? [APPOINTMENT] : []),
    command: async () => ({}),
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  updateComplete: Promise<unknown>;
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

function fieldsOf(el: Wc): Element[] {
  const form = el.shadowRoot.querySelector('form[slot="create"]');
  expect(form, 'the panel form must be rendered').toBeTruthy();
  const own = [...form!.querySelectorAll('ion-input, ion-select, ion-textarea')];
  // appointments#306: the customer field is the search inside the picker's own shadow root.
  const inPickers = [...form!.querySelectorAll('erp-appointments-customer-picker')].flatMap((p) => [
    ...(p.shadowRoot?.querySelectorAll('ion-input, ion-select, ion-textarea') ?? []),
  ]);
  return [...inPickers, ...own];
}

/** A field is visible only when its `fill` is real: `outline` AND `mode="md"`, together. */
function expectPaintedFill(f: Element): void {
  const id = f.getAttribute('data-testid') ?? f.tagName;
  expect(f.getAttribute('fill'), `${id}: no fill → no box in ios mode`).toBe('outline');
  expect(f.getAttribute('mode'), `${id}: fill without mode="md" never paints in ios mode`).toBe('md');
}

describe('appointment panels paint their field boxes in ios mode (appointments#204, pm#152)', () => {
  it('create panel: customer, service, professional, day, time and minutes', async () => {
    const el = await mount();
    const fields = fieldsOf(el);
    expect(fields.length).toBeGreaterThanOrEqual(6);
    expect(fields[0].getAttribute('data-testid'), 'the customer search is one of the boxed fields').toBe(
      'appointments-customer-picker-input',
    );
    for (const f of fields) expectPaintedFill(f);
  });

  // appointments#221 — the list toolbar's day and status filter were the same loose text: the
  // receptionist could not tell the date was editable nor that «All» opens a list.
  it('toolbar: the day and the status filter', async () => {
    const el = await mount();
    const bar = el.shadowRoot.querySelector('.filters');
    expect(bar, 'the list toolbar must be rendered').toBeTruthy();
    const fields = [...bar!.querySelectorAll('ion-input, ion-select, ion-textarea')];
    expect(fields.map((f) => f.getAttribute('data-testid'))).toEqual([
      'appointments-list-day',
      'appointments-list-status-filter',
    ]);
    for (const f of fields) expectPaintedFill(f);
  });

  it('no control anywhere in the list view is left without its box', async () => {
    const el = await mount();
    const loose = [...el.shadowRoot.querySelectorAll('ion-input, ion-select, ion-textarea')].filter(
      (f) => !f.closest('ion-item') && (f.getAttribute('fill') !== 'outline' || f.getAttribute('mode') !== 'md'),
    );
    expect(loose.map((f) => f.getAttribute('data-testid') ?? f.tagName)).toEqual([]);
  });

  it('«Move» panel: day, time and minutes', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
    await el.updateComplete;
    const fields = fieldsOf(el);
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const f of fields) expectPaintedFill(f);
  });
});
