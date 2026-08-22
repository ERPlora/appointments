// appointments#74 — the drag the whole booking market runs on (research in ERPlora/outfitkit#63,
// 16 references + forums): the block is dragged along the grid and the module sends the move.
// `ok-scheduler` ships it since outfitkit#64 (`movable` + `ok-event-move` with `revert()`); this
// file pins the WIRING of this module:
//
//   1. the scheduler in «Por profesional» runs with `movable` and 15-minute snapping (the sector
//      standard slot);
//   2. a drop on the SAME lane sends `appointments.appointments.reschedule` for the new wall
//      time and refreshes;
//   3. a drop on ANOTHER lane is NOT a move: `reschedule` deliberately does not change the
//      professional (appointments#11 — the handler reads it from the row), so the drop is
//      reverted on the spot with a visible message, instead of letting the agenda show a
//      professional that is not the one stored;
//   4. a server refusal (overlap, blocked, too soon, terminal state) reverts the block and
//      shows the domain error — the optimistic position is never left lying.
import { beforeEach, describe, expect, it } from 'vitest';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
let commandFails: string | null = null;

const DAY_APPOINTMENTS = [
  {
    id: 'a1',
    appointment_number: 'APT-1',
    customer_id: 'c1',
    customer_name: 'Ana López',
    customer_phone: '600111222',
    service_id: 'sv1',
    service_name: 'Haircut',
    service_price: 2000,
    staff_id: 's1',
    staff_name: 'Eva Pro',
    start_datetime: new Date(2026, 7, 7, 10, 0).toISOString(),
    end_datetime: new Date(2026, 7, 7, 10, 30).toISOString(),
    duration_minutes: 30,
    status: 'confirmed',
  },
];

beforeEach(() => {
  commands.length = 0;
  commandFails = null;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return DAY_APPOINTMENTS;
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '600111222', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30 }], total: 1 };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Bea Pro', status: 'active', is_bookable: 1 },
            ],
            total: 2,
          };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 8, calendar_end_hour: 20, default_duration: 60, allow_overlapping: 0 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      if (commandFails) throw new Error(commandFails);
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type SchedulerEl = HTMLElement & {
  movable: boolean;
  snapMin: number;
  date: string;
};

async function mountStaffView() {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  const lit = el as unknown as { updateComplete: Promise<unknown>; view: string };
  await lit.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await lit.updateComplete;
  lit.view = 'staff';
  await lit.updateComplete;
  return {
    el: el as HTMLElement & { shadowRoot: ShadowRoot },
    scheduler: el.shadowRoot.querySelector('ok-scheduler') as SchedulerEl,
  };
}

interface MoveDetail {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  from: { resourceId: string; start: string; end: string };
  revert: () => void;
}

async function drop(scheduler: SchedulerEl, detail: MoveDetail) {
  let reverted = false;
  scheduler.dispatchEvent(
    new CustomEvent('ok-event-move', {
      detail: { ...detail, revert: () => (reverted = true) },
      bubbles: true,
      composed: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return reverted;
}

describe('appointments#74: the appointment block is draggable on the timeline', () => {
  it('the scheduler runs with movable + 15-minute snapping (the sector standard slot)', async () => {
    const { scheduler } = await mountStaffView();
    expect(scheduler.movable, 'drag ships in ok-scheduler since outfitkit#64; the module must switch it on').toBe(true);
    expect(scheduler.snapMin, 'the receptionist thinks in 15-minute steps').toBe(15);
  });

  it('a drop on the SAME lane sends reschedule with the new wall time and the row duration', async () => {
    const { scheduler } = await mountStaffView();
    const reverted = await drop(scheduler, {
      id: 'a1',
      resourceId: 's1',
      start: '12:15',
      end: '12:45',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
      revert: () => {},
    });
    expect(reverted, 'a successful move never reverts the block').toBe(false);
    const sent = commands.find((c) => c.name === 'appointments.appointments.reschedule');
    expect(sent, 'the drag must reach the authoritative command').toBeTruthy();
    expect(sent!.payload.appointment_id).toBe('a1');
    expect(sent!.payload.duration_minutes, 'the duration rides along: a drag moves time, not length').toBe(30);
    // appointments#76: the wall clock of the drop, written in the salon's clock (+ offset).
    const sentStart = String(sent!.payload.start_datetime);
    expect(new Date(sentStart).getTime()).toBe(new Date(`${scheduler.date}T12:15:00`).getTime());
    expect(sentStart.slice(0, 16)).toBe(`${scheduler.date}T12:15`);
  });

  it('a drop on ANOTHER lane is a professional change: reverted on the spot, no command, visible reason', async () => {
    const { el, scheduler } = await mountStaffView();
    const reverted = await drop(scheduler, {
      id: 'a1',
      resourceId: 's2',
      start: '12:15',
      end: '12:45',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
      revert: () => {},
    });
    expect(reverted, 'the block must go back: the server would keep the ORIGINAL professional').toBe(true);
    expect(
      commands.find((c) => c.name === 'appointments.appointments.reschedule'),
      'a cross-lane drop must not send a move it cannot honor',
    ).toBeUndefined();
    const feedback = el.shadowRoot.querySelector('ok-inline-feedback');
    expect(feedback?.textContent, 'the receptionist needs to know WHY the block jumped back').toContain(
      'ui.errDragCrossLane',
    );
  });

  it('a server refusal reverts the optimistic position and shows the domain error', async () => {
    const { el, scheduler } = await mountStaffView();
    commandFails = 'appointments.overlapping_appointment';
    const reverted = await drop(scheduler, {
      id: 'a1',
      resourceId: 's1',
      start: '12:15',
      end: '12:45',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
      revert: () => {},
    });
    expect(reverted, 'the block was left in a position the server never accepted').toBe(true);
    const feedback = el.shadowRoot.querySelector('ok-inline-feedback');
    expect(feedback?.textContent).toContain('appointments.overlapping_appointment');
  });
});
