// appointments#319 — the create panel SAYS when the services or the professionals could not be
// read, lets the receptionist try again, and tells «still loading» and «there are none» apart.
//
// Regression: `loadCatalogs` read both lists with `.catch(() => [])`, so a failed read (Services or
// Staff not answering, a network cut) painted the same empty `ion-select` as a business with no
// services or no team — no message, no way to retry short of reloading the screen. The states are
// the ones the same panel already paints for its free times (`appointments-list-slots-*`): a
// spinner while it loads, the reason plus «Try again» when it fails, a note when there are none.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const SERVICE = { id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 };
const MEMBER = { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 };

type Answer = () => Promise<unknown>;
const ok = (rows: unknown[]): Answer => async () => ({ rows, total: rows.length });
const fail: Answer = async () => {
  throw new Error('services module did not answer');
};

let servicesAnswer: Answer;
let staffAnswer: Answer;
let settingsAnswer: Answer;
const reads: string[] = [];
const subscribed: string[] = [];

beforeEach(() => {
  servicesAnswer = ok([SERVICE]);
  staffAnswer = ok([MEMBER]);
  settingsAnswer = async () => [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 30 }];
  reads.length = 0;
  subscribed.length = 0;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      reads.push(name);
      switch (name) {
        case 'services.services.list':
          return servicesAnswer();
        case 'staff.members.list':
          return staffAnswer();
        case 'appointments.settings.get':
          return settingsAnswer();
        default:
          return [];
      }
    },
    command: async () => ({ ok: true }),
    on: (name: string) => {
      subscribed.push(name);
      return () => {};
    },
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

const settle = async (el: Wc) => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

const form = (el: Wc) => el.shadowRoot.querySelector('[data-testid="appointments-list-form"]') as HTMLElement;
const hook = (el: Wc, testid: string) => form(el).querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { disabled?: boolean }) | null;
const options = (el: Wc, testid: string) => [...(hook(el, testid)?.querySelectorAll('ion-select-option') ?? [])].map((o) => (o as HTMLElement & { value: string }).value);

describe('appointments#319 — services and professionals that do not load are said, with Try again', () => {
  for (const kind of ['services', 'staff'] as const) {
    const answer = (a: Answer) => (kind === 'services' ? (servicesAnswer = a) : (staffAnswer = a));
    const query = kind === 'services' ? 'services.services.list' : 'staff.members.list';
    const select = kind === 'services' ? 'appointments-list-service' : 'appointments-list-staff';
    const id = kind === 'services' ? SERVICE.id : MEMBER.id;
    const errorKey = kind === 'services' ? 'ui.errLoadServices' : 'ui.errLoadStaff';
    const loadingKey = kind === 'services' ? 'ui.servicesLoading' : 'ui.staffLoading';
    const noneKey = kind === 'services' ? 'ui.servicesNone' : 'ui.staffNone';
    const other = kind === 'services' ? 'staff' : 'services';
    const otherSelect = kind === 'services' ? 'appointments-list-staff' : 'appointments-list-service';
    const otherId = kind === 'services' ? MEMBER.id : SERVICE.id;

    it(`a failed ${kind} read shows the error and Try again — not an empty list`, async () => {
      answer(fail);
      const el = await mount();

      const error = hook(el, `appointments-list-${kind}-error`);
      expect(error, 'the failure is said inside the panel').toBeTruthy();
      expect(error!.tagName.toLowerCase()).toBe('ok-inline-feedback');
      expect(error!.getAttribute('tone')).toBe('danger');
      expect(error!.textContent).toContain(errorKey);
      expect(hook(el, `appointments-list-${kind}-empty`), 'a failure is not «there are none»').toBeNull();
      expect(hook(el, select)!.disabled, 'an empty picker that cannot be filled is not offered').toBe(true);

      answer(ok([kind === 'services' ? SERVICE : MEMBER]));
      const before = reads.filter((r) => r === query).length;
      expect(hook(el, `appointments-list-${kind}-retry`)!.textContent, 'the button says Retry').toContain('ui.catalogRetry');
      hook(el, `appointments-list-${kind}-retry`)!.click();
      await settle(el);

      expect(reads.filter((r) => r === query).length, 'Try again reads the list again').toBe(before + 1);
      expect(hook(el, `appointments-list-${kind}-error`), 'the error goes once the list arrives').toBeNull();
      expect(options(el, select)).toContain(id);
      expect(hook(el, select)!.disabled).toBe(false);
    });

    it(`Try again on the ${kind} says it is reading again until the list arrives`, async () => {
      answer(fail);
      const el = await mount();
      let release: () => void = () => {};
      answer(() => new Promise((resolve) => (release = () => resolve({ rows: [kind === 'services' ? SERVICE : MEMBER], total: 1 }))));
      hook(el, `appointments-list-${kind}-retry`)!.click();
      await settle(el);

      expect(hook(el, `appointments-list-${kind}-loading`), 'the retry is visibly on its way').toBeTruthy();
      expect(hook(el, `appointments-list-${kind}-error`), 'the old failure is not left on screen meanwhile').toBeNull();

      release();
      await settle(el);
      expect(hook(el, `appointments-list-${kind}-loading`)).toBeNull();
      expect(options(el, select)).toContain(id);
    });

    it(`while the ${kind} are being read, the panel says it is loading`, async () => {
      let release: () => void = () => {};
      answer(() => new Promise((resolve) => (release = () => resolve({ rows: [kind === 'services' ? SERVICE : MEMBER], total: 1 }))));
      const el = await mount();

      const loading = hook(el, `appointments-list-${kind}-loading`);
      expect(loading, 'a list on its way is not an empty list').toBeTruthy();
      expect(loading!.getAttribute('role')).toBe('status');
      expect(loading!.textContent, 'each list says which one is loading').toContain(loadingKey);
      expect(hook(el, `appointments-list-${kind}-empty`)).toBeNull();
      expect(hook(el, `appointments-list-${kind}-error`)).toBeNull();

      release();
      await settle(el);
      expect(hook(el, `appointments-list-${kind}-loading`)).toBeNull();
      expect(options(el, select)).toContain(id);
    });

    it(`with no bookable ${kind} the panel says so instead of a blank picker`, async () => {
      answer(ok(kind === 'services' ? [{ ...SERVICE, is_bookable: 0 }] : [{ ...MEMBER, is_bookable: 0 }]));
      const el = await mount();

      const empty = hook(el, `appointments-list-${kind}-empty`);
      expect(empty, '«there are none» is said').toBeTruthy();
      expect(empty!.getAttribute('tone')).toBe('info');
      expect(empty!.textContent, 'each list says which one is missing').toContain(noneKey);
      expect(hook(el, `appointments-list-${kind}-error`)).toBeNull();
      expect(hook(el, select)!.disabled).toBe(true);
    });

    it(`a failed ${kind} read that arrives last does not mark the ${other} as failed`, async () => {
      let failNow: () => void = () => {};
      answer(() => new Promise((_, reject) => (failNow = () => reject(new Error('module did not answer')))));
      const el = await mount();
      expect(options(el, otherSelect), 'the other list has already arrived').toContain(otherId);

      failNow();
      await settle(el);
      expect(hook(el, `appointments-list-${kind}-error`)).toBeTruthy();
      expect(hook(el, `appointments-list-${other}-error`), 'only the list that failed says so').toBeNull();
      expect(options(el, otherSelect)).toContain(otherId);
      expect(hook(el, otherSelect)!.disabled).toBe(false);
    });
  }

  it('one list failing does not hide the other', async () => {
    servicesAnswer = fail;
    const el = await mount();
    expect(hook(el, 'appointments-list-services-error')).toBeTruthy();
    expect(hook(el, 'appointments-list-staff-error')).toBeNull();
    expect(options(el, 'appointments-list-staff')).toContain(MEMBER.id);
  });

  it('settings that cannot be read leave the services and the professionals offered', async () => {
    // Splitting the catalog read in three must not let the settings' failure escape: the agenda
    // keeps its default day, still books and still follows the appointments' events (they are
    // subscribed after the catalogs, so an escaped failure would leave the agenda stale).
    settingsAnswer = fail;
    const el = await mount();
    expect(options(el, 'appointments-list-service')).toContain(SERVICE.id);
    expect(options(el, 'appointments-list-staff')).toContain(MEMBER.id);
    expect(hook(el, 'appointments-list-services-error')).toBeNull();
    expect(hook(el, 'appointments-list-staff-error')).toBeNull();
    expect(subscribed, 'the agenda keeps following new bookings').toContain('appointments.appointment.created');
  });

  it('every new sentence has its en and its es', () => {
    const en = (enLocale as { ui: Record<string, string> }).ui;
    const es = (esLocale as { ui: Record<string, string> }).ui;
    for (const key of ['errLoadServices', 'errLoadStaff', 'servicesLoading', 'staffLoading', 'servicesNone', 'staffNone', 'catalogRetry']) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(es[key], `es ${key}`).toBeTruthy();
      expect(es[key], `es ${key} is translated`).not.toBe(en[key]);
    }
  });
});
