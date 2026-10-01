// appointments#281 — in «Repeating», the professional picker only offers who PERFORMS the service.
//
// The new-series form and the edit panel (handing a series to someone else, #248) listed every
// bookable team member whatever the service: the receptionist picked service and professional,
// filled the pattern, pressed save… and only then read «That professional does not perform this
// service». The same defect was fixed for a single appointment in appointments#279; Fresha, Booksy
// and Square only offer, for the chosen service, the team members who do it.
//
// The picker applies the server's rule (`resolve_booking` on create/materialize,
// `resolve_professional` on update) with the same read the server judges with,
// `staff.services.eligible_for_service`, through the reader the agenda uses (ui/lib/eligible-staff):
//
//   1. no service yet → the whole bookable team;
//   2. a service WITH declared competencies → only those professionals;
//   3. a service with none → the whole team (the server accepts anyone);
//   4. a service the chosen professional does not do → she is cleared, and the form says why;
//   5. a failed read → the whole team (the server still judges on save), and the form says so;
//   6. a late answer for a service picked BEFORE never narrows the one picked now;
//   7. the edit panel keeps showing the series' professional, even if she no longer does it, until
//      a new service makes her the stale choice — then saving waits for who takes it over.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const ES = (esLocale as { ui: Record<string, string> }).ui;
const EN = (enLocale as { ui: Record<string, string> }).ui;

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const eligibleAsked: string[] = [];
let eligibleFails = false;
/** Services whose eligibility read fails, on top of `eligibleFails`. */
const eligibleFailsFor = new Set<string>();
let eligibleGate: Promise<void> | null = null;

/** sv1 (Haircut) has no declared competencies; sv2 (Colour) is only Eva's (s1). */
const ELIGIBLE: Record<string, unknown[]> = {
  sv1: [],
  sv2: [{ staff_id: 's1', full_name: 'Eva Pro', custom_duration: null, custom_price: null, is_primary: 1 }],
};

const SERIES_ROW = {
  id: 'r1',
  customer_name: 'Ana López',
  service_name: 'Haircut',
  staff_name: 'Luis Back',
  frequency: 'weekly',
  day_of_week: 1,
  time: '10:00',
  duration_minutes: 30,
  start_date: '2099-10-06',
  end_date: null,
  max_occurrences: 4,
  is_active: 1,
};
/** Luis, haircuts: a series anybody could take. */
const LUIS_HAIRCUT = { ...SERIES_ROW, customer_id: 'c1', service_id: 'sv1', staff_id: 's2', split_from_id: null };
/** Eva, colours: only she does them. */
const EVA_COLOUR = { ...LUIS_HAIRCUT, service_id: 'sv2', service_name: 'Colour', staff_id: 's1', staff_name: 'Eva Pro' };
/** Luis, colours: booked before colours were narrowed to Eva. */
const LUIS_COLOUR = { ...LUIS_HAIRCUT, service_id: 'sv2', service_name: 'Colour' };

let template: Record<string, unknown> = LUIS_HAIRCUT;

/** The shell's `t`: looks the key up in the Spanish catalogue. */
function translate(cat: Record<string, { ui?: Record<string, string> }>, key: string, params?: Record<string, unknown>) {
  const raw = cat.es?.ui?.[key.replace(/^ui\./, '')] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`));
}

beforeEach(() => {
  commands.length = 0;
  eligibleAsked.length = 0;
  eligibleFails = false;
  eligibleFailsFor.clear();
  eligibleGate = null;
  template = LUIS_HAIRCUT;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      switch (name) {
        case 'appointments.recurring.list':
          return { rows: [SERIES_ROW], total: 1 };
        case 'appointments.recurring.get':
          return [template];
        case 'appointments.recurring.occurrences':
          return [{ id: 'a1', occurrence_date: '2099-10-06', status: 'confirmed', converted_sale_id: null }];
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
          eligibleAsked.push(String(params?.service_id));
          if (eligibleGate) await eligibleGate;
          if (eligibleFails || eligibleFailsFor.has(String(params?.service_id))) throw new Error('forbidden');
          return ELIGIBLE[String(params?.service_id)] ?? [];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (name === 'appointments.recurring.create') return { ok: true, operations: 1, new_ids: ['r9'] };
      if (name === 'appointments.recurring.materialize') {
        return { ok: true, operations: 1, new_ids: [], result: { booked: 1, already_booked: 0, skipped: [] } };
      }
      if (name === 'appointments.recurring.update') {
        return {
          ok: true,
          operations: 1,
          new_ids: [],
          result: { recurring_id: 'r1', pattern_changed: false, staff_changed: true, moved: 1, cancelled_pattern_change: 0, locked_invoiced: 0, skipped: [] },
        };
      }
      return { ok: true };
    },
    on: () => () => {},
    t: translate,
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
  newStaffId: string;
  editStaffId: string;
  openSeries: (row: Record<string, unknown>) => Promise<void>;
};

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
};

const byTestId = (el: Wc, testid: string) =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { value?: unknown; disabled?: boolean }) | null;

/** The professionals a picker offers, by id, in order. */
const offered = (el: Wc, testid: string): string[] =>
  [...(byTestId(el, testid)?.querySelectorAll('ion-select-option') ?? [])].map((o) => String((o as HTMLElement & { value?: unknown }).value));

const notice = (el: Wc, id: string) => byTestId(el, `appointments-series-${id}`);

/** What `ion-select` does on a pick: holds the value and emits `ionChange`. */
async function pick(el: Wc, testid: string, value: string) {
  const f = byTestId(el, testid);
  expect(f, `${testid} must be rendered`).toBeTruthy();
  f!.value = value;
  f!.dispatchEvent(new CustomEvent('ionChange', { detail: { value }, bubbles: true, composed: true }));
  await settle(el);
}

async function type(el: Wc, testid: string, value: string) {
  const f = byTestId(el, testid);
  f!.value = value;
  f!.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true, composed: true }));
  await settle(el);
}

async function openEdit(el: Wc) {
  await el.openSeries({ id: 'r1' });
  await settle(el);
}

async function submit(el: Wc, testid: string) {
  (byTestId(el, testid) as unknown as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  await settle(el);
}

const CREATE_STAFF = 'appointments-series-create-staff';
const CREATE_SERVICE = 'appointments-series-create-service';
const EDIT_STAFF = 'appointments-series-staff';
const EDIT_SERVICE = 'appointments-series-service';

describe('the new-series form only offers who performs the service (appointments#281)', () => {
  it('without a service, the whole bookable team is offered', async () => {
    const el = await mount();
    expect(offered(el, CREATE_STAFF), 'Marta is not bookable; Eva and Luis are').toEqual(['s1', 's2']);
  });

  it('a service with declared competencies offers only those professionals', async () => {
    const el = await mount();
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(offered(el, CREATE_STAFF), 'only Eva does colours').toEqual(['s1']);
  });

  it('a service with no declared competencies offers the whole team, as the server accepts', async () => {
    const el = await mount();
    await pick(el, CREATE_SERVICE, 'sv2');
    await pick(el, CREATE_SERVICE, 'sv1');
    expect(offered(el, CREATE_STAFF), 'nobody narrowed haircuts: everyone').toEqual(['s1', 's2']);
  });

  it('switching to a service the chosen professional does not do clears her and says why', async () => {
    const el = await mount();
    await pick(el, CREATE_STAFF, 's2');
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(el.newStaffId, 'Luis does not do colours: he cannot stay chosen').toBe('');
    expect(notice(el, 'staff-not-for-service'), 'the form says why he went').toBeTruthy();
    expect(notice(el, 'staff-not-for-service')!.textContent!.trim()).toBe(ES.staffNotForService);
    await pick(el, CREATE_STAFF, 's1');
    expect(el.newStaffId).toBe('s1');
    expect(notice(el, 'staff-not-for-service'), 'a professional was picked again').toBeNull();
  });

  it('a professional who does the new service stays chosen, without any notice', async () => {
    const el = await mount();
    await pick(el, CREATE_STAFF, 's1');
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(el.newStaffId).toBe('s1');
    expect(notice(el, 'staff-not-for-service')).toBeNull();
  });

  it('a failed read offers the whole team, keeps the choice, and says the check could not be done', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, CREATE_STAFF, 's2');
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(offered(el, CREATE_STAFF), 'the server still judges on save').toEqual(['s1', 's2']);
    expect(el.newStaffId, 'nothing is cleared on a guess').toBe('s2');
    expect(notice(el, 'eligible-staff-unavailable')!.textContent!.trim()).toBe(ES.eligibleStaffUnavailable);
  });

  it('a failed read is asked again on the next service pick', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, CREATE_SERVICE, 'sv2');
    eligibleFails = false;
    await pick(el, CREATE_SERVICE, 'sv1');
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(offered(el, CREATE_STAFF)).toEqual(['s1']);
    expect(notice(el, 'eligible-staff-unavailable')).toBeNull();
  });

  it('each service is read once, however many times it is picked', async () => {
    const el = await mount();
    await pick(el, CREATE_SERVICE, 'sv2');
    await pick(el, CREATE_SERVICE, 'sv1');
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(eligibleAsked).toEqual(['sv2', 'sv1']);
  });

  it('a late answer for the service picked BEFORE never narrows the one picked now', async () => {
    const el = await mount();
    await pick(el, CREATE_STAFF, 's2');
    let release!: () => void;
    eligibleGate = new Promise<void>((r) => (release = r));
    await pick(el, CREATE_SERVICE, 'sv2'); // colours (only Eva) on its way…
    await pick(el, CREATE_SERVICE, 'sv1'); // …but haircut is the one picked now
    release();
    await settle(el);
    expect(offered(el, CREATE_STAFF), 'haircut is everyone’s').toEqual(['s1', 's2']);
    expect(el.newStaffId, 'Luis does haircuts: the stale answer must not clear him').toBe('s2');
    expect(notice(el, 'staff-not-for-service')).toBeNull();
  });

  it('while the new service is being checked, the list of the previous service is not offered', async () => {
    const el = await mount();
    await pick(el, CREATE_SERVICE, 'sv2');
    expect(offered(el, CREATE_STAFF)).toEqual(['s1']);
    let release!: () => void;
    eligibleGate = new Promise((r) => (release = r));
    await pick(el, CREATE_SERVICE, 'sv1');
    expect(offered(el, CREATE_STAFF), 'colours’ list is not the answer for haircuts').toEqual(['s1', 's2']);
    release();
    await settle(el);
    expect(offered(el, CREATE_STAFF)).toEqual(['s1', 's2']);
  });

  it('a failed read for the service picked BEFORE never says the one picked now could not be checked', async () => {
    const el = await mount();
    let release!: () => void;
    eligibleGate = new Promise((r) => (release = r));
    eligibleFailsFor.add('sv2');
    await pick(el, CREATE_SERVICE, 'sv2');
    await pick(el, CREATE_SERVICE, 'sv1');
    release();
    await settle(el);
    expect(notice(el, 'eligible-staff-unavailable'), 'haircuts were checked fine').toBeNull();
  });

  it('a series saved leaves a clean form, and an answer still on its way never narrows it', async () => {
    const el = await mount();
    await pick(el, 'appointments-series-create-customer', 'c1');
    await pick(el, CREATE_STAFF, 's2');
    await pick(el, CREATE_SERVICE, 'sv2'); // Luis cleared, notice on screen
    expect(notice(el, 'staff-not-for-service')).toBeTruthy();
    await pick(el, CREATE_STAFF, 's1');
    await type(el, 'appointments-series-create-start', '2099-10-01');
    await type(el, 'appointments-series-create-start-time', '17:30');
    let release!: () => void;
    eligibleGate = new Promise((r) => (release = r));
    eligibleFailsFor.add('sv1');
    await pick(el, CREATE_SERVICE, 'sv1'); // haircut's read in flight, and it will fail…
    await submit(el, 'appointments-series-create-form');
    const created = commands.find((c) => c.name === 'appointments.recurring.create');
    expect(created?.payload).toMatchObject({ service_id: 'sv1', staff_id: 's1' });
    release();
    await settle(el);
    expect(offered(el, CREATE_STAFF), 'the next series starts without a service').toEqual(['s1', 's2']);
    expect(notice(el, 'staff-not-for-service')).toBeNull();
    expect(notice(el, 'eligible-staff-unavailable'), '…after the series was saved: not this form’s news').toBeNull();
  });

  it('a series saved with a narrowed service leaves the whole team for the next one', async () => {
    const el = await mount();
    await pick(el, 'appointments-series-create-customer', 'c1');
    await pick(el, CREATE_SERVICE, 'sv2');
    await pick(el, CREATE_STAFF, 's1');
    await type(el, 'appointments-series-create-start', '2099-10-01');
    await type(el, 'appointments-series-create-start-time', '17:30');
    expect(offered(el, CREATE_STAFF)).toEqual(['s1']);
    await submit(el, 'appointments-series-create-form');
    expect(commands.some((c) => c.name === 'appointments.recurring.create')).toBe(true);
    expect(offered(el, CREATE_STAFF), 'the next series has no service yet').toEqual(['s1', 's2']);
  });

  it('a series saved after a failed check does not carry the warning into the next one', async () => {
    eligibleFails = true;
    const el = await mount();
    await pick(el, 'appointments-series-create-customer', 'c1');
    await pick(el, CREATE_STAFF, 's2');
    await pick(el, CREATE_SERVICE, 'sv2');
    await type(el, 'appointments-series-create-start', '2099-10-01');
    await type(el, 'appointments-series-create-start-time', '17:30');
    expect(notice(el, 'eligible-staff-unavailable')).toBeTruthy();
    await submit(el, 'appointments-series-create-form');
    expect(commands.some((c) => c.name === 'appointments.recurring.create')).toBe(true);
    expect(notice(el, 'eligible-staff-unavailable')).toBeNull();
  });
});

describe('the series edit panel only offers who performs the service (appointments#281)', () => {
  it('opening a series narrows the list to its service', async () => {
    template = EVA_COLOUR;
    const el = await mount();
    await openEdit(el);
    expect(offered(el, EDIT_STAFF), 'only Eva does colours').toEqual(['s1']);
  });

  it('the series’ professional stays on screen even if she no longer does the service', async () => {
    template = LUIS_COLOUR;
    const el = await mount();
    await openEdit(el);
    expect(el.editStaffId, 'opening changes nothing').toBe('s2');
    expect(offered(el, EDIT_STAFF), 'his name stays as the current value').toEqual(['s2', 's1']);
    expect(notice(el, 'staff-not-for-service'), 'nothing was changed: no notice').toBeNull();
  });

  it('with the series’ own service, its professional can be picked back after trying another', async () => {
    template = LUIS_COLOUR;
    const el = await mount();
    await openEdit(el);
    await pick(el, EDIT_STAFF, 's1');
    expect(offered(el, EDIT_STAFF), 'nothing would change by going back to Luis').toEqual(['s2', 's1']);
  });

  it('a series whose service nobody narrowed offers the whole team', async () => {
    const el = await mount();
    await openEdit(el);
    expect(offered(el, EDIT_STAFF)).toEqual(['s1', 's2']);
  });

  it('a series without a service asks nobody’s competencies and offers the whole team', async () => {
    template = { ...LUIS_HAIRCUT, service_id: null, service_name: '' };
    const el = await mount();
    await openEdit(el);
    expect(eligibleAsked, 'no service, nothing to ask').toEqual([]);
    expect(offered(el, EDIT_STAFF)).toEqual(['s1', 's2']);
  });

  it('a series without a professional offers no blank professional', async () => {
    template = { ...LUIS_HAIRCUT, staff_id: null, staff_name: '' };
    const el = await mount();
    await openEdit(el);
    expect(offered(el, EDIT_STAFF), 'only real team members').toEqual(['s1', 's2']);
  });

  it('a new service the series’ professional does not do clears him, says why, and waits for who takes it', async () => {
    const el = await mount();
    await openEdit(el); // Luis, haircut
    await pick(el, EDIT_SERVICE, 'sv2');
    expect(el.editStaffId, 'Luis does not do colours').toBe('');
    expect(offered(el, EDIT_STAFF), 'only Eva does colours').toEqual(['s1']);
    expect(notice(el, 'staff-not-for-service')!.textContent!.trim()).toBe(ES.seriesStaffNotForService);
    expect(byTestId(el, 'appointments-series-submit')!.disabled, 'nobody would take the series').toBe(true);
    await submit(el, 'appointments-series-form');
    expect(commands.some((c) => c.name === 'appointments.recurring.update'), 'a save the server would refuse is not sent').toBe(false);
    await pick(el, EDIT_STAFF, 's1');
    expect(notice(el, 'staff-not-for-service')).toBeNull();
    expect(byTestId(el, 'appointments-series-submit')!.disabled).toBe(false);
    await submit(el, 'appointments-series-form');
    expect(commands.find((c) => c.name === 'appointments.recurring.update')?.payload).toMatchObject({
      current_staff_id: 's2',
      staff_id: 's1',
      current_service_id: 'sv1',
      service_id: 'sv2',
    });
  });

  it('a new service the series’ professional does do keeps him, without any notice', async () => {
    template = { ...LUIS_HAIRCUT, staff_id: 's1', staff_name: 'Eva Pro' };
    const el = await mount();
    await openEdit(el);
    await pick(el, EDIT_SERVICE, 'sv2');
    expect(el.editStaffId).toBe('s1');
    expect(notice(el, 'staff-not-for-service')).toBeNull();
  });

  it('a failed read in the edit panel offers the whole team, keeps the professional and says so', async () => {
    eligibleFails = true;
    const el = await mount();
    await openEdit(el);
    await pick(el, EDIT_SERVICE, 'sv2');
    expect(el.editStaffId, 'nothing is cleared on a guess').toBe('s2');
    expect(offered(el, EDIT_STAFF)).toEqual(['s1', 's2']);
    expect(notice(el, 'eligible-staff-unavailable')).toBeTruthy();
  });

  it('going back to the series’ own service never clears the professional it already has', async () => {
    template = LUIS_COLOUR;
    const el = await mount();
    await openEdit(el);
    await pick(el, EDIT_SERVICE, 'sv1');
    await pick(el, EDIT_SERVICE, 'sv2'); // colours again: what is booked, with Luis
    expect(el.editStaffId, 'nothing changes: the series keeps him').toBe('s2');
    expect(offered(el, EDIT_STAFF)).toEqual(['s2', 's1']);
    expect(notice(el, 'staff-not-for-service')).toBeNull();
  });

  it('a professional who no longer takes appointments stays on the field while she is still the one picked', async () => {
    eligibleFails = true;
    template = { ...LUIS_HAIRCUT, staff_id: 's3', staff_name: 'Marta Office' };
    const el = await mount();
    await openEdit(el);
    await pick(el, EDIT_SERVICE, 'sv2'); // could not be checked: nothing is cleared
    expect(el.editStaffId).toBe('s3');
    expect(offered(el, EDIT_STAFF), 'the field still says who it is').toEqual(['s3', 's1', 's2']);
  });

  it('another series opened after a cleared professional starts clean', async () => {
    const el = await mount();
    await openEdit(el);
    await pick(el, EDIT_SERVICE, 'sv2');
    expect(notice(el, 'staff-not-for-service')).toBeTruthy();
    await openEdit(el);
    expect(el.editStaffId).toBe('s2');
    expect(notice(el, 'staff-not-for-service')).toBeNull();
    expect(offered(el, EDIT_STAFF), 'haircut: the whole team').toEqual(['s1', 's2']);
  });

  it('the new notice of the edit panel speaks both languages', () => {
    for (const cat of [ES, EN]) expect(cat.seriesStaffNotForService).toBeTruthy();
    expect(EN.seriesStaffNotForService).not.toBe(ES.seriesStaffNotForService);
  });
});
