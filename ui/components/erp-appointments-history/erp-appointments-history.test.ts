// appointments#194 — the HISTORY of one appointment, on its sheet in the agenda.
//
// «When a customer says "I didn't move anything" or "I didn't cancel", the front desk has nowhere
// to look.» The module already writes every change (`appointments_history`, one line per
// transition) and, since appointments#145, the reschedule and the cancel say who asked for it
// (`channel`: the front desk or the customer). The read already exists
// (`appointments.appointments.history`); what was missing is a screen. Fresha, Booksy, Square
// Appointments and Mindbody show the appointment's activity inside its detail panel.
//
// What this pins:
//   - the action and the channel are painted BY KEY (`description` is fixed English text written by
//     the handler and must never reach the screen);
//   - WHO did it is the hub user's name (`hub.users.list`, the core's reserved namespace) — never a
//     raw id; and a change the customer asked for says so instead of naming the bot's user;
//   - the when is read on the BUSINESS clock (appointments#12), not the device's;
//   - loading / empty / error states, and a slow answer never paints over the next appointment.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same as the customer history: `ok-timeline` is OutfitKit's and is tested in its own repo; here we
// pin what THIS component hands it.
vi.mock('@erplora/outfitkit/ok-timeline', () => ({}));

// A device that is NOT the salon: without `timeZone` the 10:30 in Madrid would read 20:30.
process.env.TZ = 'Pacific/Auckland';

const ROOT = join(__dirname, '../../..');
const EN = JSON.parse(readFileSync(join(ROOT, 'locales/en.json'), 'utf8')) as { ui: Record<string, string> };
const ES = JSON.parse(readFileSync(join(ROOT, 'locales/es.json'), 'utf8')) as { ui: Record<string, string> };

const USER_ANA = '0b7f3c52-9d1e-4a57-8f0c-2b1e6d4a9c11';
const USER_BOT = '6a2d9e10-3c4b-4f7a-9e21-7d5c8b0a4f33';
const USER_GONE = 'f00d0000-0000-4000-8000-000000000000';

const HISTORY = [
  {
    id: 'h5', appointment_id: 'ap-1', action: 'cancelled', description: 'Appointment cancelled',
    performed_by: USER_BOT, old_value: null,
    new_value: '{"status":"cancelled","channel":"customer","reason":"Sick"}',
    created_at: '2026-09-21T08:30:00Z',
  },
  {
    id: 'h4', appointment_id: 'ap-1', action: 'rescheduled', description: 'Appointment rescheduled',
    performed_by: USER_ANA, old_value: null,
    new_value: '{"start_datetime":"2026-09-24T14:00:00Z","end_datetime":"2026-09-24T15:00:00Z","duration_minutes":60,"channel":"staff"}',
    created_at: '2026-09-20T08:30:00Z',
  },
  {
    id: 'h3', appointment_id: 'ap-1', action: 'confirmed', description: 'Appointment confirmed',
    performed_by: USER_GONE, old_value: '{"status":"pending"}', new_value: '{"status":"confirmed"}',
    created_at: '2026-09-19T08:30:00Z',
  },
  {
    id: 'h2', appointment_id: 'ap-1', action: 'created', description: 'Appointment created',
    performed_by: USER_ANA, old_value: null, new_value: 'not json at all',
    created_at: '2026-09-18T08:30:00Z',
  },
  {
    id: 'h1', appointment_id: 'ap-1', action: 'something_new', description: 'Some future action',
    performed_by: '', old_value: null, new_value: null,
    created_at: '2026-09-17T08:30:00Z',
  },
];

const USERS = [
  { id: USER_ANA, name: 'Ana Recepción', role: 'employee', is_active: true },
  { id: USER_BOT, name: 'WhatsApp bot', role: 'employee', is_active: true },
];

const queries: { name: string; params?: Record<string, unknown> }[] = [];
let historyAnswer: (params?: Record<string, unknown>) => Promise<unknown> = async () => HISTORY;
let usersAnswer: () => Promise<unknown> = async () => USERS;

beforeEach(() => {
  queries.length = 0;
  historyAnswer = async () => HISTORY;
  usersAnswer = async () => USERS;
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
      if (name === 'appointments.appointments.history') return historyAnswer(params);
      if (name === 'hub.users.list') return usersAnswer();
      return [];
    },
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

interface TimelineItem { id: string; title: string; description?: string; time?: string; color?: string; icon?: string }
type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown>; appointmentId: string };

async function settle(el: Wc) {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
  await el.updateComplete;
}

async function mount(appointmentId = 'ap-1'): Promise<Wc> {
  await import('./erp-appointments-history');
  const el = document.createElement('erp-appointments-history') as Wc;
  el.appointmentId = appointmentId;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

const items = (el: Wc): TimelineItem[] =>
  ((el.shadowRoot.querySelector('ok-timeline') as unknown as { items?: TimelineItem[] })?.items) ?? [];

const byId = (el: Wc, id: string) => items(el).find((i) => i.id === id)!;

describe('the history names itself once', () => {
  it('carries its own title by default (under the reschedule form nothing else names it)', async () => {
    const el = await mount();
    expect(el.shadowRoot.querySelector('h3')?.textContent).toBe('ui.appointmentHistoryTitle');
  });

  it('drops its title when the host panel already names it', async () => {
    await import('./erp-appointments-history');
    const el = document.createElement('erp-appointments-history') as Wc & { hideTitle: boolean };
    el.hideTitle = true;
    el.appointmentId = 'ap-1';
    document.body.appendChild(el);
    await settle(el);
    expect(el.shadowRoot.querySelector('h3')).toBeNull();
    expect(items(el).length, 'the timeline itself still paints').toBe(HISTORY.length);
  });
});

describe('the appointment history reads its own door', () => {
  it('asks the module query for THIS appointment', async () => {
    await mount('ap-1');
    const call = queries.find((q) => q.name === 'appointments.appointments.history');
    expect(call, 'the read that already exists, not a new one').toBeDefined();
    expect(call!.params).toEqual({ appointment_id: 'ap-1' });
  });

  it('asks nothing while no appointment is open', async () => {
    await mount('');
    expect(queries.filter((q) => q.name === 'appointments.appointments.history')).toHaveLength(0);
  });

  it('reloads when the sheet switches to another appointment', async () => {
    const el = await mount('ap-1');
    el.appointmentId = 'ap-2';
    await settle(el);
    const calls = queries.filter((q) => q.name === 'appointments.appointments.history');
    expect(calls.map((c) => c.params?.appointment_id)).toEqual(['ap-1', 'ap-2']);
  });

  it('keeps the newest-first order the query returns', async () => {
    const el = await mount();
    expect(items(el).map((i) => i.id)).toEqual(['h5', 'h4', 'h3', 'h2', 'h1']);
  });
});

describe('each line says what happened, by key', () => {
  it('translates the action instead of painting the English description', async () => {
    const el = await mount();
    expect(byId(el, 'h5').title).toBe('ui.historyActionCancelled');
    expect(byId(el, 'h4').title).toBe('ui.historyActionRescheduled');
    expect(byId(el, 'h3').title).toBe('ui.historyActionConfirmed');
    expect(byId(el, 'h2').title).toBe('ui.historyActionCreated');
    for (const i of items(el)) {
      expect(`${i.title} ${i.description ?? ''}`).not.toMatch(/Appointment (cancelled|rescheduled|confirmed|created)/);
    }
  });

  it('an action this screen does not know yet gets a neutral label, not its raw code', async () => {
    const el = await mount();
    expect(byId(el, 'h1').title).toBe('ui.historyActionOther');
  });

  it('says the customer asked for the cancellation, and the reason', async () => {
    const el = await mount();
    const d = byId(el, 'h5').description ?? '';
    expect(d).toContain('ui.historyByCustomer');
    expect(d).toContain('Sick');
  });

  it('says the front desk asked for the reschedule, and the new time on the business clock', async () => {
    const el = await mount();
    const d = byId(el, 'h4').description ?? '';
    expect(d).toContain('ui.historyByFrontDesk');
    expect(d).toContain('ui.historyNewTime');
    expect(d, '14:00Z is 16:00 in Madrid (the device is in Auckland)').toMatch(/16:00/);
  });

  it('a status change without a channel does not invent one', async () => {
    const el = await mount();
    const d = byId(el, 'h3').description ?? '';
    expect(d).not.toContain('ui.historyByCustomer');
    expect(d).not.toContain('ui.historyByFrontDesk');
  });

  it('an unreadable new_value does not break the line', async () => {
    const el = await mount();
    expect(byId(el, 'h2').title).toBe('ui.historyActionCreated');
  });
});

describe('who and when', () => {
  it('names the hub user who did it', async () => {
    const el = await mount();
    expect(byId(el, 'h4').time).toContain('Ana Recepción');
    expect(queries.some((q) => q.name === 'hub.users.list')).toBe(true);
  });

  it('a change the customer asked for does not name the user the channel runs as', async () => {
    const el = await mount();
    expect(byId(el, 'h5').time ?? '').not.toContain('WhatsApp bot');
  });

  it('never paints a raw user id', async () => {
    const el = await mount();
    for (const i of items(el)) {
      const text = `${i.title} ${i.description ?? ''} ${i.time ?? ''}`;
      for (const id of [USER_ANA, USER_BOT, USER_GONE]) expect(text).not.toContain(id);
    }
  });

  it('reads the when on the business clock, not the device', async () => {
    const el = await mount();
    expect(byId(el, 'h4').time, '08:30Z is 10:30 in Madrid (20:30 in Auckland)').toMatch(/10:30/);
  });

  it('without the list of users the history still paints, just without names', async () => {
    usersAnswer = async () => { throw new Error('forbidden'); };
    const el = await mount();
    expect(items(el)).toHaveLength(5);
    expect(el.shadowRoot.querySelector('[data-testid="appointments-history-error"]')).toBeNull();
  });
});

describe('loading, empty and error', () => {
  it('shows a loading line while the read is in flight', async () => {
    let release: (v: unknown) => void = () => {};
    historyAnswer = () => new Promise((r) => { release = r; });
    await import('./erp-appointments-history');
    const el = document.createElement('erp-appointments-history') as Wc;
    el.appointmentId = 'ap-1';
    document.body.appendChild(el);
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('[data-testid="appointments-history-loading"]')).not.toBeNull();
    release(HISTORY);
    await settle(el);
    expect(el.shadowRoot.querySelector('[data-testid="appointments-history-loading"]')).toBeNull();
  });

  it('says there is nothing yet when the appointment has no lines', async () => {
    historyAnswer = async () => [];
    const el = await mount();
    expect(el.shadowRoot.querySelector('[data-testid="appointments-history-empty"]')).not.toBeNull();
    expect(el.shadowRoot.querySelector('ok-timeline')).toBeNull();
  });

  it('says it could not load it when the read fails', async () => {
    historyAnswer = async () => { throw new Error('boom'); };
    const el = await mount();
    const err = el.shadowRoot.querySelector('[data-testid="appointments-history-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain('ui.appointmentHistoryError');
    expect(el.shadowRoot.querySelector('[data-testid="appointments-history-empty"]')).toBeNull();
  });

  it('accepts the paginated shape {rows} as well as a bare array', async () => {
    historyAnswer = async () => ({ rows: HISTORY, total: HISTORY.length });
    const el = await mount();
    expect(items(el)).toHaveLength(5);
  });

  it('a slow answer for the previous appointment never paints over the new one', async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    historyAnswer = (params) =>
      params?.appointment_id === 'ap-1'
        ? new Promise((r) => { releaseFirst = r; })
        : Promise.resolve([HISTORY[1]]);
    const el = await mount('ap-1');
    el.appointmentId = 'ap-2';
    await settle(el);
    releaseFirst(HISTORY);
    await settle(el);
    expect(items(el).map((i) => i.id)).toEqual(['h4']);
  });
});

describe('every string the history paints exists in English and Spanish', () => {
  const KEYS = [
    'appointmentHistoryTitle', 'appointmentHistoryEmpty', 'appointmentHistoryError',
    'historyActionCreated', 'historyActionConfirmed', 'historyActionStarted', 'historyActionCompleted',
    'historyActionCancelled', 'historyActionNoShow', 'historyActionRescheduled', 'historyActionOther',
    'historyByCustomer', 'historyByFrontDesk', 'historyNewTime', 'historyReason', 'actionHistory',
  ];
  for (const k of KEYS) {
    it(`ui.${k}`, () => {
      expect(EN.ui[k], `en: ui.${k}`).toBeTruthy();
      expect(ES.ui[k], `es: ui.${k}`).toBeTruthy();
      expect(ES.ui[k], `es: ui.${k} must be translated, not copied`).not.toBe(EN.ui[k]);
    });
  }

  // Every action the module writes (handler `created`/`confirmed`, `_history_*.sql`) has its label.
  it('covers every action the module writes', () => {
    const written = new Set<string>(['created', 'confirmed']);
    for (const f of ['cancel', 'complete', 'confirm', 'no_show', 'reschedule', 'start']) {
      const sql = readFileSync(join(ROOT, 'commands', `_history_${f}.sql`), 'utf8');
      const m = sql.match(/SELECT\s+:new_id,\s*:hub_id,\s*a\.id,\s*'([a-z_]+)'/);
      expect(m, `action literal in _history_${f}.sql`).not.toBeNull();
      written.add(m![1]);
    }
    const src = readFileSync(join(__dirname, 'erp-appointments-history.ts'), 'utf8');
    for (const action of written) {
      expect(src, `the screen must translate «${action}»`).toMatch(new RegExp(`\\b${action}\\s*:`));
    }
  });
});
