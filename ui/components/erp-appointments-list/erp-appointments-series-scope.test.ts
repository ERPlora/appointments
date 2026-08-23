// appointments#15 — moving an appointment that belongs to a REPEATING series.
//
// The market decided the shape (15 references + 5 forums, recorded in the issue): the receptionist
// is asked WHICH appointments the change applies to, **at save time and not when the panel opens**
// (Google, Apple and Fresha ask on save; Outlook asks on open and that is the friction people
// report), with **two** scopes and «this appointment only» preselected.
//
// «All events» does not exist on purpose: it means rewriting a past that is already charged,
// invoiced and chained into VeriFactu. No product in the salon vertical offers it.
//
// And the thing every one of them gets wrong, which is the whole reason the dialog carries text:
// editing the following occurrences silently discards the ones somebody had moved by hand. Google
// documents it («resets any exceptions») and Microsoft repeats it; nobody warns first.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';

const commands: { name: string; payload: Record<string, unknown> }[] = [];

const SERIES_APPOINTMENT = {
  id: 'a1',
  appointment_number: 'APT-20260817-0001',
  customer_id: 'c1',
  customer_name: 'Ana López',
  service_id: 'sv1',
  service_name: 'Corte',
  service_price: 2000,
  staff_id: 's1',
  staff_name: 'Eva Pro',
  start_datetime: '2026-08-17T11:00:00+02:00',
  end_datetime: '2026-08-17T11:30:00+02:00',
  duration_minutes: 30,
  status: 'confirmed',
  converted_sale_id: null,
  recurring_id: 'r1',
  occurrence_date: '2026-08-17',
};

const LONE_APPOINTMENT = {
  ...SERIES_APPOINTMENT,
  id: 'a2',
  start_datetime: '2026-08-17T13:00:00+02:00',
  end_datetime: '2026-08-17T13:30:00+02:00',
  recurring_id: null,
  occurrence_date: null,
};

beforeEach(() => {
  commands.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return [SERIES_APPOINTMENT, LONE_APPOINTMENT];
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30, is_bookable: 1 }], total: 1 };
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
  refresh: () => Promise<void>;
  rescheduleId: string;
  rescheduleStart: string;
  rescheduleDuration: string;
  seriesScope: string;
  askingSeriesScope: boolean;
  openReschedule: (row: Record<string, unknown>) => void;
  submitReschedule: (e: Event) => Promise<void>;
  confirmSeriesScope: () => Promise<void>;
  cancelSeriesScope: () => void;
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  el.day = '2026-08-17';
  await el.refresh();
  await el.updateComplete;
  return el;
};

/** Opens the move panel on `row` and presses save. */
const moveTo = async (el: Wc, row: Record<string, unknown>, start: string) => {
  el.openReschedule(row);
  await el.updateComplete;
  el.rescheduleStart = start;
  await el.submitReschedule(new Event('submit'));
  await el.updateComplete;
};

describe('an appointment that belongs to NO series moves as it always did', () => {
  it('goes straight to reschedule, with no question asked', async () => {
    const el = await mount();
    await moveTo(el, LONE_APPOINTMENT, '2026-08-17T14:00');
    expect(el.askingSeriesScope, 'a lone appointment must not be interrogated').toBe(false);
    const sent = commands.find((c) => c.name === 'appointments.appointments.reschedule');
    expect(sent?.payload.start_datetime).toBe('2026-08-17T14:00:00+02:00');
  });
});

describe('an appointment of a series ASKS, at save time', () => {
  it('does not send anything yet: it opens the scope question', async () => {
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    expect(el.askingSeriesScope).toBe(true);
    expect(commands, 'nothing may be written before the receptionist answers').toEqual([]);
  });

  it('preselects «this appointment only», the least destructive scope', async () => {
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    expect(el.seriesScope).toBe('this_only');
  });

  it('offers exactly TWO scopes — «all events» is not on the menu', async () => {
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    const alert = el.shadowRoot.querySelector('ion-alert') as (HTMLElement & { inputs?: { value: string }[] }) | null;
    expect(alert, 'the question must be painted, not only held in state').toBeTruthy();
    expect(alert!.inputs?.map((i) => i.value)).toEqual(['this_only', 'this_and_following']);
  });

  it('warns that hand-moved occurrences go back to the series, before confirming', async () => {
    // The failure every forum reports about this feature is that it happens in silence.
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    const alert = el.shadowRoot.querySelector('ion-alert') as (HTMLElement & { message?: string }) | null;
    expect(alert!.message).toContain('volverán al horario de la serie');
    expect(alert!.message).toContain('siguen anuladas');
  });
});

describe('answering the question', () => {
  it('«this only» moves the single appointment, exactly as before', async () => {
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    el.seriesScope = 'this_only';
    await el.confirmSeriesScope();
    const sent = commands.find((c) => c.name === 'appointments.appointments.reschedule');
    expect(sent?.payload).toMatchObject({
      appointment_id: 'a1',
      start_datetime: '2026-08-17T12:00:00+02:00',
      duration_minutes: 30,
    });
    expect(commands.find((c) => c.name === 'appointments.recurring.update')).toBeFalsy();
    expect(el.askingSeriesScope).toBe(false);
  });

  it('«this and following» edits the SERIES from this occurrence, in wall time', async () => {
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    el.seriesScope = 'this_and_following';
    await el.confirmSeriesScope();
    const sent = commands.find((c) => c.name === 'appointments.recurring.update');
    expect(sent, 'the series command was not dispatched').toBeTruthy();
    expect(sent!.payload).toEqual({
      recurring_id: 'r1',
      scope: 'this_and_following',
      from_occurrence_date: '2026-08-17',
      // WALL time, not an instant: a template's hour is a clock reading, and it is never stored
      // converted (appointments#12).
      time: '12:00',
      duration_minutes: 30,
    });
    expect(commands.find((c) => c.name === 'appointments.appointments.reschedule')).toBeFalsy();
  });

  it('backing out writes nothing and leaves the panel as it was', async () => {
    const el = await mount();
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    el.cancelSeriesScope();
    await el.updateComplete;
    expect(commands).toEqual([]);
    expect(el.askingSeriesScope).toBe(false);
    expect(el.rescheduleId, 'what was typed must survive: she picks again, not from scratch').toBe('a1');
  });

  it('a refusal from the server is painted, and the panel stays open', async () => {
    const el = await mount();
    (globalThis as Record<string, unknown> & { erplora: { command: unknown } }).erplora.command =
      async () => {
        throw Object.assign(new Error('nope'), { code: 'appointments.recurring_not_found' });
      };
    await moveTo(el, SERIES_APPOINTMENT, '2026-08-17T12:00');
    el.seriesScope = 'this_and_following';
    await el.confirmSeriesScope();
    await el.updateComplete;
    expect((el as unknown as { error: string }).error).toBeTruthy();
    expect(el.rescheduleId).toBe('a1');
  });
});
