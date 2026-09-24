// appointments#70 — a business refusal has a CODE, and the agenda paints it in the user's language.
//
// The overlap was the most frequent refusal of the module and the only one without a stable code:
// it came out of `create` as `Err("overlap: se solapa con la cita …")`, so every consumer had to
// sniff the prefix to name it, and what the receptionist read on screen was a Spanish sentence
// hard-coded in a Rust `format!` — untranslatable by construction, and different from the sentence
// the WhatsApp inbox showed for the very same refusal.
//
// Now it travels as `appointments.overlapping_appointment`, and the screen does what `customers`
// already does with its own codes (`erp-customers-list.ts::domainErrorText`): looks the code up in
// the module catalog and paints the translation, keeping the handler's sentence only as the
// fallback for a code the catalog has not learned yet.
//
// The catalog entries have existed since appointments#38 — nothing read them. This is the door
// that makes the whole `errors` block of `locales/{en,es}.json` alive instead of decorative.
import { beforeEach, describe, expect, it } from 'vitest';

import es from '../../../locales/es.json';

// appointments#12 — the clock of these fixtures is PINNED, it is not the machine's.
// Until now these tests built their instants with `new Date(y, m, d, h, mi)` and compared them
// against the component's output: green in Spain, red anywhere else, and green for the wrong
// reason (device == business by luck). The business zone is declared on the SDK stub below, the
// same way the shell publishes it in production, and the device is pinned to match it here so the
// assertions stay about WIRING. That the two can DISAGREE is proven in
// `erp-appointments-business-clock.test.ts`, with the device in Auckland.
process.env.TZ = 'Europe/Madrid';

/** The REAL Spanish catalog, so a reworded entry is measured and not a copy of it. */
const SPANISH: Record<string, string> = es.errors;

/** `erplora().t()` walks the key by dots and the `errors` block is FLAT, so it can only resolve
 *  the `ui.*` keys. It is mocked exactly like that — a component that reached for `t()` to
 *  translate a CODE would get the raw key back, and these tests would say so. */
function translate(catalog: Record<string, unknown>, key: string): string {
  const dict = (catalog.es ?? catalog.en ?? {}) as Record<string, unknown>;
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return typeof cur === 'string' ? cur : key;
}

/** What `.command()` throws on a domain refusal: an `Error` that also carries the hub's `code`
 *  (module-sdk `ErploraError`). The message is the handler's English fallback. */
class DomainRefusal extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const APPOINTMENT = {
  id: 'a1', appointment_number: 'APT-1', customer_id: 'c1', customer_name: 'Ana López',
  service_id: 'sv1', service_name: 'Haircut', service_price: 2000,
  staff_id: 's1', staff_name: 'Eva Pro', duration_minutes: 30, status: 'confirmed',
  start_datetime: new Date(2026, 7, 7, 10, 0).toISOString(),
  end_datetime: new Date(2026, 7, 7, 10, 30).toISOString(),
};

let rejection: unknown = null;

beforeEach(() => {
  rejection = null;
  (globalThis as Record<string, unknown>).erplora = {
    // The business timezone the runtime resolved (hub#1022) — what `erplora.timezone` carries.
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return [APPOINTMENT];
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '600111222', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 }], total: 1 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60 }];
        default:
          return [];
      }
    },
    queryAll: async () => [],
    command: async () => {
      if (rejection) throw rejection;
      return {};
    },
    on: () => () => {},
    locale: 'es',
    currency: 'EUR',
    formatMoney: (c: number) => `${((c || 0) / 100).toFixed(2)} €`,
    t: translate,
    notify: () => {},
  };
});

type Wc = HTMLElement & {
  // appointments#156: the move panel paints its refusal INSIDE the panel (`formError`).
  formError: string;
  rescheduleId: string;
  rescheduleStart: string;
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  submitReschedule: (ev: Event) => Promise<void>;
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  await (el as unknown as Wc).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as Wc).updateComplete;
  return el as Wc;
}

async function moveOnto(el: Wc, refusal: unknown) {
  await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: APPOINTMENT } }));
  el.rescheduleStart = '2026-08-07T16:45';
  rejection = refusal;
  await el.submitReschedule(new Event('submit'));
  await el.updateComplete;
}

describe('appointments#70 · the agenda translates the refusal CODE', () => {
  it('paints the Spanish sentence for a double booking, not the handler English', async () => {
    const el = await mount();
    await moveOnto(
      el,
      new DomainRefusal(
        'appointments.overlapping_appointment',
        'That professional already has an appointment in that slot: APT-9 (2026-08-07T16:45:00+00:00 – 2026-08-07T17:30:00+00:00).',
      ),
    );

    expect(el.formError).toBe(SPANISH['appointments.overlapping_appointment']);
    expect(el.formError).toContain('Ese profesional ya tiene una cita');
  });

  it('keeps the handler sentence for a code the catalog has not learned', async () => {
    const el = await mount();
    await moveOnto(el, new DomainRefusal('appointments.some_future_refusal', 'A brand new no.'));
    expect(el.formError, 'an untranslated code must never paint a raw i18n key').toBe('A brand new no.');
  });

  it('does not swallow a plain failure that carries no code', async () => {
    const el = await mount();
    await moveOnto(el, new Error('connection reset'));
    expect(el.formError).toBe('connection reset');
    expect(el.shadowRoot.querySelector('ok-inline-feedback'), 'the error is painted').toBeTruthy();
  });

  it('never translates another module code with this module catalog', async () => {
    const el = await mount();
    await moveOnto(el, new DomainRefusal('sales.till_closed', 'The till is closed.'));
    expect(el.formError).toBe('The till is closed.');
  });
});
