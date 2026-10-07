// appointments#272 — the agenda proposes the PROFESSIONAL's own length for a service.
//
// staff#9 lets a professional take longer (or shorter) than the catalogue for a service: a colour
// that is 90 min in the catalogue takes Eva 120. The commands already honour it, but only when the
// payload does NOT carry `duration_minutes` — and the agenda always sends the minutes it pre-filled
// from the catalogue, so by screen the override never applied: the appointment was booked short and
// Eva's agenda showed a gap she does not have. Fresha, Booksy and Square fill the minutes with the
// team member's own duration and recompute them when the team member changes.
//
// The proposal is `staff.services.eligible_for_service` → `custom_duration` for the picked
// professional, else the catalogue — the same rule `resolve_handover` applies server-side. This
// file pins it on both forms (create and the appointment sheet):
//
//   1. picking the service with the professional already chosen proposes her length;
//   2. changing the professional re-proposes (hers, or the catalogue when she has none);
//   3. the proposed length is the one that travels;
//   4. opening the sheet keeps the stored length (nothing changed yet);
//   5. a length typed while the override is loading is not overwritten;
//   6. a failed read falls back to the catalogue AND says so.
import { beforeEach, describe, expect, it } from 'vitest';
import { pickCustomer } from '../../test/pick-customer';

process.env.TZ = 'Europe/Madrid';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params?: Record<string, unknown> }[] = [];
let eligibleFails = false;
let eligibleGate: Promise<void> | null = null;

/** sv2 (Colour, 90 min in the catalogue) takes Eva (s1) 120 min; Luis (s2) has no override. */
const ELIGIBLE: Record<string, unknown[]> = {
  sv1: [
    { staff_id: 's1', full_name: 'Eva Pro', custom_duration: null, custom_price: null, is_primary: 1 },
    { staff_id: 's2', full_name: 'Luis Back', custom_duration: 45, custom_price: null, is_primary: 0 },
  ],
  sv2: [
    { staff_id: 's1', full_name: 'Eva Pro', custom_duration: 120, custom_price: null, is_primary: 1 },
    { staff_id: 's2', full_name: 'Luis Back', custom_duration: null, custom_price: null, is_primary: 0 },
  ],
};

const APPOINTMENT = {
  id: 'a1',
  appointment_number: 'APT-1',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Haircut',
  service_price: 2000,
  staff_id: 's1',
  staff_name: 'Eva Pro',
  start_datetime: new Date(2026, 7, 7, 10, 0).toISOString(),
  end_datetime: new Date(2026, 7, 7, 10, 40).toISOString(),
  duration_minutes: 40,
  status: 'confirmed',
};

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  eligibleFails = false;
  eligibleGate = null;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
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
            ],
            total: 2,
          };
        case 'staff.services.eligible_for_service':
          if (eligibleGate) await eligibleGate;
          if (eligibleFails) throw new Error('forbidden');
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
  newStart: string;
  newDuration: string;
  rescheduleDuration: string;
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

describe('the create form proposes the professional’s own length (appointments#272)', () => {
  it('picking the service with the professional already chosen proposes HER length', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(el.newDuration, 'Eva takes 120 min for a colour, not the 90 of the catalogue').toBe('120');
    const asked = queries.filter((q) => q.name === 'staff.services.eligible_for_service');
    expect(asked.at(-1)?.params, 'the override is read for the picked service').toEqual({ service_id: 'sv2' });
  });

  it('changing the professional re-proposes: hers, or the catalogue when she has none', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    expect(el.newDuration, 'no professional yet: the catalogue').toBe('90');
    await pick(el, createForm(el), 'staff', 's1');
    expect(el.newDuration, 'Eva picked: her 120').toBe('120');
    await pick(el, createForm(el), 'staff', 's2');
    expect(el.newDuration, 'Luis has no override: back to the catalogue').toBe('90');
  });

  it('the proposed length is the one the create command receives', async () => {
    const el = await mount();
    await pickCustomer(el, 'appointments-list-customer', 'c1');
    el.newStart = '2026-08-07T10:00';
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv2');
    await el.createAppointment(new Event('submit'));
    const sent = commands.find((c) => c.name === 'appointments.appointments.create')?.payload;
    expect(sent?.duration_minutes, 'the override must reach the booking, not just the field').toBe(120);
  });

  it('a length typed while the override is loading is not overwritten', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's1');
    let release!: () => void;
    eligibleGate = new Promise<void>((r) => (release = r));
    await pick(el, createForm(el), 'service', 'sv2');
    el.newDuration = '75'; // the receptionist types the exception before the answer arrives
    release();
    await settle(el);
    expect(el.newDuration, 'what the person typed is the exception and wins').toBe('75');
  });

  it('a late answer for the professional picked BEFORE does not land on the one picked now', async () => {
    const el = await mount();
    let release!: () => void;
    eligibleGate = new Promise<void>((r) => (release = r));
    await pick(el, createForm(el), 'service', 'sv2');
    await pick(el, createForm(el), 'staff', 's1'); // Eva's 120 is on its way…
    await pick(el, createForm(el), 'staff', 's2'); // …but Luis is the one picked now
    release();
    await settle(el);
    expect(el.newDuration, 'Luis has no override: Eva’s answer must not be applied to him').toBe('90');
  });

  it('a failed read falls back to the catalogue and says so', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(el.newDuration, 'the catalogue is still a usable proposal').toBe('90');
    expect(
      createForm(el).querySelector('[data-testid="appointments-list-staff-duration-unavailable"]'),
      'the person must know the professional’s own length could not be read',
    ).toBeTruthy();
  });

  it('a failed read is asked again on the next pick, not remembered as the answer', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv2');
    eligibleFails = false;
    await pick(el, createForm(el), 'staff', 's2');
    await pick(el, createForm(el), 'staff', 's1');
    expect(el.newDuration, 'once the read works, Eva’s 120 is proposed').toBe('120');
    expect(
      createForm(el).querySelector('[data-testid="appointments-list-staff-duration-unavailable"]'),
      'and the warning is gone',
    ).toBeNull();
  });
});

describe('the appointment sheet proposes the professional’s own length (appointments#272)', () => {
  it('opening the sheet keeps the stored length', async () => {
    const el = await mount();
    await openSheet(el, APPOINTMENT);
    expect(el.rescheduleDuration, 'nothing was changed: the appointment keeps its 40 min').toBe('40');
  });

  it('a new service proposes the length of the professional of the sheet', async () => {
    const el = await mount();
    await openSheet(el, APPOINTMENT);
    await pick(el, sheet(el), 'reschedule-service', 'sv2');
    expect(el.rescheduleDuration, 'Eva takes 120 min for a colour').toBe('120');
  });

  it('a new professional proposes HER length for the service, and it travels', async () => {
    const el = await mount();
    await openSheet(el, APPOINTMENT);
    await pick(el, sheet(el), 'reschedule-staff', 's2');
    expect(el.rescheduleDuration, 'Luis takes 45 min for a haircut').toBe('45');
    await pick(el, sheet(el), 'reschedule-staff', 's1');
    expect(el.rescheduleDuration, 'Eva has no override for a haircut: the catalogue').toBe('30');
    await pick(el, sheet(el), 'reschedule-staff', 's2');
    await el.submitReschedule(new Event('submit'));
    const sent = commands.find((c) => c.name === 'appointments.appointments.reschedule')?.payload;
    expect(sent?.duration_minutes).toBe(45);
  });
});

describe('the other ways in and out of the forms (appointments#272)', () => {
  const warning = (form: Element) =>
    form.querySelector('[data-testid="appointments-list-staff-duration-unavailable"]');

  it('a tap on a free slot of the timeline proposes the length of THAT professional', async () => {
    const el = await mount();
    await pick(el, createForm(el), 'service', 'sv2');
    await el.onSlotClick(new CustomEvent('slotClick', { detail: { resourceId: 's1', time: '11:00' } }));
    await settle(el);
    expect(el.newDuration, 'the slot was Eva’s: her 120, not the 90 of the catalogue').toBe('120');
  });

  it('picking the professional before the service keeps the minutes already typed', async () => {
    const el = await mount();
    el.newDuration = '50';
    await pick(el, createForm(el), 'staff', 's1');
    expect(el.newDuration, 'no service yet: there is nothing to propose, so nothing is wiped').toBe('50');
  });

  it('a booking saved with the warning showing leaves a clean form for the next one', async () => {
    eligibleFails = true;
    const el = await mount();
    await pickCustomer(el, 'appointments-list-customer', 'c1');
    el.newStart = '2026-08-07T10:00';
    await pick(el, createForm(el), 'staff', 's1');
    await pick(el, createForm(el), 'service', 'sv2');
    expect(warning(createForm(el)), 'the read failed: the form says so').toBeTruthy();
    await el.createAppointment(new Event('submit'));
    await settle(el);
    expect(warning(createForm(el)), 'the warning was about the booking just saved').toBeNull();
  });

  it('a sheet closed with the warning showing opens clean the next time', async () => {
    eligibleFails = true;
    const el = await mount();
    await openSheet(el, APPOINTMENT);
    await pick(el, sheet(el), 'reschedule-service', 'sv2');
    expect(warning(sheet(el)), 'the read failed: the sheet says so').toBeTruthy();
    (sheet(el).querySelector('[data-testid="appointments-list-reschedule-cancel"]') as HTMLElement).click();
    await settle(el);
    await openSheet(el, APPOINTMENT);
    expect(warning(sheet(el)), 'nothing was asked on this opening: no warning').toBeNull();
  });
});
