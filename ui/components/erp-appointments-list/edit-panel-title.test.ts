// pm#450 (outfitkit#150): the side panel of the agenda is reused to MOVE an appointment and to
// show its history, and both opened it as an ALTA with open('create'). `ok-data-table` now has an
// «edit» mode and takes the whole header title — `open('edit' | 'create', { title })` — which is
// also the `aria-label` of the dialog: without it a screen reader announced the panel as «Form».
//
// This screen has no «Editing …» line in the body to remove: the header was already right thanks
// to the `.labels.newRecord` override (the staff#68 fallback). That override STAYS: a shell with
// OutfitKit < 0.1.94 (hub:stable 1.1.29 ships 0.1.73) ignores `title` and paints `newRecord` for
// the «edit» panel too. The last describe pins it against the OutfitKit the tests load.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@erplora/outfitkit/ok-timeline', () => ({}));

const DAY = [
  {
    id: 'a1', appointment_number: 'APT-1', customer_id: 'c1', customer_name: 'Ana', service_id: 'sv1',
    service_name: 'Corte', service_price: 2000, staff_id: 's1', staff_name: 'Eva',
    start_datetime: new Date(2026, 8, 26, 10, 0).toISOString(), end_datetime: new Date(2026, 8, 26, 10, 30).toISOString(),
    duration_minutes: 30, status: 'confirmed',
  },
];

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
    locale: 'es',
    t: (_c: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  openCreate: () => Promise<void>;
  onSlotClick: (ev: CustomEvent<{ resourceId: string; time: string }>) => Promise<void>;
};
type Table = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  labels: Record<string, string>;
  open: (panel?: unknown, opts?: { title?: string }) => void;
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

const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Table;
const act = (el: Wc, actionId: string) =>
  el.onRowAction(new CustomEvent('rowAction', { detail: { actionId, row: DAY[0] as unknown as Record<string, unknown> } }));
const spyOpen = (el: Wc) => {
  const calls: unknown[][] = [];
  table(el).open = (...args: unknown[]) => void calls.push(args);
  return calls;
};

describe('the agenda panel carries its own title in the header (pm#450)', () => {
  it("«Reschedule» opens the panel with open('edit', { title: «Move appointment» })", async () => {
    const el = await mount();
    const calls = spyOpen(el);
    await act(el, 'reschedule');
    expect(calls).toEqual([['edit', { title: 'ui.rescheduleTitle' }]]);
  });

  it('«History» titles the panel «Appointment history», not the generic «Form»', async () => {
    const el = await mount();
    const calls = spyOpen(el);
    await act(el, 'history');
    expect(calls).toEqual([['create', { title: 'ui.appointmentHistoryTitle' }]]);
  });

  it('the «+» after a move opens a plain ALTA (no title carried over)', async () => {
    const el = await mount();
    await act(el, 'reschedule');
    const calls = spyOpen(el);
    await el.openCreate();
    expect(calls).toEqual([['create']]);
  });

  it('a free timeline slot after a history opens a plain ALTA, not the old history', async () => {
    const el = await mount();
    await act(el, 'history');
    const calls = spyOpen(el);
    await el.onSlotClick(new CustomEvent('slotClick', { detail: { resourceId: 's1', time: '11:00' } }));
    await el.updateComplete;
    expect(calls).toEqual([['create']]);
    expect(table(el).labels.newRecord).toBeUndefined();
    expect(el.shadowRoot.querySelector('[data-testid="appointments-list-history"]')).toBeNull();
  });
});

describe('fallback for shells with OutfitKit < 0.1.94 (the labels override stays)', () => {
  const header = (el: Wc) => table(el).shadowRoot.querySelector('.drawer .dh')?.textContent ?? '';

  it('while moving an appointment, `newRecord` reads «Move appointment»', async () => {
    const el = await mount();
    await act(el, 'reschedule');
    await el.updateComplete;
    expect(table(el).labels.newRecord).toBe('ui.rescheduleTitle');
  });

  it('the header an old shell paints for the «edit» panel says «Move appointment», not «New»', async () => {
    const el = await mount();
    await act(el, 'reschedule');
    await el.updateComplete;
    await table(el).updateComplete;
    expect(el.shadowRoot.querySelector('[slot="create"]')?.getAttribute('data-mode')).toBe('reschedule');
    expect(header(el)).toContain('ui.rescheduleTitle');
  });

  it('while showing a history, `newRecord` reads «Appointment history»', async () => {
    const el = await mount();
    await act(el, 'history');
    await el.updateComplete;
    expect(table(el).labels.newRecord).toBe('ui.appointmentHistoryTitle');
  });
});
