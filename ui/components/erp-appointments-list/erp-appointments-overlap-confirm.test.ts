// appointments#86 — booking a slot that OVERLAPS another live appointment asks first.
//
// The market decided the shape (ADR-0383's out-of-scope note plus the 14 references of
// outfitkit#71): Phorest raises an explicit Confirm/Cancel prompt, Square warns before
// double-booking from the staff calendar, DaySmart ships double booking as `Warn` / `Don't Allow`,
// Fresha allows it in-store only and Vagaro behind an explicit *Double Book* action. Five for five:
// **the overlap is CONFIRMED, never assumed**. The documented Square complaint is exactly the
// missing notice, not the drawing.
//
// So the three states this pins:
//   · `allow_overlapping` ON  + a real conflict → prompt naming WHO and WHEN, and NOTHING is
//     written until the receptionist accepts. Cancel writes nothing at all.
//   · `allow_overlapping` OFF → unchanged: no prompt, the command flies and the SERVER refuses
//     (`_appointment_overlap_assert.sql`). A prompt there would promise a choice that does not
//     exist.
//   · no conflict → no prompt, ever.
process.env.TZ = 'Europe/Madrid';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pickCustomer } from '../../test/pick-customer';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params: Record<string, unknown> }[] = [];

/** The salon's day, as the agenda list returns it. 11:00 → 11:30 with Eva. */
const BOOKED = {
  id: 'a1',
  appointment_number: 'APT-20260817-0001',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Corte',
  service_price: 2000,
  staff_id: 's1',
  staff_name: 'Eva Pro',
  start_datetime: '2026-08-17T11:00:00+02:00',
  end_datetime: '2026-08-17T11:30:00+02:00',
  duration_minutes: 30,
  status: 'confirmed',
  converted_sale_id: null,
  recurring_id: null,
  occurrence_date: null,
};

/** A second appointment of the same professional, far from the first one. */
const LATE = {
  ...BOOKED,
  id: 'a2',
  appointment_number: 'APT-20260817-0002',
  customer_id: 'c2',
  customer_name: 'Berta Ruiz',
  start_datetime: '2026-08-17T16:00:00+02:00',
  end_datetime: '2026-08-17T16:30:00+02:00',
};

let allowOverlapping = true;

/** The catalog lookup + `{param}` interpolation the shell's `t()` does (ADR-0055). */
function translate(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string {
  const path = key.split('.');
  let node: unknown = (catalog as Record<string, unknown>).es;
  for (const seg of path) node = (node as Record<string, unknown> | undefined)?.[seg];
  let text = typeof node === 'string' ? node : key;
  for (const [k, v] of Object.entries(params ?? {})) text = text.split(`{${k}}`).join(String(v));
  return text;
}

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  allowOverlapping = true;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.appointments.list':
          return [BOOKED, LATE];
        case 'appointments.appointments.conflicting':
          // The runtime's read: every live row of the same DAY for that professional. The
          // fine-grained window filtering is the caller's, exactly like the WASM handler's.
          return [BOOKED, LATE].filter((a) => a.staff_id === params.staff_id);
        case 'customers.list':
          return {
            rows: [
              { id: 'c1', name: 'Ana López', phone: '600111222', email: '' },
              { id: 'c2', name: 'Berta Ruiz', phone: '600333444', email: '' },
            ],
            total: 2,
          };
        case 'services.services.list':
          return {
            rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 }],
            total: 1,
          };
        case 'staff.members.list':
          return {
            rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1, color: '#7048e8' }],
            total: 1,
          };
        case 'appointments.settings.get':
          return [
            {
              calendar_start_hour: 8,
              calendar_end_hour: 20,
              slot_interval: 15,
              default_duration: 30,
              // The settings query publishes the flags as JSON booleans (appointments#79).
              allow_overlapping: allowOverlapping,
            },
          ];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return { ok: true };
    },
    on: () => () => {},
    locale: 'es',
    t: translate,
    notify: () => {},
  };
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).erplora;
});

type Wc = HTMLElement & {
  updateComplete: Promise<unknown>;
  shadowRoot: ShadowRoot;
  day: string;
  refresh: () => Promise<void>;
  newServiceId: string;
  newStaffId: string;
  newStart: string;
  newDuration: string;
  createAppointment: (ev: Event) => Promise<void>;
  rescheduleId: string;
  rescheduleStart: string;
  rescheduleDuration: string;
  openReschedule: (row: Record<string, unknown>) => Promise<void>;
  submitReschedule: (ev: Event) => Promise<void>;
  onEventMove: (ev: CustomEvent) => Promise<void>;
  /** The sentence naming the conflict; `''` while there is no prompt on screen. */
  overlapPrompt: string;
  confirmOverlap: () => void;
  cancelOverlap: () => void;
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  el.day = '2026-08-17';
  await el.refresh();
  await el.updateComplete;
  return el;
};

/** The agenda with Berta already chosen in the create panel's customer search (appointments#306):
 *  picking her is awaited HERE, so `startCreate` stays synchronous up to the save. */
const mountForCreate = async (): Promise<Wc> => {
  const el = await mount();
  await pickCustomer(el, 'appointments-list-customer', 'c2');
  return el;
};

/** Fills the rest of the create panel with a booking for Eva at `wall` and presses save WITHOUT
 *  awaiting: the prompt has to be answered before the promise settles. */
function startCreate(el: Wc, wall: string): Promise<void> {
  el.newServiceId = 'sv1';
  el.newStaffId = 's1';
  el.newStart = wall;
  el.newDuration = '30';
  return el.createAppointment(new Event('submit'));
}

/** Lets the pending read of `appointments.appointments.conflicting` resolve and the alert paint.
 *  `updateComplete` alone only covers the render, not the query the prompt is waiting on. */
const settle = async (el: Wc): Promise<void> => {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
};

const createsSent = (): number =>
  commands.filter((c) => c.name === 'appointments.appointments.create').length;

describe('appointments#86 · creating an overlapping appointment asks first', () => {
  it('with allow_overlapping ON the prompt names WHO and WHEN, and writes nothing yet', async () => {
    const el = await mountForCreate();
    const pending = startCreate(el, '2026-08-17T11:15');
    await settle(el);

    expect(el.overlapPrompt, 'an overlap must raise the Confirm/Cancel prompt').not.toBe('');
    expect(el.overlapPrompt, 'the prompt says WITH WHOM it overlaps').toContain('Ana López');
    expect(el.overlapPrompt, 'the prompt says at WHAT TIME').toContain('11:00');
    expect(createsSent(), 'nothing may be written before the receptionist answers').toBe(0);

    el.confirmOverlap();
    await pending;
    expect(createsSent(), 'accepting books the appointment').toBe(1);
    expect(el.overlapPrompt, 'the prompt closes once answered').toBe('');
  });

  it('cancelling writes nothing and keeps what was typed', async () => {
    const el = await mountForCreate();
    const pending = startCreate(el, '2026-08-17T11:15');
    await settle(el);
    el.cancelOverlap();
    await pending;

    expect(createsSent(), 'cancel must not send any command').toBe(0);
    expect(el.overlapPrompt).toBe('');
    expect(el.newStart, 'the panel keeps the slot so another one can be picked').toBe('2026-08-17T11:15');
  });

  it('with allow_overlapping OFF nothing changes: no prompt, the SERVER refuses', async () => {
    allowOverlapping = false;
    const el = await mountForCreate();
    await startCreate(el, '2026-08-17T11:15');
    await settle(el);

    expect(el.overlapPrompt, 'a prompt here would offer a choice the hub does not allow').toBe('');
    expect(createsSent(), 'the command flies and the overlap gate refuses it').toBe(1);
  });

  it('a slot with no conflict is booked without asking', async () => {
    const el = await mountForCreate();
    await startCreate(el, '2026-08-17T13:00');
    await settle(el);

    expect(el.overlapPrompt).toBe('');
    expect(createsSent()).toBe(1);
  });

  it('the conflict is read for the chosen professional and start (never the visible day)', async () => {
    const el = await mountForCreate();
    const pending = startCreate(el, '2026-08-17T11:15');
    await settle(el);
    const read = queries.filter((q) => q.name === 'appointments.appointments.conflicting').at(-1);
    expect(read, 'the overlap notice reads the module PUBLIC query, not the loaded page').toBeTruthy();
    expect(read!.params.staff_id).toBe('s1');
    expect(String(read!.params.start_datetime).slice(0, 16)).toBe('2026-08-17T11:15');
    el.cancelOverlap();
    await pending;
  });
});

describe('appointments#86 · moving an appointment onto an overlap asks too', () => {
  it('the appointment being moved never conflicts with itself', async () => {
    const el = await mount();
    await el.openReschedule(LATE as unknown as Record<string, unknown>);
    el.rescheduleStart = '2026-08-17T16:00';
    el.rescheduleDuration = '30';
    await el.submitReschedule(new Event('submit'));
    await settle(el);

    expect(el.overlapPrompt, 'a row cannot overlap itself').toBe('');
    expect(commands.filter((c) => c.name === 'appointments.appointments.reschedule').length).toBe(1);
  });

  it('moving onto ANOTHER appointment prompts, and accepting sends the move', async () => {
    const el = await mount();
    await el.openReschedule(LATE as unknown as Record<string, unknown>);
    el.rescheduleStart = '2026-08-17T11:15';
    el.rescheduleDuration = '30';
    const pending = el.submitReschedule(new Event('submit'));
    await settle(el);

    expect(el.overlapPrompt).toContain('Ana López');
    expect(commands.filter((c) => c.name === 'appointments.appointments.reschedule').length).toBe(0);
    el.confirmOverlap();
    await pending;
    expect(commands.filter((c) => c.name === 'appointments.appointments.reschedule').length).toBe(1);
  });
});

describe('appointments#86 · dragging onto an overlap asks, and cancelling REVERTS the block', () => {
  it('cancel puts the block back where it was and writes nothing', async () => {
    const el = await mount();
    let reverted = 0;
    const move = el.onEventMove(
      new CustomEvent('ok-event-move', {
        detail: {
          id: 'a2',
          resourceId: 's1',
          start: '11:15',
          end: '11:45',
          from: { resourceId: 's1', start: '16:00', end: '16:30' },
          revert: () => {
            reverted += 1;
          },
        },
      }),
    );
    await settle(el);
    expect(el.overlapPrompt).toContain('Ana López');
    el.cancelOverlap();
    await move;

    expect(reverted, 'a refused drag must go back to its slot').toBe(1);
    expect(commands.filter((c) => c.name === 'appointments.appointments.reschedule').length).toBe(0);
  });
});

describe('appointments#86 · the prompt is translated (ADR-0055: en source + its es)', () => {
  it('every new key exists in both catalogs', () => {
    for (const key of ['overlapTitle', 'overlapMessage', 'overlapConfirm', 'overlapCancel']) {
      expect((enLocale as { ui: Record<string, string> }).ui[key], `en.ui.${key}`).toBeTruthy();
      expect((esLocale as { ui: Record<string, string> }).ui[key], `es.ui.${key}`).toBeTruthy();
    }
    expect(
      (enLocale as { ui: Record<string, string> }).ui.overlapMessage,
      'the sentence must carry the conflicts, not a generic warning',
    ).toContain('{conflicts}');
  });
});
