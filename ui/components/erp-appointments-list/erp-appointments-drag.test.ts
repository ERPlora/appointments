// appointments#74 — DRAGGING an appointment must move it, and the grid already knows how.
//
// `ok-scheduler` ships the gesture since outfitkit#64 (v0.1.42–44): with `movable` the block is
// dragged (mouse, pen, and finger after a 400 ms hold — the tablet is the POS first-class device)
// or moved with the keyboard, snapping to `snap-minutes`. The grid is DELIBERATELY dumb: it paints
// the block at its destination (optimistic) and emits `ok-event-move` — THE MODULE COMMANDS. If
// the server says no, the host calls `detail.revert()` and the block goes back.
//
// Until here the agenda never turned the gesture on, and a comment claimed «`ok-scheduler` no
// tiene arrastre». This file pins the wiring:
//
//   1. the scheduler is mounted `movable` with the 15-minute snap of the sector standard;
//   2. a drop on the SAME lane sends `appointments.appointments.reschedule` (the command the
//      panel already uses) with the new start in UTC and the row's duration, then refreshes;
//   3. a server refusal (overlap, blocked, lead time) calls `revert()` and is VISIBLE: the
//      shell toast (`notify({type:'error'})`) plus the inline feedback the view already paints;
//   4. a drop on ANOTHER lane is refused with a clear message and `revert()`: dragging between
//      columns changes the PROFESSIONAL, and `reschedule` moves time only (appointments#11 took
//      the professional's identity out of the caller's hands). Letting the drop "succeed" would
//      save one thing (the hour) while showing another (the lane) — a lie in the agenda.
//   5. a terminal appointment (cancelled/completed/…) cannot be dragged either: the command
//      would refuse it, so the block goes back before anyone is told it moved.
import { beforeEach, describe, expect, it } from 'vitest';

// appointments#12 — the clock of these fixtures is PINNED, it is not the machine's.
// Until now these tests built their instants with `new Date(y, m, d, h, mi)` and compared them
// against the component's output: green in Spain, red anywhere else, and green for the wrong
// reason (device == business by luck). The business zone is declared on the SDK stub below, the
// same way the shell publishes it in production, and the device is pinned to match it here so the
// assertions stay about WIRING. That the two can DISAGREE is proven in
// `erp-appointments-business-clock.test.ts`, with the device in Auckland.
process.env.TZ = 'Europe/Madrid';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params?: Record<string, unknown> }[] = [];
const notifyCalls: { type: string; message: string }[] = [];
let commandError: Error | null = null;

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
  {
    // Legacy row without a staff link: it lives in the "unassigned" lane, and a pending
    // appointment CAN be dragged — within that same lane.
    id: 'a2',
    appointment_number: 'APT-2',
    customer_id: 'c2',
    customer_name: 'Berta Ruiz',
    customer_phone: '600333444',
    service_id: 'sv2',
    service_name: 'Color',
    service_price: 4500,
    staff_id: '',
    staff_name: '',
    start_datetime: new Date(2026, 7, 7, 12, 0).toISOString(),
    end_datetime: new Date(2026, 7, 7, 13, 0).toISOString(),
    duration_minutes: 60,
    status: 'pending',
  },
  {
    id: 'a3',
    appointment_number: 'APT-3',
    customer_id: 'c3',
    customer_name: 'Carla Sanz',
    customer_phone: '600555666',
    service_id: 'sv1',
    service_name: 'Haircut',
    service_price: 2000,
    staff_id: 's1',
    staff_name: 'Eva Pro',
    start_datetime: new Date(2026, 7, 7, 16, 0).toISOString(),
    end_datetime: new Date(2026, 7, 7, 16, 30).toISOString(),
    duration_minutes: 30,
    status: 'cancelled',
  },
];

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  notifyCalls.length = 0;
  commandError = null;
  (globalThis as Record<string, unknown>).erplora = {
    // The business timezone the runtime resolved (hub#1022) — what `erplora.timezone` carries.
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.appointments.list':
          return DAY_APPOINTMENTS;
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Luis Back', status: 'active', is_bookable: 1 },
            ],
            total: 2,
          };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (commandError) throw commandError;
      return {};
    },
    on: () => () => {},
    // The shell's toast (same channel the sales POS uses for its feedback).
    notify: (n: { type: string; message: string }) => notifyCalls.push(n),
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  view: string;
  day: string;
  error: string;
  updateComplete: Promise<unknown>;
};

async function mount() {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  const lit = el as unknown as { updateComplete: Promise<unknown> };
  await lit.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await lit.updateComplete;
  return el as Wc;
}

async function staffView(el: Wc) {
  el.view = 'staff';
  await el.updateComplete;
  return el.shadowRoot.querySelector('ok-scheduler') as HTMLElement & { movable: boolean; snapMin: number };
}

interface MoveDetail {
  id: string;
  resourceId: string;
  start: string;
  end: string;
  from: { resourceId: string; start: string; end: string };
  event: unknown;
  revert: () => void;
}

async function drop(
  scheduler: HTMLElement,
  detail: Omit<MoveDetail, 'event' | 'revert'> & { event?: unknown },
) {
  let reverted = false;
  scheduler.dispatchEvent(
    new CustomEvent<MoveDetail>('ok-event-move', {
      detail: { event: {}, ...detail, revert: () => (reverted = true) },
      bubbles: true,
      composed: true,
    }),
  );
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return () => reverted;
}

const rescheduleSent = () => commands.find((c) => c.name === 'appointments.appointments.reschedule');

describe('the agenda wires the drag of ok-scheduler (appointments#74)', () => {
  it('mounts the scheduler movable, with the 15-minute snap of the sector', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    expect(scheduler.movable, 'without movable the grid never emits ok-event-move').toBe(true);
    expect(scheduler.snapMin, '15 minutes is the booking interval of a salon agenda').toBe(15);
    expect(scheduler.hasAttribute('movable'), 'reflected, so the styles can key off it').toBe(true);
  });

  it('a drop on the same lane sends reschedule: new start in the salon wall clock, the row duration, nothing else', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    el.day = '2026-08-07';
    await el.updateComplete;
    const wasReverted = await drop(scheduler, {
      id: 'a1',
      resourceId: 's1',
      start: '12:00',
      end: '12:30',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
    });

    const sent = rescheduleSent();
    expect(sent, 'the drag must reach the same command the panel uses').toBeTruthy();
    expect(sent!.payload.appointment_id).toBe('a1');
    // appointments#76: same instant, but the text carries the SALON's wall clock + its local
    // offset. A UTC wall here is a moved appointment the availability engine reads on the wrong
    // clock (it compares rows wall against wall).
    expect(
      new Date(sent!.payload.start_datetime as string).getTime(),
      'the sent instant does not match the dropped time',
    ).toBe(new Date('2026-08-07T12:00').getTime());
    expect(String(sent!.payload.start_datetime).slice(0, 16), 'the sent WALL clock shifted').toBe('2026-08-07T12:00');
    expect(sent!.payload.duration_minutes, 'the grid preserves the length; the row is the truth').toBe(30);
    expect(Object.keys(sent!.payload).sort(), 'the schema is additionalProperties:false').toEqual([
      'appointment_id',
      'duration_minutes',
      'start_datetime',
    ]);
    expect(wasReverted(), 'an accepted move does not go back').toBe(false);
  });

  it('refreshes the day after the move lands', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    el.day = '2026-08-07';
    const before = queries.filter((q) => q.name === 'appointments.appointments.list').length;
    await drop(scheduler, {
      id: 'a1',
      resourceId: 's1',
      start: '12:00',
      end: '12:30',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
    });
    const after = queries.filter((q) => q.name === 'appointments.appointments.list').length;
    expect(after, 'the optimistic position is discarded when the server data arrives').toBeGreaterThan(before);
  });

  it('a server refusal reverts the block and is visible: toast AND inline feedback', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    el.day = '2026-08-07';
    commandError = Object.assign(new Error('appointment_no_overlap'), {
      code: 'appointments.overlapping_appointment',
    });
    const wasReverted = await drop(scheduler, {
      id: 'a1',
      resourceId: 's1',
      start: '12:00',
      end: '12:30',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
    });
    await el.updateComplete;

    expect(wasReverted(), 'the block must go back to where the server still has it').toBe(true);
    // `domainErrorText` resolves the refusal's CODE to the active language's sentence, so the
    // assertion is on "a visible, translated refusal" — not on the raw code, which the
    // receptionist never sees.
    expect(el.error, 'the refusal must not be swallowed').not.toBe('');
    expect(el.error).toContain('profesional'); // the es.json sentence for overlapping_appointment
    expect(
      el.shadowRoot.querySelector('ok-inline-feedback'),
      'the inline feedback is painted in the staff view too',
    ).toBeTruthy();
    expect(
      notifyCalls.filter((n) => n.type === 'error').length,
      'a toast: the drag happens far from the error banner',
    ).toBeGreaterThan(0);
  });

  it('a drop on ANOTHER lane is refused: changing professional is not a drag (yet)', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    el.day = '2026-08-07';
    const wasReverted = await drop(scheduler, {
      id: 'a1',
      resourceId: 's2',
      start: '12:00',
      end: '12:30',
      from: { resourceId: 's1', start: '10:00', end: '10:30' },
    });

    expect(rescheduleSent(), 'reschedule moves time only — the lane change must not half-succeed').toBeUndefined();
    expect(wasReverted()).toBe(true);
    expect(notifyCalls.some((n) => n.type === 'error'), 'the receptionist is told WHY the block jumped back').toBe(true);
  });

  it('an unassigned appointment can still be dragged inside its own lane', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    el.day = '2026-08-07';
    const wasReverted = await drop(scheduler, {
      id: 'a2',
      resourceId: 'unassigned',
      start: '15:00',
      end: '16:00',
      from: { resourceId: 'unassigned', start: '12:00', end: '13:00' },
    });

    expect(rescheduleSent()?.payload.appointment_id).toBe('a2');
    expect(wasReverted()).toBe(false);
  });

  it('a cancelled appointment cannot be dragged: the block goes back', async () => {
    const el = await mount();
    const scheduler = await staffView(el);
    el.day = '2026-08-07';
    const wasReverted = await drop(scheduler, {
      id: 'a3',
      resourceId: 's1',
      start: '12:00',
      end: '12:30',
      from: { resourceId: 's1', start: '16:00', end: '16:30' },
    });

    expect(rescheduleSent(), 'the command refuses terminal states; the grid must not promise it').toBeUndefined();
    expect(wasReverted()).toBe(true);
    expect(notifyCalls.some((n) => n.type === 'error')).toBe(true);
  });
});
