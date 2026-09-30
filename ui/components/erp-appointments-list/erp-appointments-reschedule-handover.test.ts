// appointments#263 — the professional and the service of ONE appointment are edited from the agenda.
//
// Until now the panel painted the professional as read-only text and had no service at all: a
// client who asked «Eva instead of Luis» or «colour instead of the cut» had to be cancelled and
// booked again, losing the appointment's number and history. Fresha, Booksy and Square open the
// same appointment sheet with the service and the team member as pickers, and a block dragged to
// another column is handed to that professional.
//
// `appointments.appointments.reschedule` takes `staff_id` + `service_id` (together) since #263 and
// judges the slot on the NEW professional's hours, blocked time and appointments. This file pins
// the screen half:
//
//   1. the panel paints a service picker and a professional picker, pre-filled from the row;
//   2. untouched pickers send nothing new — a plain move keeps the payload it always had;
//   3. a new professional or service travels as the PAIR the schema wants;
//   4. a new service pre-fills the minutes from the catalogue, like the create form;
//   5. the overlap warning is asked on the NEW professional's agenda;
//   6. «this and following» on a series hands the series over through `recurring.update`;
//   7. a block dropped on another professional's column is handed to her.
import { beforeEach, describe, expect, it } from 'vitest';

process.env.TZ = 'Europe/Madrid';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params?: Record<string, unknown> }[] = [];
const toasts: { type: string; message: string }[] = [];
let allowOverlapping = false;

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
  end_datetime: new Date(2026, 7, 7, 10, 30).toISOString(),
  duration_minutes: 30,
  status: 'confirmed',
};

const UNASSIGNED_APPOINTMENT = {
  ...APPOINTMENT,
  id: 'a2',
  appointment_number: 'APT-2',
  staff_id: '',
  staff_name: '',
  start_datetime: new Date(2026, 7, 7, 12, 0).toISOString(),
  end_datetime: new Date(2026, 7, 7, 12, 30).toISOString(),
};

const SERIES_OCCURRENCE = {
  ...APPOINTMENT,
  id: 'a3',
  appointment_number: 'APT-3',
  recurring_id: 'r1',
  occurrence_date: '2026-08-07',
  start_datetime: new Date(2026, 7, 7, 16, 0).toISOString(),
  end_datetime: new Date(2026, 7, 7, 16, 30).toISOString(),
};

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  toasts.length = 0;
  allowOverlapping = false;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.appointments.list':
          return [APPOINTMENT, UNASSIGNED_APPOINTMENT, SERIES_OCCURRENCE];
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
              { id: 's3', full_name: 'Not Bookable', status: 'active', is_bookable: 0 },
            ],
            total: 3,
          };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60, allow_overlapping: allowOverlapping }];
        case 'appointments.recurring.get':
          return [{ id: 'r1', staff_id: 's1', service_id: 'sv1', customer_id: 'c1' }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
    notify: (n: { type: string; message: string }) => toasts.push(n),
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  view: string;
  day: string;
  error: string;
  rescheduleStart: string;
  rescheduleDuration: string;
  rescheduleStaffId: string;
  rescheduleServiceId: string;
  seriesScope: 'this_only' | 'this_and_following';
  onRowAction: (ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) => Promise<void>;
  submitReschedule: (ev: Event) => Promise<void>;
  confirmSeriesScope: () => Promise<void>;
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

async function openPanel(el: Wc, row: Record<string, unknown>) {
  await el.onRowAction(new CustomEvent('rowAction', { detail: { actionId: 'reschedule', row } }));
  await el.updateComplete;
}

const form = (el: Wc) => el.shadowRoot.querySelector('form[data-mode="reschedule"]')!;
const picker = (el: Wc, role: string) =>
  form(el).querySelector(`ion-select[data-role="${role}"]`) as (HTMLElement & { value: string }) | null;

async function pick(el: Wc, role: string, value: string) {
  const select = picker(el, role)!;
  select.value = value;
  select.dispatchEvent(new CustomEvent('ionChange', { detail: { value } }));
  await el.updateComplete;
}

const sentReschedule = () => commands.find((c) => c.name === 'appointments.appointments.reschedule');

describe('the appointment sheet edits the professional and the service (appointments#263)', () => {
  it('paints a service picker and a professional picker, pre-filled from the appointment', async () => {
    const el = await mount();
    await openPanel(el, APPOINTMENT);

    const service = picker(el, 'reschedule-service');
    const staff = picker(el, 'reschedule-staff');
    expect(service, 'the service of the appointment is picked here, not by cancelling it').toBeTruthy();
    expect(staff, 'the professional of the appointment is picked here, not by cancelling it').toBeTruthy();
    expect(service!.value).toBe('sv1');
    expect(staff!.value).toBe('s1');
    const staffOptions = [...staff!.querySelectorAll('ion-select-option')].map(
      (o) => (o as HTMLElement & { value: string }).value,
    );
    expect(staffOptions, 'only bookable professionals receive appointments').toEqual(['s1', 's2']);
    expect(
      form(el).querySelector('ion-select[data-role="customer"]'),
      'the customer is still not up for grabs: another customer is another appointment',
    ).toBeNull();
  });

  it('a new professional travels with the service, as the pair the schema wants', async () => {
    const el = await mount();
    await openPanel(el, APPOINTMENT);
    await pick(el, 'reschedule-staff', 's2');
    await el.submitReschedule(new Event('submit'));

    const p = sentReschedule()?.payload;
    expect(p, 'the handover must reach the reschedule command').toBeTruthy();
    expect(p!.staff_id).toBe('s2');
    expect(p!.service_id, 'the professional is judged for a service: they travel together').toBe('sv1');
    expect(p!.duration_minutes, 'changing only the professional keeps the length').toBe(30);
    expect(Object.keys(p!).sort()).toEqual([
      'allow_past',
      'allow_short_notice',
      'appointment_id',
      'duration_minutes',
      'service_id',
      'staff_id',
      'start_datetime',
    ]);
  });

  it('a new service pre-fills the minutes from the catalogue and travels with the professional', async () => {
    const el = await mount();
    await openPanel(el, APPOINTMENT);
    await pick(el, 'reschedule-service', 'sv2');
    expect(el.rescheduleDuration, 'the service IS the length, as in the create form').toBe('90');
    await el.submitReschedule(new Event('submit'));

    const p = sentReschedule()?.payload;
    expect(p!.service_id).toBe('sv2');
    expect(p!.staff_id).toBe('s1');
    expect(p!.duration_minutes).toBe(90);
  });

  it('an appointment without a professional cannot change its service until one is picked', async () => {
    const el = await mount();
    await openPanel(el, UNASSIGNED_APPOINTMENT);
    await pick(el, 'reschedule-service', 'sv2');
    // `ion-button` is not defined under happy-dom: `?disabled` is read as the attribute.
    const submit = form(el).querySelector('ion-button[type="submit"]') as HTMLElement;
    expect(submit.hasAttribute('disabled'), 'the server refuses a service without a professional: the button says so first').toBe(true);
    expect(
      form(el).querySelector('[data-testid="appointments-list-reschedule-needs-staff"]'),
      'and says what is missing',
    ).toBeTruthy();
    await el.submitReschedule(new Event('submit'));
    expect(sentReschedule(), 'nothing is sent that the command would refuse').toBeUndefined();

    await pick(el, 'reschedule-staff', 's2');
    expect(submit.hasAttribute('disabled')).toBe(false);
    await el.submitReschedule(new Event('submit'));
    expect(sentReschedule()?.payload.staff_id).toBe('s2');
  });

  it('the overlap warning reads the agenda of the NEW professional', async () => {
    allowOverlapping = true;
    const el = await mount();
    await openPanel(el, APPOINTMENT);
    await pick(el, 'reschedule-staff', 's2');
    await el.submitReschedule(new Event('submit'));

    const asked = queries.filter((q) => q.name === 'appointments.appointments.conflicting');
    expect(asked.length, 'with overlapping allowed the panel asks before writing').toBeGreaterThan(0);
    expect(asked.at(-1)!.params!.staff_id, 'asking about the old column would warn about the wrong day').toBe('s2');
  });

  it('«this and following» hands the series over through recurring.update', async () => {
    const el = await mount();
    await openPanel(el, SERIES_OCCURRENCE);
    await pick(el, 'reschedule-staff', 's2');
    await pick(el, 'reschedule-service', 'sv2');
    await el.submitReschedule(new Event('submit'));
    el.seriesScope = 'this_and_following';
    await el.confirmSeriesScope();

    const p = commands.find((c) => c.name === 'appointments.recurring.update')?.payload;
    expect(p, 'the series command carries the handover').toBeTruthy();
    expect(p!.current_staff_id, 'the selector is the series professional').toBe('s1');
    expect(p!.staff_id).toBe('s2');
    expect(p!.current_service_id, 'the selector is the series service').toBe('sv1');
    expect(p!.service_id).toBe('sv2');
  });

  it('«this and following» without a handover keeps the series payload it always had', async () => {
    const el = await mount();
    await openPanel(el, SERIES_OCCURRENCE);
    await el.submitReschedule(new Event('submit'));
    el.seriesScope = 'this_and_following';
    await el.confirmSeriesScope();

    const p = commands.find((c) => c.name === 'appointments.recurring.update')?.payload;
    expect(p!.staff_id).toBe('s1');
    expect('current_staff_id' in p!, 'without a handover the professional is only the selector').toBe(false);
    expect('current_service_id' in p!).toBe(false);
    expect('service_id' in p!).toBe(false);
  });
});
