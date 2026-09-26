// appointments#194 — where the front desk FINDS the history of an appointment.
//
// The sheet of an appointment in this agenda is the side panel of the table (`slot="create"`):
// tapping a block in «By professional» or «Reschedule» on a row opens it. The history belongs
// there (Fresha, Booksy, Square: the activity lives inside the appointment's detail). But the
// reschedule panel only opens for pending|confirmed appointments — and the question «who
// cancelled this?» is asked precisely about a CANCELLED one. So:
//   - a «History» row action, enabled in EVERY status;
//   - the reschedule panel carries the history block under the form;
//   - tapping a block the agenda cannot move (cancelled, completed…) opens its history instead of
//     doing nothing.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@erplora/outfitkit/ok-timeline', () => ({}));

const STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

const DAY = [
  {
    id: 'a1', appointment_number: 'APT-1', customer_id: 'c1', customer_name: 'Ana', service_id: 'sv1',
    service_name: 'Corte', service_price: 2000, staff_id: 's1', staff_name: 'Eva',
    start_datetime: new Date(2026, 8, 26, 10, 0).toISOString(), end_datetime: new Date(2026, 8, 26, 10, 30).toISOString(),
    duration_minutes: 30, status: 'confirmed',
  },
  {
    id: 'a2', appointment_number: 'APT-2', customer_id: 'c2', customer_name: 'Berta', service_id: 'sv1',
    service_name: 'Corte', service_price: 2000, staff_id: 's1', staff_name: 'Eva',
    start_datetime: new Date(2026, 8, 26, 12, 0).toISOString(), end_datetime: new Date(2026, 8, 26, 12, 30).toISOString(),
    duration_minutes: 30, status: 'cancelled',
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
  view: string;
  rowActions: { id: string; label: string; icon: string; disabled?: (row: Record<string, unknown>) => boolean }[];
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  onEventClick: (ev: CustomEvent<{ id: string }>) => Promise<void>;
  openCreate: () => Promise<void>;
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

const panel = (el: Wc) => el.shadowRoot.querySelector('[slot="create"]') as HTMLElement | null;
const historyIn = (root: Element | null) =>
  root?.querySelector('erp-appointments-history') as (HTMLElement & { appointmentId: string }) | null;

describe('the agenda offers the history of every appointment', () => {
  it('has a «History» row action with its label and icon', async () => {
    const el = await mount();
    const action = el.rowActions.find((a) => a.id === 'history');
    expect(action, 'without it a cancelled appointment has no door to its history').toBeDefined();
    expect(action!.label).toBe('ui.actionHistory');
    expect(action!.icon).toBeTruthy();
  });

  for (const status of STATUSES) {
    it(`the history is reachable on a ${status} appointment`, async () => {
      const el = await mount();
      const action = el.rowActions.find((a) => a.id === 'history')!;
      expect(!!action.disabled?.({ id: 'x', status })).toBe(false);
    });
  }

  it('opens the panel on the history of THAT appointment, without touching anything', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'history', row: DAY[1] } }));
    await el.updateComplete;
    const p = panel(el);
    expect(p?.getAttribute('data-mode')).toBe('history');
    expect(historyIn(p)?.appointmentId).toBe('a2');
    expect(p?.querySelector('form[data-mode="create"]'), 'the create form is not the history').toBeNull();
  });

  it('the history panel is named once: by its header, not again by the timeline', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'history', row: DAY[1] } }));
    await el.updateComplete;
    expect((historyIn(panel(el)) as unknown as { hideTitle?: boolean })?.hideTitle).toBe(true);
  });

  it('under the reschedule form the history keeps its own title', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: DAY[0] } }));
    await el.updateComplete;
    expect((historyIn(panel(el)) as unknown as { hideTitle?: boolean })?.hideTitle ?? false).toBe(false);
  });

  it('the «+» after looking at a history opens a clean create form', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'history', row: DAY[1] } }));
    await el.openCreate();
    await el.updateComplete;
    expect(panel(el)?.getAttribute('data-mode')).toBe('create');
    expect(historyIn(panel(el))).toBeNull();
  });
});

describe('the sheet of an appointment carries its history', () => {
  it('the reschedule panel shows the history of the appointment being moved', async () => {
    const el = await mount();
    await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row: DAY[0] } }));
    await el.updateComplete;
    const p = panel(el);
    expect(p?.getAttribute('data-mode')).toBe('reschedule');
    expect(historyIn(p)?.appointmentId).toBe('a1');
  });

  it('tapping a block the agenda cannot move opens its history instead of nothing', async () => {
    const el = await mount();
    el.view = 'staff';
    await el.updateComplete;
    await el.onEventClick(new CustomEvent('ok-event-click', { detail: { id: 'a2' } }));
    await el.updateComplete;
    expect(el.view, 'the panel lives in the table').toBe('list');
    const p = panel(el);
    expect(p?.getAttribute('data-mode')).toBe('history');
    expect(historyIn(p)?.appointmentId).toBe('a2');
  });

  it('tapping a movable block still opens the reschedule form (with its history)', async () => {
    const el = await mount();
    el.view = 'staff';
    await el.updateComplete;
    await el.onEventClick(new CustomEvent('ok-event-click', { detail: { id: 'a1' } }));
    await el.updateComplete;
    expect(panel(el)?.getAttribute('data-mode')).toBe('reschedule');
    expect(historyIn(panel(el))?.appointmentId).toBe('a1');
  });
});
