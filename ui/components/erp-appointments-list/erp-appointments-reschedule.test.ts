// appointments#42 — MOVING an appointment must be one gesture, not cancel + re-create.
//
// Until now the row bar offered Charge, Confirm, Start, Complete, No-show, Cancel and Delete, and
// the timeline only answered clicks on EMPTY slots. To move a booking the receptionist had to
// cancel it and create a new one: the appointment lost its identity, its number and its history,
// and the customer's card showed a cancellation that never happened. The `reschedule` command was
// there all along — authoritative, with its state gate and its server-side overlap gate.
//
// What the market does (Fresha, Vagaro, Square Appointments, Booksy, Phorest, Zenoti, Treatwell,
// Mindbody): the appointment is DRAGGED on the grid, and there is also an explicit "Reschedule"
// entry that opens the booking form pre-filled. Both halves ship: the drag since appointments#74
// (see erp-appointments-drag.test.ts) and this file's panel — the row action and the click on the
// block, which is the accessible route (the block is a focusable button). The panel is the one
// `ok-data-table` already exposes for exactly this
// ("open('create') → the edit form pre-filled", ok-data-table.ts:848).
//
// WHAT THE PANEL DOES NOT DO: change the professional. `reschedule` is Tier 0 SQL and moves time
// only; letting the browser send a new `staff_id` + `staff_name` would put the professional's
// identity back in the caller's hands, which is the very thing appointments#11 took OUT of
// `create`. The professional rides along when `reschedule` becomes authoritative through `reads`
// (appointments#10/#13). Here it is shown, read-only, so the receptionist knows whose column she
// is moving inside.
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
let commandFails: string | null = null;
const toasts: { type: string; message: string }[] = [];

const DAY_APPOINTMENTS = [
  {
    id: 'a1',
    appointment_number: 'APT-1',
    customer_id: 'c1',
    customer_name: 'Ana López',
    service_id: 'sv1',
    service_name: 'Haircut',
    service_price: 2000,
    staff_id: 's1',
    staff_name: 'Eva Pro',
    // 10:00 local, whatever the machine's zone: the panel must show the wall clock the salon
    // reads on the wall, not the UTC instant (the bug fmtTime/wallClock already fixed twice).
    start_datetime: new Date(2026, 7, 7, 10, 0).toISOString(),
    end_datetime: new Date(2026, 7, 7, 10, 30).toISOString(),
    duration_minutes: 30,
    status: 'confirmed',
  },
  {
    id: 'a2',
    appointment_number: 'APT-2',
    customer_id: 'c2',
    customer_name: 'Berta Ruiz',
    service_id: 'sv2',
    service_name: 'Color',
    service_price: 4500,
    staff_id: '',
    staff_name: '',
    start_datetime: new Date(2026, 7, 7, 12, 0).toISOString(),
    end_datetime: new Date(2026, 7, 7, 13, 0).toISOString(),
    duration_minutes: 60,
    status: 'cancelled',
  },
];

beforeEach(() => {
  commands.length = 0;
  commandFails = null;
  toasts.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    // The business timezone the runtime resolved (hub#1022) — what `erplora.timezone` carries.
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return DAY_APPOINTMENTS;
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '600111222', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Luis Back', status: 'active', is_bookable: 0 },
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
      if (commandFails) throw new Error(commandFails);
      return {};
    },
    on: () => () => {},
    notify: (n: { type: string; message: string }) => toasts.push(n),
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

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

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  view: string;
  error: string;
  formError: string;
  rescheduleId: string;
  rescheduleStart: string;
  rescheduleDuration: string;
  rescheduleStaffName: string;
  rowActions: { id: string; label: string; icon: string; disabled?: (row: Record<string, unknown>) => boolean }[];
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  submitReschedule: (ev: Event) => Promise<void>;
  updateComplete: Promise<unknown>;
};

const rowAction = (el: Wc, id: string) => el.rowActions.find((a) => a.id === id);

const fireRowAction = async (el: Wc, actionId: string, row: Record<string, unknown>) => {
  await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId, row } }));
  await el.updateComplete;
};

/** `YYYY-MM-DDTHH:MM` in LOCAL time — the combined value of the date + time fields. */
const localInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
  `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('the row bar can move an appointment', () => {
  it('offers a reschedule action', async () => {
    const el = await mount();
    const action = rowAction(el, 'reschedule');
    expect(action, 'cancel + re-create loses the appointment identity and its history').toBeTruthy();
    expect(action!.icon, 'the calendar icon is the one the market uses for moving a booking').toBeTruthy();
  });

  // The command only accepts pending|confirmed (`_reschedule_state_assert.sql`). A greyed-out
  // button tells the receptionist WHY; a hidden one leaves her looking for it.
  it('paints the action disabled for the states the command refuses', async () => {
    const el = await mount();
    const disabled = rowAction(el, 'reschedule')!.disabled!;
    expect(disabled({ status: 'pending' })).toBe(false);
    expect(disabled({ status: 'confirmed' })).toBe(false);
    for (const status of ['in_progress', 'completed', 'cancelled', 'no_show']) {
      expect(disabled({ status }), `${status} is not reschedulable`).toBe(true);
    }
  });

  it('pre-fills the panel with the appointment slot, in LOCAL wall clock', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);

    expect(el.rescheduleId, 'the panel must know which appointment it is moving').toBe('a1');
    expect(el.rescheduleStart, 'a UTC value here would move the booking by the tz offset').toBe(
      localInput(new Date(DAY_APPOINTMENTS[0].start_datetime)),
    );
    expect(el.rescheduleDuration).toBe('30');
    expect(el.rescheduleStaffName, 'the professional is context, so she knows whose column it is').toBe('Eva Pro');
  });

  it('renders the reschedule form instead of the create form while moving', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    const form = el.shadowRoot.querySelector('form[slot="create"]')!;
    expect(form.getAttribute('data-mode'), 'the panel is in reschedule mode').toBe('reschedule');
    expect(
      form.querySelector('ion-select[data-role="customer"]'),
      'reschedule moves time: customer and service are not up for grabs',
    ).toBeNull();
    // appointments#204: the new slot is a date field + a time field (keyboard-friendly).
    // appointments#205: the day is a text field in the hub language (see erp-appointments-hub-locale-dates.test.ts).
    expect(form.querySelector('ion-input[data-role="reschedule-start"]'), 'the new day is picked here').toBeTruthy();
    // appointments#214: the hour is a text field in the hub clock (see erp-appointments-hub-locale-times.test.ts).
    expect(form.querySelector('ion-input[data-role="reschedule-start-time"]'), 'the new hour is picked here').toBeTruthy();
  });

  it('sends appointment_id, the new slot in the SALON wall clock (+ its offset) and the duration — never the end', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    el.rescheduleStart = '2026-08-07T16:45';
    el.rescheduleDuration = '45';
    await el.submitReschedule(new Event('submit'));

    const sent = commands.find((c) => c.name === 'appointments.appointments.reschedule');
    expect(sent, 'the reschedule command was not dispatched').toBeTruthy();
    const p = sent!.payload;
    expect(p.appointment_id).toBe('a1');
    // appointments#76: the stored text must carry the LOCAL wall clock + its offset, not a UTC
    // wall. Same INSTANT (never moves the booking), but the wall part is what the availability
    // engine compares row against row: a UTC wall here is a window tatted two hours off.
    expect(
      new Date(p.start_datetime as string).getTime(),
      'the instant changed — the booking moved',
    ).toBe(new Date('2026-08-07T16:45').getTime());
    expect(String(p.start_datetime).slice(0, 16), 'the WALL clock changed').toBe('2026-08-07T16:45');
    expect(p.duration_minutes, 'the schema wants an integer, not the input string').toBe(45);
    // appointments#10: `end = start + duration` is arithmetic, and the handler does it. An
    // `end_datetime` sent from here is a second opinion that could disagree with the duration —
    // the schema no longer accepts it, and `additionalProperties:false` rejects the whole payload.
    expect(p.end_datetime, 'the end is computed server-side, not sent').toBeUndefined();
    expect(Object.keys(p).sort(), 'the payload schema is additionalProperties:false').toEqual([
      'allow_past',
      'allow_short_notice',
      'appointment_id',
      'duration_minutes',
      'start_datetime',
    ]);
  });

  it('closes the panel and forgets the appointment once the move lands', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    await el.submitReschedule(new Event('submit'));
    await el.updateComplete;
    expect(el.rescheduleId, 'a sticky panel would move the NEXT appointment by mistake').toBe('');
  });

  // The overlap gate is server-side (`_appointment_overlap_assert.sql`). A silent failure would
  // leave the receptionist believing the customer was moved.
  it('shows the server refusal and keeps the panel open on the failed move', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    commandFails = 'appointment_no_overlap';
    await el.submitReschedule(new Event('submit'));
    await el.updateComplete;

    expect(el.formError, 'a double booking must be visible, not swallowed').toContain('appointment_no_overlap');
    expect(el.rescheduleId, 'the panel stays open so she can pick another slot').toBe('a1');
    // appointments#156 — painted INSIDE the panel, which covers the list's own feedback entirely,
    // and in a toast too: before, the receptionist pressed «Save» and saw nothing at all.
    const form = el.shadowRoot.querySelector('form[data-mode="reschedule"]')!;
    const painted = form.querySelector('[data-testid="appointments-list-reschedule-error"]');
    expect(painted, 'the refusal is painted where the person is looking').toBeTruthy();
    expect(painted!.textContent).toContain('appointment_no_overlap');
    expect(toasts.map((n) => n.type), 'and it also reaches the toast').toEqual(['error']);
  });

  it('does not keep painting the previous refusal while the next move is on its way', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    commandFails = 'appointment_no_overlap';
    await el.submitReschedule(new Event('submit'));
    commandFails = null;
    let land!: () => void;
    const api = (globalThis as unknown as { erplora: { command: unknown } }).erplora;
    api.command = (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return new Promise<void>((r) => (land = r));
    };
    const pending = el.submitReschedule(new Event('submit'));
    await el.updateComplete;
    expect(el.formError, 'the old refusal would describe a slot she has already changed').toBe('');
    land();
    await pending;
  });

  // `formError` is shared with the create form (appointments#155): a refusal the move panel
  // leaves behind when it is cancelled would be painted under «New appointment» as if that
  // booking had already failed. Closing the panel must forget it.
  it('forgets the previous refusal when the panel is closed', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    commandFails = 'appointment_no_overlap';
    await el.submitReschedule(new Event('submit'));
    await el.updateComplete;
    expect(el.formError, 'the refusal is there to forget').toContain('appointment_no_overlap');
    (el.shadowRoot.querySelector('[data-testid="appointments-list-reschedule-cancel"]') as HTMLElement).click();
    await el.updateComplete;
    expect(el.rescheduleId, 'the panel is closed').toBe('');
    expect(el.formError, 'a stale refusal would lie about the next move').toBe('');
    expect(
      el.shadowRoot.querySelector('[data-testid="appointments-list-form-error"]'),
      'the create form must not inherit the refusal of a move that was abandoned',
    ).toBeNull();
  });

  // appointments#165 / #156 — the panel IS the counter. It declares, always, the two things
  // `create` lets the counter declare (#155, #157): the client seen at 11:30 instead of 11:00
  // (a start in the past) and the one who arrived early and fits in half an hour (inside the
  // minimum notice). Sent without consulting the browser clock: the deciding clock is the hub's.
  it('declares the counter: a move to the past or inside the minimum notice is the receptionist deciding', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    await el.submitReschedule(new Event('submit'));
    const p = commands.find((c) => c.name === 'appointments.appointments.reschedule')!.payload;
    expect(p.allow_past, 'the agenda must be able to tell the hour she was really seen').toBe(true);
    expect(p.allow_short_notice, 'the minimum notice is the customer window, not the counter').toBe(true);
  });

  it('warns, without blocking, when the new start has already passed', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[0]);
    const notice = () =>
      el.shadowRoot.querySelector('form[data-mode="reschedule"] [data-testid="appointments-list-reschedule-past-notice"]');
    el.rescheduleStart = localInput(new Date(Date.now() + 2 * 3_600_000));
    await el.updateComplete;
    expect(notice(), 'a permanent notice goes unread').toBeNull();
    el.rescheduleStart = localInput(new Date(Date.now() - 2 * 3_600_000));
    await el.updateComplete;
    expect(notice(), 'the past start is said out loud before saving').toBeTruthy();
    const submit = el.shadowRoot.querySelector('[data-testid="appointments-list-reschedule-submit"]')!;
    expect(submit.hasAttribute('disabled'), 'a warning, not a wall').toBe(false);
  });

  it('never dispatches a move for an appointment the command would refuse', async () => {
    const el = await mount();
    await fireRowAction(el, 'reschedule', DAY_APPOINTMENTS[1]); // cancelled
    expect(el.rescheduleId, 'a cancelled appointment cannot be moved').toBe('');
    expect(commands.some((c) => c.name === 'appointments.appointments.reschedule')).toBe(false);
  });
});

describe('the grid moves an appointment too', () => {
  // Dragging the block (appointments#74) is the fastest gesture; clicking it is the accessible
  // one — the block is a focusable button, and Enter/Space reaches this same panel.
  it('clicking an appointment block opens the same pre-filled panel', async () => {
    const el = await mount();
    el.view = 'staff';
    await el.updateComplete;
    const scheduler = el.shadowRoot.querySelector('ok-scheduler')!;
    scheduler.dispatchEvent(
      new CustomEvent('ok-event-click', { detail: { id: 'a1', event: {} }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    await el.updateComplete;

    expect(el.rescheduleId, 'the block must be actionable, not decoration').toBe('a1');
    expect(el.rescheduleStart).toBe(localInput(new Date(DAY_APPOINTMENTS[0].start_datetime)));
    expect(el.view, 'the panel lives in the list view, where the table is').toBe('list');
  });

  it('clicking a cancelled block does not open the panel', async () => {
    const el = await mount();
    el.view = 'staff';
    await el.updateComplete;
    el.shadowRoot.querySelector('ok-scheduler')!.dispatchEvent(
      new CustomEvent('ok-event-click', { detail: { id: 'a2', event: {} }, bubbles: true, composed: true }),
    );
    await el.updateComplete;
    expect(el.rescheduleId).toBe('');
  });
});
