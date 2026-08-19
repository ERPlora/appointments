// appointments#46 — the visit history on the CUSTOMER SHEET (slot `customers.detail`, ADR-0043).
//
// «The stylist needs the last formula and the allergy note at the chair, in two taps.» The formula
// is a note OF THE VISIT (Phorest's split: client notes = stable, appointment notes = per visit),
// so it lives in `appointments_appointment.notes` / `internal_notes` and the sheet reads it through
// this module's PUBLIC query. `customers` never learns what an appointment is: the host resolves
// this filler by slot name, mounts it, and tells it WHICH customer is open with a `CustomEvent`
// (`erp:customer-detail`) on the element itself — never props, never calls (host contract pinned
// in customers' `erp-customers-list.test.ts`).
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The visual timeline is OutfitKit's `ok-timeline` (reused, not reinvented); its rendering is
// tested in its own repo. Here we pin what THIS filler hands it (`.items`), so the component is
// mocked away (its icon chain does not load under vitest).
vi.mock('@erplora/outfitkit/ok-timeline', () => ({}));

const VISITS = [
  { id: 'v-new', appointment_number: 'APT-20260810-0001', start_datetime: '2026-08-10T10:00:00',
    end_datetime: '2026-08-10T11:00:00', duration_minutes: 60, status: 'completed',
    service_id: 's-colour', service_name: 'Colour', service_price: 4500,
    staff_id: 'st-bea', staff_name: 'Bea', notes: 'Wants it shorter next time',
    internal_notes: 'Formula 6.3 + 20 vol', converted_sale_id: 'sale-1' },
  { id: 'v-old', appointment_number: 'APT-20260601-0002', start_datetime: '2026-06-01T10:00:00',
    end_datetime: '2026-06-01T11:00:00', duration_minutes: 60, status: 'no_show',
    service_id: 's-colour', service_name: 'Colour', service_price: 4500,
    staff_id: 'st-bea', staff_name: 'Bea', notes: '', internal_notes: '', converted_sale_id: null },
];

const consultas: { name: string; params?: Record<string, unknown> }[] = [];
let respuesta: () => Promise<unknown> = async () => VISITS;

beforeEach(() => {
  consultas.length = 0;
  respuesta = async () => VISITS;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params?: Record<string, unknown>) => {
      consultas.push({ name, params });
      return respuesta();
    },
    locale: 'es',
    currency: 'EUR',
    formatMoney: (c: number) => `${((c || 0) / 100).toFixed(2)} €`,
    t: (_catalog: unknown, key: string) => key,
  };
});

type Filler = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function settle(el: Filler) {
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}

async function mount(): Promise<Filler> {
  await import('./erp-appointments-customer-history');
  const el = document.createElement('erp-appointments-customer-history') as Filler;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

/** What the `customers.detail` host does: tells the filler which customer is open. */
async function open(el: Filler, customer_id: string, customer_name = 'Ada') {
  el.dispatchEvent(new CustomEvent('erp:customer-detail', { detail: { customer_id, customer_name }, bubbles: false }));
  await settle(el);
}

const text = (el: Filler) => el.shadowRoot.textContent ?? '';

interface TimelineItem { id: string; title: string; description?: string; time?: string; status?: string }
/** The items this filler hands to `ok-timeline` (its `.items` prop). */
function items(el: Filler): TimelineItem[] {
  const tl = el.shadowRoot.querySelector('ok-timeline') as (HTMLElement & { items?: TimelineItem[] }) | null;
  return tl?.items ?? [];
}

describe('erp-appointments-customer-history (filler of customers.detail)', () => {
  it('does nothing until the host tells it which customer is open', async () => {
    await mount();
    expect(consultas, 'no customer, no query').toEqual([]);
  });

  it('asks THIS module public query for the last visits of that customer, newest first', async () => {
    const el = await mount();
    await open(el, 'cus-ada');
    const q = consultas.find((c) => c.name === 'appointments.appointments.list_for_customer');
    expect(q, 'reads through appointments.appointments.list_for_customer').toBeTruthy();
    expect(q!.params).toMatchObject({ customer_id: 'cus-ada' });
    expect(Number(q!.params!.limit), 'asks for the last N, not the whole life').toBeGreaterThan(0);
  });

  it('hands ok-timeline one item per visit: service, professional, status and the notes (the formula)', async () => {
    const el = await mount();
    await open(el, 'cus-ada');
    const list = items(el);
    expect(list.map((i) => i.id), 'newest first, as the query returns them').toEqual(['v-new', 'v-old']);
    const [newest, oldest] = list;
    expect(newest.title).toContain('Colour');
    expect(newest.title).toContain('Bea');
    expect(newest.description, 'the internal note (formula) is what the stylist needs at the chair').toContain('Formula 6.3 + 20 vol');
    expect(newest.description, 'the visit note').toContain('Wants it shorter next time');
    // Status through the module i18n keys (the sdk `t` echoes the key here).
    expect(newest.title + (newest.time ?? '')).toContain('ui.statusCompleted');
    expect(oldest.title + (oldest.time ?? '')).toContain('ui.statusNoShow');
    // A no-show/cancelled visit is not a "done" one on the timeline.
    expect(newest.status).toBe('done');
    expect(oldest.status).not.toBe('done');
  });

  it('re-queries when the host opens another customer', async () => {
    const el = await mount();
    await open(el, 'cus-ada');
    await open(el, 'cus-bob');
    const ids = consultas.map((c) => c.params?.customer_id);
    expect(ids).toEqual(['cus-ada', 'cus-bob']);
  });

  it('shows an explicit empty state for a customer without visits', async () => {
    respuesta = async () => [];
    const el = await mount();
    await open(el, 'cus-nobody');
    expect(text(el)).toContain('ui.historyEmpty');
  });

  it('shows an explicit error state when the query fails (never a silent blank)', async () => {
    respuesta = async () => { throw new Error('boom'); };
    const el = await mount();
    await open(el, 'cus-ada');
    expect(text(el)).toContain('ui.historyError');
  });
});
