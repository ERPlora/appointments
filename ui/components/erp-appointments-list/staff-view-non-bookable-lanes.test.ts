// appointments#334 — in «By professional», the appointments of a professional who no longer takes
// bookings stay on the day, on a lane of her own that says she is not bookable.
//
// Regression: the lanes were only the bookable professionals plus «Unassigned». `ok-scheduler`
// only paints the events of the lanes it gets, so when a professional was switched to «not
// bookable» in Staff (or left the team) every appointment she already had vanished from the
// grid — still listed in «List», but in «By professional» the slot looked free, inviting a
// booking on top of it and hiding the appointments that need handing over to someone else.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const EVA = { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 };
const BEA = { id: 's2', full_name: 'Bea Pro', status: 'active', is_bookable: 1 };
const LUIS = { id: 's3', full_name: 'Luis Pro', status: 'active', is_bookable: 1 };

const appointment = (id: string, staffId: string, staffName: string, hour: number) => ({
  id,
  appointment_number: `APT-${id}`,
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Haircut',
  staff_id: staffId,
  staff_name: staffName,
  start_datetime: `2026-08-07T${String(hour).padStart(2, '0')}:00:00.000Z`,
  end_datetime: `2026-08-07T${String(hour).padStart(2, '0')}:30:00.000Z`,
  duration_minutes: 30,
  status: 'confirmed',
});

let staffRows: unknown[];
let dayRows: unknown[];

beforeEach(() => {
  staffRows = [EVA, BEA, LUIS];
  dayRows = [appointment('a1', 's1', 'Eva Pro', 8), appointment('a2', 's2', 'Bea Pro', 9)];
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return dayRows;
        case 'staff.members.list':
          return { rows: staffRows, total: staffRows.length };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 30 }];
        default:
          return [];
      }
    },
    command: async () => ({ ok: true }),
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    // The key AND what it was given: a lane label must name the professional through the catalog.
    t: (_catalog: unknown, key: string, params?: Record<string, unknown>) =>
      params ? `${key}(${Object.values(params).join(',')})` : key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  updateComplete: Promise<unknown>;
  view: string;
  newStaffId: string;
  newStart: string;
  onSlotClick: (ev: CustomEvent<{ resourceId: string; time: string }>) => Promise<void>;
};

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mountStaffView(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  el.view = 'staff';
  await settle(el);
  return el;
}

type Lane = { id: string; label: string };
type Scheduler = HTMLElement & { resources: Lane[]; events: { id: string; resourceId: string }[] };
const scheduler = (el: Wc) => el.shadowRoot.querySelector('ok-scheduler') as Scheduler;
const lane = (el: Wc, id: string) => scheduler(el).resources.find((r) => r.id === id);
const laneOf = (el: Wc, appointmentId: string) => scheduler(el).events.find((e) => e.id === appointmentId)?.resourceId;

describe('appointments#334 — appointments of a professional who is no longer bookable stay in «By professional»', () => {
  it('a professional switched to «not bookable» keeps a lane with her appointment, marked as not bookable', async () => {
    staffRows = [EVA, { ...BEA, is_bookable: 0 }, LUIS];
    // The appointment keeps the name it was booked with; the lane shows her name as Staff has it now.
    dayRows = [dayRows[0], appointment('a2', 's2', 'Bea Old-Name', 9)];
    const el = await mountStaffView();

    expect(laneOf(el, 'a2'), 'her appointment sits on her own lane').toBe('s2');
    expect(lane(el, 's2'), 'her lane is painted').toBeTruthy();
    expect(lane(el, 's2')!.label, 'the lane says who and that she takes no new bookings').toBe('ui.staffLaneNotBookable(Bea Pro)');
    expect(lane(el, 's1')!.label, 'a bookable professional keeps her plain name').toBe('Eva Pro');
  });

  it('a professional who left the team keeps a lane with her appointment, marked as having left', async () => {
    staffRows = [EVA, { ...BEA, status: 'terminated' }, LUIS];
    const el = await mountStaffView();

    expect(laneOf(el, 'a2')).toBe('s2');
    expect(lane(el, 's2')!.label).toBe('ui.staffLaneLeft(Bea Pro)');
  });

  // In Staff, «terminate» (`staff.members.delete`) is the only way out of `staff.members.list`: it
  // soft-deletes the member, so the list no longer returns her and the appointment's own copy of
  // her name is all that is left.
  it('a professional the staff list no longer returns has left the team: her lane is named after the appointment', async () => {
    staffRows = [EVA, LUIS];
    const el = await mountStaffView();

    expect(laneOf(el, 'a2')).toBe('s2');
    expect(lane(el, 's2')!.label).toBe('ui.staffLaneLeft(Bea Pro)');
  });

  it('every appointment of the day lands on a painted lane', async () => {
    staffRows = [{ ...EVA, is_bookable: 0 }, { ...BEA, status: 'terminated' }];
    dayRows = [...dayRows, appointment('a3', 's9', 'Gone Pro', 11), appointment('a4', '', '', 12)];
    const el = await mountStaffView();

    expect(scheduler(el).resources.map((r) => r.id), 'one lane per professional with appointments, none for «nobody»').toEqual(['s1', 's2', 's9', 'unassigned']);
    const painted = new Set(scheduler(el).resources.map((r) => r.id));
    for (const e of scheduler(el).events) expect(painted.has(e.resourceId), `${e.id} on ${e.resourceId}`).toBe(true);
    expect(laneOf(el, 'a4'), 'without a professional it stays unassigned').toBe('unassigned');
  });

  it('two appointments of the same professional share one lane', async () => {
    staffRows = [EVA, LUIS];
    dayRows = [...dayRows, appointment('a3', 's2', 'Bea Pro', 12)];
    const el = await mountStaffView();

    expect(scheduler(el).resources.filter((r) => r.id === 's2')).toHaveLength(1);
    expect(laneOf(el, 'a3')).toBe('s2');
  });

  it('a professional who is not bookable and has nothing that day gets no lane', async () => {
    staffRows = [EVA, BEA, { ...LUIS, is_bookable: 0 }];
    const el = await mountStaffView();
    expect(scheduler(el).resources.map((r) => r.id)).toEqual(['s1', 's2', 'unassigned']);
  });

  it('the bookable team comes first, then the lanes kept for their appointments, then «Unassigned»', async () => {
    staffRows = [{ ...EVA, is_bookable: 0 }, BEA, LUIS];
    const el = await mountStaffView();
    expect(scheduler(el).resources.map((r) => r.id)).toEqual(['s2', 's3', 's1', 'unassigned']);
  });

  it('tapping a free slot on her lane books the hour, not her: she takes no new appointments', async () => {
    staffRows = [EVA, { ...BEA, is_bookable: 0 }, LUIS];
    const el = await mountStaffView();

    await el.onSlotClick(new CustomEvent('ok-slot-click', { detail: { resourceId: 's2', time: '11:00' } }));
    await settle(el);

    expect(el.newStaffId, 'the create form does not preselect someone it cannot offer').toBe('');
    expect(el.newStart, 'the tapped hour is kept').toMatch(/T11:00$/);
  });

  it('every lane label has its en and its es, with the name', () => {
    const en = (enLocale as { ui: Record<string, string> }).ui;
    const es = (esLocale as { ui: Record<string, string> }).ui;
    for (const key of ['staffLaneNotBookable', 'staffLaneLeft']) {
      expect(en[key], `en ${key}`).toContain('{name}');
      expect(es[key], `es ${key}`).toContain('{name}');
      expect(es[key], `es ${key} is translated`).not.toBe(en[key]);
    }
  });
});
