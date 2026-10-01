// appointments#279 — the professional picker only offers who PERFORMS the chosen service.
//
// Until now the create form and the appointment sheet listed every bookable team member whatever
// the service: the receptionist picked service and professional, filled the rest, pressed save…
// and only then read «That professional does not perform this service». Fresha, Booksy and Square
// only offer, for the chosen service, the team members who do it.
//
// The picker applies the server's own rule (`resolve_professional`, staff#9) on the same read
// `staff.services.eligible_for_service` the server judges with:
//
//   1. no service yet → the whole bookable team;
//   2. a service WITH declared competencies → only those professionals;
//   3. a service with none → the whole team (the hub has not narrowed it, the server accepts anyone);
//   4. a service the chosen professional does not do → she is cleared, and the form says why;
//   5. a slot tapped on the timeline for a professional who does not do the chosen service → the
//      service is the stale choice: it is cleared, and the form says why;
//   6. a failed read → the whole team (the server still judges on save), and the form says so;
//   7. a late answer for a service picked BEFORE never narrows the list of the one picked now;
//   8. the sheet keeps showing the professional the appointment has, even if no longer eligible.
import { beforeEach, describe, expect, it } from 'vitest';

process.env.TZ = 'Europe/Madrid';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
let eligibleFails = false;
/** Services whose eligibility read fails, on top of `eligibleFails`. */
const eligibleFailsFor = new Set<string>();
let eligibleGate: Promise<void> | null = null;

/** sv1 (Haircut) has no declared competencies; sv2 (Colour) is only Eva's (s1). */
const ELIGIBLE: Record<string, unknown[]> = {
  sv1: [],
  sv2: [{ staff_id: 's1', full_name: 'Eva Pro', custom_duration: null, custom_price: null, is_primary: 1 }],
};

const APPOINTMENT = {
  id: 'a1',
  appointment_number: 'APT-1',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Haircut',
  service_price: 2000,
  staff_id: 's2',
  staff_name: 'Luis Back',
  start_datetime: new Date(2026, 7, 7, 10, 0).toISOString(),
  end_datetime: new Date(2026, 7, 7, 10, 30).toISOString(),
  duration_minutes: 30,
  status: 'confirmed',
};

beforeEach(() => {
  commands.length = 0;
  eligibleFails = false;
  eligibleFailsFor.clear();
  eligibleGate = null;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      switch (name) {
        case 'appointments.appointments.list':
          return [APPOINTMENT];
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López' }], total: 1 };
        case 'services.services.list':
          return {
            rows: [
              { id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 },
              { id: 'sv2', name: 'Colour', price: 4500, duration_minutes: 90, is_bookable: 1 },
            ],
            total: 2,
          };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Luis Back', status: 'active', is_bookable: 1 },
              { id: 's3', full_name: 'Marta Office', status: 'active', is_bookable: 0 },
            ],
            total: 3,
          };
        case 'staff.services.eligible_for_service':
          if (eligibleGate) await eligibleGate;
          if (eligibleFails || eligibleFailsFor.has(String(params?.service_id))) throw new Error('forbidden');
          return ELIGIBLE[String(params?.service_id)] ?? [];
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60, allow_overlapping: false }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  newCustomerId: string;
  newServiceId: string;
  newStaffId: string;
  newStart: string;
  newDuration: string;
  rescheduleStaffId: string;
  rescheduleServiceId: string;
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  createAppointment: (ev: Event) => Promise<void>;
  submitReschedule: (ev: Event) => Promise<void>;
  onSlotClick: (ev: CustomEvent<{ resourceId: string; time: string }>) => Promise<void>;
  updateComplete: Promise<unknown>;
};

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount() {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  await settle(el as Wc);
  return el as Wc;
}

const createForm = (el: Wc) => el.shadowRoot.querySelector('form[data-mode="create"]')!;
const sheet = (el: Wc) => el.shadowRoot.querySelector('form[data-mode="reschedule"]')!;

/** The professionals the picker offers, by id, in order. */
const offered = (form: Element, role: string): string[] =>
  [...form.querySelectorAll(`ion-select[data-role="${role}"] ion-select-option`)].map(
    (o) => (o as HTMLElement & { value: string }).value,
  );

const notice = (form: Element, id: string) => form.querySelector(`[data-testid="appointments-list-${id}"]`);

async function pick(el: Wc, form: Element, role: string, value: string) {
  const select = form.querySelector(`ion-select[data-role="${role}"]`) as HTMLElement & { value: string };
  select.value = value;
  select.dispatchEvent(new CustomEvent('ionChange', { detail: { value } }));
  await settle(el);
}

async function openSheet(el: Wc, row: Record<string, unknown>) {
  await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row } }));
  await settle(el);
}

describe('the create form only offers who performs the service (appointments#279)', () => {
  it('without a service, the whole bookable team is offered', async () => {
    const el = await mount();
    expect(offered(createForm(el), 'staff'), 'Marta is not bookable; Eva and Luis are').toEqual(['s1', 's2']);
  });

  it('a service with declared competencies offers only those professionals', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    expect(offered(createForm(el), 'staff'), 'only Eva does colours').toEqual(['s1']);
  });

  it('a service with no declared competencies offers the whole team, as the server accepts', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    await pick(el, createForm(el), 'service', 'sv1');
    expect(offered(createForm(el), 'staff'), 'nobody narrowed haircuts: everyone').toEqual(['s1', 's2']);
  });

  it('switching to a service the chosen professional does not do clears her and says why', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(el.newStaffId, 'Luis does not do colours: he cannot stay chosen').toBe('');
    expect(notice(createForm(el), 'staff-not-for-service'), 'the form says why he went').toBeTruthy();
    await pick(el, createForm(el), 'staff', 's1');
    expect(el.newStaffId).toBe('s1');
    expect(notice(createForm(el), 'staff-not-for-service'), 'a professional was picked again').toBeNull();
  });

  it('a professional who does the new service stays chosen, without any notice', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(el.newStaffId).toBe('s1');
    expect(notice(createForm(el), 'staff-not-for-service')).toBeNull();
  });

  it('a failed read offers the whole team, keeps the choice, and says the check could not be done', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(offered(createForm(el), 'staff'), 'the server still judges on save').toEqual(['s1', 's2']);
    expect(el.newStaffId, 'nothing is cleared on a guess').toBe('s2');
    expect(notice(createForm(el), 'eligible-staff-unavailable'), 'the person must know').toBeTruthy();
  });

  it('a failed read is asked again on the next service pick', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    eligibleFails = false;
    await pick(el, createForm(el), 'service', 'sv1');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(offered(createForm(el), 'staff')).toEqual(['s1']);
    expect(notice(createForm(el), 'eligible-staff-unavailable')).toBeNull();
  });

  it('a late answer for the service picked BEFORE never narrows the one picked now', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's2');
    let release!: () => void;
    eligibleGate = new Promise<void>((r) => (release = r));
    await pick(el, createForm(el), 'service', 'sv2'); // colours (only Eva) on its way…
    await pick(el, createForm(el), 'service', 'sv1'); // …but haircut is the one picked now
    release();
    await settle(el);
    expect(offered(createForm(el), 'staff'), 'haircut is everyone’s').toEqual(['s1', 's2']);
    expect(el.newStaffId, 'Luis does haircuts: the stale answer must not clear him').toBe('s2');
    expect(notice(createForm(el), 'staff-not-for-service')).toBeNull();
  });

  it('a slot of a professional who does not do the chosen service clears the SERVICE and says why', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    await el.onSlotClick(new CustomEvent('slotClick', { detail: { resourceId: 's2', time: '11:00' } }));
    await settle(el);
    expect(el.newStaffId, 'the tapped slot is Luis’s: the latest choice stays').toBe('s2');
    expect(el.newServiceId, 'colours were the stale choice').toBe('');
    expect(notice(createForm(el), 'service-not-for-staff')).toBeTruthy();
    expect(offered(createForm(el), 'staff'), 'no service: the whole team again').toEqual(['s1', 's2']);
  });

  it('a slot of a professional who does the chosen service keeps both', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    await el.onSlotClick(new CustomEvent('slotClick', { detail: { resourceId: 's1', time: '11:00' } }));
    await settle(el);
    expect(el.newStaffId).toBe('s1');
    expect(el.newServiceId).toBe('sv2');
    expect(notice(createForm(el), 'service-not-for-staff')).toBeNull();
  });

  it('a booking saved leaves a clean form: no notice, the whole team', async () => {
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newStart = '2026-08-07T10:00';
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'service', 'sv2');
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv1');
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'service', 'sv2'); // Luis cleared again, notice on screen
    await pick(el, createForm(el), 'staff', 's1');
    await el.createAppointment(new Event('submit'));
    await settle(el);
    expect(commands.find((c) => c.name === 'appointments.appointments.create')?.payload.staff_id).toBe('s1');
    expect(offered(createForm(el), 'staff'), 'the next booking starts without a service').toEqual(['s1', 's2']);
  });

  it('the notice of a booking saved does not survive into the next one', async () => {
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newStart = '2026-08-07T10:00';
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(notice(createForm(el), 'staff-not-for-service')).toBeTruthy();
    el.newStaffId = 's1'; // set without the picker: the notice is still on screen
    await settle(el);
    await el.createAppointment(new Event('submit'));
    await settle(el);
    expect(notice(createForm(el), 'staff-not-for-service')).toBeNull();
  });

  it('while the new service is being checked, the list of the previous service is not offered', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    expect(offered(createForm(el), 'staff')).toEqual(['s1']);
    let release!: () => void;
    eligibleGate = new Promise((r) => (release = r));
    await pick(el, createForm(el), 'service', 'sv1');
    expect(offered(createForm(el), 'staff'), 'colours’ list is not the answer for haircuts').toEqual(['s1', 's2']);
    release();
    await settle(el);
    expect(offered(createForm(el), 'staff')).toEqual(['s1', 's2']);
  });

  it('a failed read for the service picked BEFORE never says the one picked now could not be checked', async () => {
    const el = await mount();
    let release!: () => void;
    eligibleGate = new Promise((r) => (release = r));
    eligibleFailsFor.add('sv2');
    await pick(el, createForm(el), 'service', 'sv2');
    await pick(el, createForm(el), 'service', 'sv1');
    release();
    await settle(el);
    expect(notice(createForm(el), 'eligible-staff-unavailable'), 'haircuts were checked fine').toBeNull();
  });

  it('a slot that clears the service also clears the minutes that service proposed', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    expect(el.newDuration).toBe('90');
    await el.onSlotClick(new CustomEvent('slotClick', { detail: { resourceId: 's2', time: '11:00' } }));
    await settle(el);
    expect(el.newServiceId).toBe('');
    expect(el.newDuration, 'no service, no colour minutes left behind').toBe('');
  });

  it('a booking saved after a failed check does not carry the warning into the next one', async () => {
    eligibleFails = true;
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newStart = '2026-08-07T10:00';
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(notice(createForm(el), 'eligible-staff-unavailable')).toBeTruthy();
    await el.createAppointment(new Event('submit'));
    await settle(el);
    expect(commands.some((c) => c.name === 'appointments.appointments.create')).toBe(true);
    expect(notice(createForm(el), 'eligible-staff-unavailable')).toBeNull();
  });

  it('an answer that arrives after the booking was saved never narrows the clean form', async () => {
    const el = await mount();
    el.newCustomerId = 'c1';
    el.newStart = '2026-08-07T10:00';
    await pick(el, createForm(el), 'staff', 's1');
    let release!: () => void;
    eligibleGate = new Promise((r) => (release = r));
    await pick(el, createForm(el), 'service', 'sv2');
    await el.createAppointment(new Event('submit'));
    await settle(el);
    expect(commands.some((c) => c.name === 'appointments.appointments.create')).toBe(true);
    release();
    await settle(el);
    expect(offered(createForm(el), 'staff'), 'the next booking has no service yet').toEqual(['s1', 's2']);
  });
});

describe('the appointment sheet only offers who performs the service (appointments#279)', () => {
  it('opening the sheet narrows the list to the service of the appointment', async () => {
    const el = await mount();
    await openSheet(el, { ...APPOINTMENT, service_id: 'sv2', service_name: 'Colour', staff_id: 's1', staff_name: 'Eva Pro' });
    expect(offered(sheet(el), 'reschedule-staff'), 'only Eva does colours').toEqual(['s1']);
  });

  it('the professional the appointment has stays on screen even if she no longer does the service', async () => {
    const el = await mount();
    await openSheet(el, { ...APPOINTMENT, service_id: 'sv2', service_name: 'Colour' }); // Luis, colours: legacy
    expect(el.rescheduleStaffId, 'opening changes nothing').toBe('s2');
    expect(offered(sheet(el), 'reschedule-staff'), 'his name stays as the current value').toEqual(['s2', 's1']);
    expect(notice(sheet(el), 'staff-not-for-service'), 'nothing was changed: no notice').toBeNull();
  });

  it('a new service the professional does not do clears her, says why, and the handover travels', async () => {
    const el = await mount();
    await openSheet(el, APPOINTMENT); // Luis, haircut
    await pick(el, sheet(el), 'reschedule-service', 'sv2');
    expect(el.rescheduleStaffId, 'Luis does not do colours').toBe('');
    expect(notice(sheet(el), 'staff-not-for-service')).toBeTruthy();
    expect(offered(sheet(el), 'reschedule-staff')).toEqual(['s1']);
    expect(notice(sheet(el), 'reschedule-needs-staff'), 'one notice says it, not two').toBeNull();
    await pick(el, sheet(el), 'reschedule-staff', 's1');
    expect(notice(sheet(el), 'staff-not-for-service')).toBeNull();
    await el.submitReschedule(new Event('submit'));
    const sent = commands.find((c) => c.name === 'appointments.appointments.reschedule')?.payload;
    expect(sent?.staff_id).toBe('s1');
    expect(sent?.service_id).toBe('sv2');
  });

  it('a sheet closed with the notice showing opens clean the next time', async () => {
    const el = await mount();
    await openSheet(el, APPOINTMENT);
    await pick(el, sheet(el), 'reschedule-service', 'sv2');
    expect(notice(sheet(el), 'staff-not-for-service')).toBeTruthy();
    (sheet(el).querySelector('[data-testid="appointments-list-reschedule-cancel"]') as HTMLElement).click();
    await settle(el);
    await openSheet(el, APPOINTMENT);
    expect(notice(sheet(el), 'staff-not-for-service')).toBeNull();
    expect(offered(sheet(el), 'reschedule-staff'), 'haircut: the whole team').toEqual(['s1', 's2']);
  });

  it('a failed read on the sheet offers the whole team and says so', async () => {
    eligibleFails = true;
    const el = await mount();
    await openSheet(el, APPOINTMENT);
    await pick(el, sheet(el), 'reschedule-service', 'sv2');
    expect(el.rescheduleStaffId, 'nothing is cleared on a guess').toBe('s2');
    expect(offered(sheet(el), 'reschedule-staff')).toEqual(['s1', 's2']);
    expect(notice(sheet(el), 'eligible-staff-unavailable')).toBeTruthy();
  });
});
