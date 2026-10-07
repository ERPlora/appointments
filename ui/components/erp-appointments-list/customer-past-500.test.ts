// appointments#306 — booking from the agenda reaches a customer who sorts after the 500th.
//
// Regression: the create panel loaded `customers.list` once with `limit: 500` and offered it in an
// `ion-select`, so with 802 customers «Zoe Zamora» was unreachable and typing searched nothing.
// This drives the REAL field (typing into the picker, tapping her result) and books: the command
// must carry her id and her contact snapshot. The fake list engine honours `search` and `limit`
// exactly like the hub's, so a cut list cannot pass.
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
        case 'customers.list':
          customerReads.push(params);
          return customersListEngine(params);
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 }], total: 1 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 30 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return { ok: true };
    },
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  newServiceId: string;
  newStaffId: string;
  newStart: string;
  createAppointment: (ev: Event) => Promise<void>;
  updateComplete: Promise<unknown>;
};

type Picker = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

const settle = async (el: HTMLElement & { updateComplete: Promise<unknown> }) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

describe('appointments#306 — the agenda books a customer past the first 500', () => {
  it('typing her name finds her and the appointment is booked with her', async () => {
    const el = await mount();
    const picker = el.shadowRoot.querySelector('[data-testid="appointments-list-customer"]') as Picker | null;
    expect(picker, 'the customer field of the create panel').toBeTruthy();
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

    el.newServiceId = 'sv1';
    el.newStaffId = 's1';
    el.newStart = '2099-07-13T10:00';
    await el.createAppointment(new Event('submit'));

    const create = commands.find((c) => c.name === 'appointments.appointments.create');
    expect(create, 'the booking was sent').toBeTruthy();
    expect(create!.payload).toMatchObject({
      customer_id: ZOE.id,
      customer_name: ZOE.name,
      customer_phone: ZOE.phone,
      customer_email: ZOE.email,
    });
    for (const p of customerReads) expect(Number(p.limit), 'no cut list of the whole book').toBeLessThanOrEqual(50);
  });
});
