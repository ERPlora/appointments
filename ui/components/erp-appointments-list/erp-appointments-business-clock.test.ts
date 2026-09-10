// appointments#12 — the agenda runs on the SALON's clock, on a tablet that is not.
//
// The other tests of this screen pin the device to the business zone so their assertions are
// about wiring. This one does the opposite on purpose: the device is in `Pacific/Auckland` (UTC+12)
// and the business in `Europe/Madrid` (UTC+2 in summer). Ten hours apart, so nothing here can pass
// because the two happened to agree.
//
// It is the case the field reported and the one Square took years to close: the zone followed the
// device, so a tablet set to another country painted the salon's day shifted and moved bookings
// that were already made.
process.env.TZ = 'Pacific/Auckland';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params: Record<string, unknown> }[] = [];

/** 09:30 in Madrid on a summer day (= 07:30Z). In Auckland that same instant reads 19:30. */
const MADRID_0930 = '2026-08-22T09:30:00+02:00';

const APPOINTMENTS = [
  {
    id: 'a1',
    customer_name: 'Ana López',
    service_name: 'Corte',
    staff_id: 's1',
    staff_name: 'Eva Pro',
    start_datetime: MADRID_0930,
    end_datetime: '2026-08-22T10:00:00+02:00',
    duration_minutes: 30,
    status: 'pending',
  },
];

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    // What the shell publishes from `/api/hub/context` (hub#1022): the zone the runtime resolved.
    timezone: 'Europe/Madrid',
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.appointments.list':
          return APPOINTMENTS;
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '600111222', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1, color: '#7048e8' }], total: 1 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 8, calendar_end_hour: 20, slot_interval: 15, default_duration: 30 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return { ok: true };
    },
    on: () => () => {},
    t: (cat: Record<string, { ui?: Record<string, string> }>, key: string) =>
      cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key,
    locale: 'es',
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
  view: string;
  newCustomerId: string;
  newServiceId: string;
  newStaffId: string;
  newStart: string;
  columns: { key: string; format?: (r: Record<string, unknown>) => string }[];
  schedulerEvents: { start: string; end: string }[];
  error: string;
  formError: string;
  refresh: () => Promise<void>;
  createAppointment: (e: Event) => Promise<void>;
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  el.day = '2026-08-22';
  await el.refresh();
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
};

describe('the device really is ten hours away (guard for the guard)', () => {
  it('the same instant reads 19:30 on the tablet and 09:30 in the salon', () => {
    expect(new Date(MADRID_0930).getHours()).toBe(19);
  });
});

describe('the agenda READS the salon clock', () => {
  it('the time column paints 09:30, not the tablet 19:30', async () => {
    const el = await mount();
    const column = el.columns.find((c) => c.key === 'start_datetime');
    expect(column?.format?.({ start_datetime: MADRID_0930 })).toBe('09:30');
  });

  it('the per-professional grid positions the block at 09:30', async () => {
    // `ok-scheduler` reads the `HH:MM` text literally: the tablet's 19:30 would drop the block
    // ten hours down the timeline, off the bottom of the working day.
    const el = await mount();
    el.view = 'staff';
    await el.updateComplete;
    expect(el.schedulerEvents[0]?.start).toBe('09:30');
    expect(el.schedulerEvents[0]?.end).toBe('10:00');
  });

  it('the day window asked of the server is the SALON day, not the tablet day', async () => {
    // 2026-08-22 in Madrid runs 21T22:00Z → 22T22:00Z. In Auckland it would be 21T12:00Z →
    // 22T12:00Z: half the salon's appointments outside the window and half of the day before in.
    const el = await mount();
    const list = queries.filter((q) => q.name === 'appointments.appointments.list').pop();
    expect(list?.params.day_start).toBe('2026-08-21T22:00:00.000Z');
    expect(list?.params.day_end).toBe('2026-08-22T22:00:00.000Z');
  });
});

describe('the agenda WRITES the salon clock', () => {
  it('booking 11:00 sends 11:00 with the salon offset, not the tablet one', async () => {
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newServiceId = 'sv1';
    el.newStaffId = 's1';
    el.newStart = '2026-08-22T11:00';
    await el.createAppointment(new Event('submit'));

    const sent = commands.find((c) => c.name === 'appointments.appointments.create');
    expect(sent, 'create was not dispatched').toBeTruthy();
    expect(sent!.payload.start_datetime).toBe('2026-08-22T11:00:00+02:00');
    // And the instant is the one the receptionist meant — 09:00 UTC, not 23:00 of the day before.
    expect(new Date(sent!.payload.start_datetime as string).toISOString()).toBe(
      '2026-08-22T09:00:00.000Z',
    );
  });

  it('🔴 a time the salon clock never shows is REFUSED, and the appointment is not sent', async () => {
    // 2026-03-29 02:30 does not exist in Madrid. Every naive path stores 01:30 or 03:30 instead.
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newServiceId = 'sv1';
    el.newStaffId = 's1';
    el.newStart = '2026-03-29T02:30';
    await el.createAppointment(new Event('submit'));

    expect(commands.find((c) => c.name === 'appointments.appointments.create')).toBeFalsy();
    // Since appointments#155 a CREATE refusal is painted inside the create form, not in the list
    // banner behind it: the panel covers the list, so `error` was a message nobody read. The
    // sentence is the same one; what moved is where it is shown.
    expect(el.formError, 'the refusal must be readable, not a raw stack').toBe(
      'Esa hora no existe en el reloj del negocio: el cambio de hora la salta. Elige otra.',
    );
    await el.updateComplete;
    expect(
      el.shadowRoot.querySelector('form[data-mode="create"] ok-inline-feedback[tone="danger"]'),
      'the refusal must be painted where the receptionist is looking: inside the form',
    ).toBeTruthy();
  });
});

describe('the receptionist is TOLD the tablet is on another clock', () => {
  it('paints the mismatch notice with both zones', async () => {
    const el = await mount();
    const notice = el.shadowRoot.querySelector('ok-inline-feedback[tone="warning"]');
    expect(notice, 'no notice: a tablet on another clock is a silent trap').toBeTruthy();
    expect(notice!.textContent).toContain('Europe/Madrid');
  });

  it('says nothing when the tablet agrees with the salon', async () => {
    (globalThis as Record<string, unknown> & { erplora: { timezone: string } }).erplora.timezone =
      'Pacific/Auckland';
    const el = await mount();
    expect(el.shadowRoot.querySelector('ok-inline-feedback[tone="warning"]')).toBeFalsy();
  });
});
