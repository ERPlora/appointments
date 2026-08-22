// appointments#21 — the agenda must run a REAL salon day (Fresha/Vagaro as the standard):
//
//   1. LINKED BOOKING — the create panel books against real records: customer, service and
//      professional are picked from the customers/services/staff modules (ids + denormalized
//      names/price), never typed as free text.
//   2. PER-PROFESSIONAL DAY VIEW — a view toggle renders the day as an `ok-scheduler`
//      (OutfitKit resource timeline): one row per bookable professional, appointments
//      positioned by time; legacy rows without staff fall into an "unassigned" lane.
//   3. NO-SHOW — the API always had it; the receptionist needs it as a row action.
import { beforeEach, describe, expect, it } from 'vitest';
import { todayISO as localDay } from '../../lib/day-bounds';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params: Record<string, unknown> }[] = [];

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
    start_datetime: '2026-08-07T10:00:00.000Z',
    end_datetime: '2026-08-07T10:30:00.000Z',
    duration_minutes: 30,
    status: 'confirmed',
  },
  {
    // Legacy free-text row (pre-#21): no staff link → must land in the "unassigned" lane.
    id: 'a2',
    appointment_number: 'APT-2',
    customer_id: null,
    customer_name: 'Walk-in',
    customer_phone: '',
    service_id: null,
    service_name: 'Color',
    service_price: 0,
    staff_id: '',
    staff_name: '',
    start_datetime: '2026-08-07T12:00:00.000Z',
    end_datetime: '2026-08-07T13:00:00.000Z',
    duration_minutes: 60,
    status: 'pending',
  },
];

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.appointments.list':
          return DAY_APPOINTMENTS;
        case 'customers.list':
          // Paginated list engine shape: {rows, total, limit, offset}.
          return {
            rows: [
              { id: 'c1', name: 'Ana López', phone: '600111222', email: 'ana@example.com' },
              { id: 'c2', name: 'Berta Ruiz', phone: '600333444', email: '' },
            ],
            total: 2,
          };
        case 'services.services.list':
          return {
            rows: [
              { id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 },
              { id: 'sv2', name: 'Color', price: 4500, duration_minutes: 90, is_bookable: 1 },
            ],
            total: 2,
          };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1, color: '#7048e8' },
              { id: 's2', full_name: 'Luis Back', status: 'active', is_bookable: 0, color: '' },
            ],
            total: 2,
          };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60, allow_overlapping: 0 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    on: () => () => {},
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
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Wc = HTMLElement & {
  shadowRoot: ShadowRoot;
  view: string;
  newCustomerId: string;
  newServiceId: string;
  newStaffId: string;
  newStart: string;
  newDuration: string;
  createAppointment: (ev: Event) => Promise<void>;
  updateComplete: Promise<unknown>;
};

describe('linked booking: the create panel books against real records', () => {
  it('loads customers, services and staff (bookable) alongside the day list', async () => {
    await mount();
    const names = queries.map((q) => q.name);
    expect(names).toContain('customers.list');
    expect(names).toContain('services.services.list');
    expect(names).toContain('staff.members.list');
  });

  it('the create form offers customer/service/professional SELECTS, no free-text service field', async () => {
    const el = await mount();
    const form = el.shadowRoot.querySelector('form[slot="create"]')!;
    expect(form, 'create form must live in the table create panel').toBeTruthy();
    const selects = [...form.querySelectorAll('ion-select')];
    // customer + service + professional (status filter select lives outside the form)
    expect(selects.length, 'customer/service/professional must be ion-selects').toBeGreaterThanOrEqual(3);
    // Free text remains only for what IS free text (no service/customer name inputs).
    const textInputs = [...form.querySelectorAll('ion-input')].filter(
      (n) => !['datetime-local', 'number', 'date'].includes(n.getAttribute('type') ?? 'text'),
    );
    expect(textInputs.length, 'free-text customer/service inputs must be gone').toBe(0);
  });

  it('the professional select only offers BOOKABLE staff', async () => {
    const el = await mount();
    const wc = el as Wc;
    await wc.updateComplete;
    const staffSelect = el.shadowRoot.querySelector('form[slot="create"] ion-select[data-role="staff"]')!;
    expect(staffSelect, 'staff select must be tagged data-role="staff"').toBeTruthy();
    const values = [...staffSelect.querySelectorAll('ion-select-option')].map(
      (o) => (o as HTMLElement & { value?: string }).value ?? o.getAttribute('value'),
    );
    expect(values).toContain('s1');
    expect(values, 'non-bookable staff must not be offered').not.toContain('s2');
  });

  // `?disabled=` is a boolean ATTRIBUTE binding, and `ion-button` is not upgraded here (Ionic
  // is not loaded under happy-dom), so there is no `.disabled` property to read — the attribute
  // IS the observable contract, and it is also what Ionic itself reflects in the browser.
  it('submit stays disabled until customer + service + professional + start are picked', async () => {
    const el = await mount();
    const wc = el as Wc;
    const submit = () =>
      el.shadowRoot.querySelector('form[slot="create"] ion-button[type="submit"]') as HTMLElement;
    expect(submit().hasAttribute('disabled'), 'empty form must not be submittable').toBe(true);

    wc.newCustomerId = 'c1';
    wc.newServiceId = 'sv1';
    wc.newStaffId = 's1';
    wc.newStart = '2026-08-07T10:00';
    await wc.updateComplete;
    expect(submit().hasAttribute('disabled'), 'fully linked form must be submittable').toBe(false);
  });

  it('create sends the LINKS (ids) plus the denormalized names/price/duration from the records', async () => {
    const el = await mount();
    const wc = el as Wc;
    wc.newCustomerId = 'c1';
    wc.newServiceId = 'sv1';
    wc.newStaffId = 's1';
    wc.newStart = '2026-08-07T10:00';
    wc.newDuration = ''; // untouched → the service's duration drives it
    await wc.createAppointment(new Event('submit'));

    const create = commands.find((c) => c.name === 'appointments.appointments.create');
    expect(create, 'create command was not sent').toBeTruthy();
    const p = create!.payload;
    expect(p.customer_id).toBe('c1');
    expect(p.customer_name).toBe('Ana López');
    expect(p.customer_phone).toBe('600111222');
    expect(p.service_id).toBe('sv1');
    expect(p.service_name).toBe('Haircut');
    expect(p.service_price).toBe(2000);
    expect(p.staff_id).toBe('s1');
    expect(p.staff_name).toBe('Eva Pro');
    expect(p.duration_minutes, 'duration defaults to the service duration').toBe(30);
    // appointments#76: same instant, but the text carries the SALON's wall clock + its local
    // offset — a UTC wall here is a window the availability engine tatts by the tz offset.
    expect(new Date(p.start_datetime as string).getTime()).toBe(new Date('2026-08-07T10:00').getTime());
    expect(String(p.start_datetime).slice(0, 16)).toBe('2026-08-07T10:00');
  });

  it('a typed duration overrides the service default', async () => {
    const el = await mount();
    const wc = el as Wc;
    wc.newCustomerId = 'c1';
    wc.newServiceId = 'sv1';
    wc.newStaffId = 's1';
    wc.newStart = '2026-08-07T10:00';
    wc.newDuration = '45';
    await wc.createAppointment(new Event('submit'));
    const create = commands.find((c) => c.name === 'appointments.appointments.create');
    expect(create!.payload.duration_minutes).toBe(45);
  });
});

describe('per-professional day view (ok-scheduler timeline)', () => {
  it('a view toggle offers list | by-professional', async () => {
    const el = await mount();
    const segment = el.shadowRoot.querySelector('.filters ion-segment');
    expect(segment, 'the view toggle must live with the query-scope controls').toBeTruthy();
    const values = [...segment!.querySelectorAll('ion-segment-button')].map(
      (b) => (b as HTMLElement & { value?: string }).value ?? b.getAttribute('value'),
    );
    expect(values).toEqual(['list', 'staff']);
  });

  it('the professional view renders ok-scheduler: one row per bookable professional + unassigned lane', async () => {
    const el = await mount();
    const wc = el as Wc;
    wc.view = 'staff';
    await wc.updateComplete;

    const scheduler = el.shadowRoot.querySelector('ok-scheduler') as HTMLElement & {
      resources: { id: string; label: string }[];
      events: { id: string; resourceId: string; start: string; end: string; title: string }[];
      date: string;
    };
    expect(scheduler, 'the professional view must reuse ok-scheduler (OutfitKit), not a custom grid').toBeTruthy();

    const resourceIds = scheduler.resources.map((r) => r.id);
    expect(resourceIds, 'one lane per bookable professional').toContain('s1');
    expect(resourceIds, 'non-bookable staff have no lane').not.toContain('s2');
    expect(resourceIds, 'legacy rows without staff need an unassigned lane').toContain('unassigned');

    const byId = Object.fromEntries(scheduler.events.map((e) => [e.id, e]));
    expect(byId.a1.resourceId, 'appointments group by their staff_id').toBe('s1');
    expect(byId.a2.resourceId, 'staff-less appointments fall into the unassigned lane').toBe('unassigned');
    expect(byId.a1.title, 'the block names the customer').toContain('Ana López');
  });

  it('the scheduler shows the selected day with the configured calendar hours', async () => {
    const el = await mount();
    const wc = el as Wc;
    wc.view = 'staff';
    await wc.updateComplete;
    const scheduler = el.shadowRoot.querySelector('ok-scheduler') as HTMLElement & {
      date: string;
      startHour: number;
      endHour: number;
    };
    // pm#93: el día LOCAL. Antes se comparaba con `toISOString()` (UTC), que a las 00:30 en
    // Madrid habría dado el día de ayer — el mismo bug que arrastraba el componente.
    expect(scheduler.date).toBe(localDay());
    expect(scheduler.startHour, 'start hour comes from appointments settings').toBe(9);
    expect(scheduler.endHour, 'end hour comes from appointments settings').toBe(19);
  });

  it('the list view keeps the data table (the toggle swaps, it does not stack)', async () => {
    const el = await mount();
    const wc = el as Wc;
    expect(el.shadowRoot.querySelector('ok-data-table'), 'list view renders the table').toBeTruthy();
    expect(el.shadowRoot.querySelector('ok-scheduler'), 'list view renders no scheduler').toBeNull();
    wc.view = 'staff';
    await wc.updateComplete;
    expect(el.shadowRoot.querySelector('ok-scheduler')).toBeTruthy();
  });
});

describe('the receptionist can mark a no-show', () => {
  it('row actions include no_show (the API always had it)', async () => {
    const el = await mount();
    const actions = (el as unknown as { rowActions: { id: string }[] }).rowActions.map((a) => a.id);
    expect(actions).toContain('no_show');
  });
});
