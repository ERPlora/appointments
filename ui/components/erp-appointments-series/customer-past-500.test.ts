// appointments#306 — a NEW repeating appointment reaches a customer who sorts after the 500th.
//
// Same regression as the agenda's create panel: «Nueva cita periódica» loaded `customers.list`
// once with `limit: 500` into an `ion-select`. This drives the real picker of the series form and
// checks the series is created for her.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it } from 'vitest';
import { customersListEngine, ZOE } from '../../test/fake-customers-engine';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const customerReads: Record<string, unknown>[] = [];

beforeEach(() => {
  commands.length = 0;
  customerReads.length = 0;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params: Record<string, unknown> = {}) => {
      switch (name) {
        case 'appointments.recurring.list':
          return { rows: [], total: 0 };
        case 'customers.list':
          customerReads.push(params);
          return customersListEngine(params);
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 }], total: 1 };
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (name === 'appointments.recurring.create') return { ok: true, new_ids: ['r-new'] };
      return { ok: true };
    },
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

const field = (el: Wc, testid: string) =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { value?: unknown }) | null;

async function emit(el: Wc, testid: string, event: 'ionChange' | 'ionInput', value: string) {
  const f = field(el, testid);
  expect(f, `${testid} must be rendered`).toBeTruthy();
  f!.value = value;
  f!.dispatchEvent(new CustomEvent(event, { detail: { value }, bubbles: true, composed: true }));
  await el.updateComplete;
}

describe('appointments#306 — a new series is booked for a customer past the first 500', () => {
  it('typing her name finds her and the series is created with her', async () => {
    const el = await mount();
    const picker = field(el, 'appointments-series-create-customer') as Wc | null;
    expect(picker, 'the customer field of the new-series form').toBeTruthy();
    expect(picker!.tagName.toLowerCase()).toBe('erp-appointments-customer-picker');
    await settle(picker!);

    const input = picker!.shadowRoot.querySelector('[data-testid="appointments-customer-picker-input"]') as HTMLElement & { value?: string };
    input.value = 'zamora';
    input.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'zamora' }, bubbles: true, composed: true }));
    await settle(picker!);
    const option = picker!.shadowRoot.querySelector(`[data-testid="appointments-customer-picker-option-${ZOE.id}"]`) as HTMLElement | null;
    expect(option, 'Zoe sorts after the 500th customer and must still be offered').toBeTruthy();
    option!.click();
    await settle(el);

    await emit(el, 'appointments-series-create-service', 'ionChange', 'sv1');
    await emit(el, 'appointments-series-create-staff', 'ionChange', 's1');
    await emit(el, 'appointments-series-create-start', 'ionInput', '2099-10-01');
    await emit(el, 'appointments-series-create-start-time', 'ionInput', '17:30');
    await emit(el, 'appointments-series-create-occurrences', 'ionInput', '3');
    (field(el, 'appointments-series-create-form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(el);

    const create = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(create, 'the series was created').toBeTruthy();
    expect(create!.payload).toMatchObject({ customer_id: ZOE.id, customer_name: ZOE.name });
    for (const p of customerReads) expect(Number(p.limit), 'no cut list of the whole book').toBeLessThanOrEqual(50);
  });
});
