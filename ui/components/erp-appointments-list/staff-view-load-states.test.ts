// appointments#323 — the «By professional» view SAYS when the professionals could not be read,
// lets the receptionist try again, and tells «could not load» and «no team yet» apart.
//
// Regression: when `staff.members.list` failed, the timeline was painted anyway with only the
// «Unassigned» lane. `ok-scheduler` only paints the events of the lanes it gets, so every
// appointment with a professional vanished from the day — no message, no retry — and the empty
// grid stayed tappable and draggable: an agenda that looks free invites booking on top of the
// appointments it is hiding. The «no bookable professionals» note was never shown either: the
// scheduler's `empty` label only paints with no lanes at all, and «Unassigned» is always there.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const MEMBER = { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 };
const APPOINTMENT = {
  id: 'a1',
  appointment_number: 'APT-1',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Haircut',
  staff_id: 's1',
  staff_name: 'Eva Pro',
  start_datetime: '2026-08-07T10:00:00.000Z',
  end_datetime: '2026-08-07T10:30:00.000Z',
  duration_minutes: 30,
  status: 'confirmed',
};

type Answer = () => Promise<unknown>;
const ok = (rows: unknown[]): Answer => async () => ({ rows, total: rows.length });
const fail: Answer = async () => {
  throw new Error('staff module did not answer');
};

let staffAnswer: Answer;
let servicesAnswer: Answer;
const reads: string[] = [];

beforeEach(() => {
  staffAnswer = ok([MEMBER]);
  servicesAnswer = ok([{ id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 }]);
  reads.length = 0;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      reads.push(name);
      switch (name) {
        case 'appointments.appointments.list':
          return [APPOINTMENT];
        case 'staff.members.list':
          return staffAnswer();
        case 'services.services.list':
          return servicesAnswer();
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
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown>; view: string };

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

const hook = (el: Wc, testid: string) => el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
type Scheduler = HTMLElement & { resources: { id: string }[]; events: { id: string; resourceId: string }[] };
const scheduler = (el: Wc) => el.shadowRoot.querySelector('ok-scheduler') as Scheduler | null;

describe('appointments#323 — the «By professional» view says when the professionals do not load', () => {
  it('a failed read shows the error with Retry instead of a timeline without the team', async () => {
    staffAnswer = fail;
    const el = await mountStaffView();

    const error = hook(el, 'appointments-list-staff-view-error');
    expect(error, 'the failure is said in the view').toBeTruthy();
    expect(error!.tagName.toLowerCase()).toBe('ok-inline-feedback');
    expect(error!.getAttribute('tone')).toBe('danger');
    expect(error!.textContent).toContain('ui.errLoadStaff');
    expect(hook(el, 'appointments-list-staff-view-empty'), 'a failure is not «no team yet»').toBeNull();
    expect(error!.textContent, 'a failure is not «no team yet»').not.toContain('ui.noStaff');
    expect(scheduler(el), 'no grid to tap or drag on while the team is unknown').toBeNull();
    expect(hook(el, 'appointments-list-staff-view-retry')!.textContent, 'the button says Retry').toContain('ui.catalogRetry');
  });

  it('Retry reads the professionals again and brings the timeline back with their appointments', async () => {
    staffAnswer = fail;
    const el = await mountStaffView();
    staffAnswer = ok([MEMBER]);
    const before = reads.filter((r) => r === 'staff.members.list').length;

    hook(el, 'appointments-list-staff-view-retry')!.click();
    await settle(el);

    expect(reads.filter((r) => r === 'staff.members.list').length, 'Retry reads the list again').toBe(before + 1);
    expect(hook(el, 'appointments-list-staff-view-error'), 'the error goes once the list arrives').toBeNull();
    expect(scheduler(el)!.resources.map((r) => r.id)).toContain('s1');
    expect(scheduler(el)!.events.find((e) => e.id === 'a1')?.resourceId, 'her appointment is on her lane').toBe('s1');
  });

  it('Retry says it is reading again until the list arrives', async () => {
    staffAnswer = fail;
    const el = await mountStaffView();
    let release: () => void = () => {};
    staffAnswer = () => new Promise((resolve) => (release = () => resolve({ rows: [MEMBER], total: 1 })));

    hook(el, 'appointments-list-staff-view-retry')!.click();
    await settle(el);

    const loading = hook(el, 'appointments-list-staff-view-loading');
    expect(loading, 'the retry is visibly on its way').toBeTruthy();
    expect(loading!.getAttribute('role')).toBe('status');
    expect(loading!.textContent).toContain('ui.staffLoading');
    expect(hook(el, 'appointments-list-staff-view-error'), 'the old failure is not left on screen meanwhile').toBeNull();
    expect(scheduler(el), 'no grid while the team is still unknown').toBeNull();

    release();
    await settle(el);
    expect(hook(el, 'appointments-list-staff-view-loading')).toBeNull();
    expect(scheduler(el)!.resources.map((r) => r.id)).toContain('s1');
  });

  it('with no bookable professionals the view says so, and keeps the unassigned lane', async () => {
    staffAnswer = ok([{ ...MEMBER, is_bookable: 0 }]);
    const el = await mountStaffView();

    const empty = hook(el, 'appointments-list-staff-view-empty');
    expect(empty, '«no team yet» is said').toBeTruthy();
    expect(empty!.getAttribute('tone')).toBe('info');
    expect(empty!.textContent).toContain('ui.noStaff');
    expect(hook(el, 'appointments-list-staff-view-error')).toBeNull();
    // appointments#334 — Eva is not bookable but has an appointment that day: it keeps her lane
    // instead of vanishing (this line used to expect only «Unassigned», which pinned that bug).
    expect(scheduler(el)!.resources.map((r) => r.id), 'a row without a professional stays visible').toEqual(['s1', 'unassigned']);
    expect(scheduler(el)!.events.find((e) => e.id === 'a1')?.resourceId).toBe('s1');
  });

  it('with the team loaded the view shows only the timeline', async () => {
    const el = await mountStaffView();
    expect(hook(el, 'appointments-list-staff-view-error')).toBeNull();
    expect(hook(el, 'appointments-list-staff-view-empty')).toBeNull();
    expect(hook(el, 'appointments-list-staff-view-loading')).toBeNull();
    expect(scheduler(el)!.resources.map((r) => r.id)).toEqual(['s1', 'unassigned']);
  });

  it('a services read that fails does not hide the timeline', async () => {
    servicesAnswer = fail;
    const el = await mountStaffView();
    expect(hook(el, 'appointments-list-staff-view-error')).toBeNull();
    expect(scheduler(el)!.resources.map((r) => r.id)).toContain('s1');
  });

  it('every sentence the view paints has its en and its es', () => {
    const en = (enLocale as { ui: Record<string, string> }).ui;
    const es = (esLocale as { ui: Record<string, string> }).ui;
    for (const key of ['errLoadStaff', 'staffLoading', 'noStaff', 'catalogRetry']) {
      expect(en[key], `en ${key}`).toBeTruthy();
      expect(es[key], `es ${key}`).toBeTruthy();
      expect(es[key], `es ${key} is translated`).not.toBe(en[key]);
    }
  });
});
