// appointments#89 (ERPlora/sales#89) — a completed appointment must be chargeable.
//
// The agenda could confirm, start, complete, no-show, cancel and delete a booking. It could not
// CHARGE one: the day ended with "completed" and the money was never taken. In a salon that is the
// whole point of the appointment.
//
// ADR-0077 fixed where the work happens: the TILL charges, reading the booking through this
// module's public query. So the agenda's job is only to hand over the id and get out of the way —
// no order building, no totals, no fiscal logic here. `appointments` never learns what a sale is.
//
// The second half is the trace. `converted_sale_id` has been written by the `_mark_converted`
// listener since the column existed, but no query ever projected it, so the agenda could not
// answer "was this charged?" — and nothing stopped a receptionist charging the same booking twice.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const CHARGEABLE = {
  id: 'ap-1', appointment_number: 'A-001', customer_id: 'c-ana', customer_name: 'Ana Ruiz',
  service_id: 's-corte', service_name: 'Corte de señora', service_price: 1800,
  staff_id: 'st-lucia', staff_name: 'Lucía', status: 'completed',
  start_datetime: '2026-08-14T10:00:00', end_datetime: '2026-08-14T10:45:00',
  duration_minutes: 45, converted_sale_id: null,
};
const ALREADY_CHARGED = { ...CHARGEABLE, id: 'ap-2', appointment_number: 'A-002',
  converted_sale_id: 'sale-9' };

function installSdk(rows: Record<string, unknown>[]) {
  (globalThis as Record<string, unknown>).erplora = {
    query: async () => rows,
    queryAll: async () => [],
    queryOptional: async () => undefined,
    command: async () => ({}),
    locale: 'es',
    currency: 'EUR',
    formatMoney: (c: number) => `${((c || 0) / 100).toFixed(2)} €`,
    t: (_c: unknown, key: string) => key,
    notify: () => {},
  };
}

interface RowAction {
  id: string;
  disabled?: (row: Record<string, unknown>) => boolean;
}
interface Agenda {
  rowActions: RowAction[];
  onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>): Promise<void>;
}

async function agenda(rows: Record<string, unknown>[]): Promise<Agenda> {
  installSdk(rows);
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  return el as unknown as Agenda;
}

const charge = (a: Agenda) => a.rowActions.find((x) => x.id === 'charge');
/** `ok-data-table` decides per row with the action's own `disabled` predicate. */
const chargeableOf = (a: Agenda, row: Record<string, unknown>) => !charge(a)?.disabled?.(row);

beforeEach(() => { document.body.innerHTML = ''; });

describe('charging an appointment (ADR-0077)', () => {
  it('offers Cobrar on a booking that has not been charged', async () => {
    const a = await agenda([CHARGEABLE]);
    expect(charge(a)).toBeDefined();
    expect(chargeableOf(a, CHARGEABLE)).toBe(true);
  });

  it('hands the till the appointment id and nothing else', async () => {
    const a = await agenda([CHARGEABLE]);
    const replace = vi.spyOn(window.history, 'pushState');

    await a.onRowAction(new CustomEvent('x', {
      detail: { actionId: 'charge', row: CHARGEABLE },
    }));

    const url = String(replace.mock.calls.at(-1)?.[2] ?? '');
    expect(url).toContain('/m/sales/pos');
    expect(url).toContain('appointment_id=ap-1');
    replace.mockRestore();
  });

  // The till is a different module's screen: the shell has to actually route there, and the only
  // navigation channel a Web Component has is a history push plus a popstate.
  it('tells the shell to navigate, not just rewrite the address bar', async () => {
    const a = await agenda([CHARGEABLE]);
    const seen: string[] = [];
    const listener = () => seen.push('popstate');
    window.addEventListener('popstate', listener);

    await a.onRowAction(new CustomEvent('x', {
      detail: { actionId: 'charge', row: CHARGEABLE },
    }));

    window.removeEventListener('popstate', listener);
    expect(seen).toContain('popstate');
  });
});

describe('a booking already turned into a sale', () => {
  // Blocked, not hidden. Charging the same client twice is the failure to avoid, but a button that
  // vanishes leaves the front desk wondering why — the same call the till makes for a product it
  // cannot sell (sales#74).
  it('cannot be charged again: the action is disabled for that row', async () => {
    const a = await agenda([ALREADY_CHARGED]);
    expect(charge(a)).toBeDefined();
    expect(chargeableOf(a, ALREADY_CHARGED)).toBe(false);
  });
});
