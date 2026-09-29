// appointments#232 — the create form shows WHICH hours are still free.
//
// Until now the receptionist picked a day and typed an hour blind: she found out the hour was taken,
// outside the opening hours or outside the professional's shift only after pressing "Add", and
// started over. The market (Fresha, Booksy, Treatwell, Square Appointments, Vagaro, Odoo) does it
// the same way everywhere: pick the service, the professional and the day, and the free times appear
// as buttons; one tap fills the hour. Typing another hour by hand stays possible.
//
// The list is NOT computed here: it is `appointments.availability.slots`, the same engine the
// assistant and WhatsApp read, which already crosses the opening hours (#127), blocked time, the
// agenda and — since #230 — the professional's own shift. A second calculation in the browser would
// be a second opinion that sooner or later disagrees with the door.
import { beforeEach, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';

process.env.TZ = 'Europe/Madrid';

type SlotCall = { name: string; payload: Record<string, unknown> };
const calls: SlotCall[] = [];
/** Answers of `availability.slots`, served in order; a function lets a test hold or fail one. */
let slotAnswers: Array<(payload: Record<string, unknown>) => Promise<unknown>> = [];

const FREE = { rows: [
  { slot_start: '2026-10-05T10:00:00', slot_end: '2026-10-05T10:30:00', start_time: '10:00', end_time: '10:30' },
  { slot_start: '2026-10-05T11:15:00', slot_end: '2026-10-05T11:45:00', start_time: '11:15', end_time: '11:45' },
], total: 2, limit: 2, offset: 0 };

beforeEach(() => {
  calls.length = 0;
  slotAnswers = [];
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana López', phone: '', email: '' }], total: 1 };
        case 'services.services.list':
          return {
            rows: [
              { id: 'sv1', name: 'Haircut', price: 2000, duration_minutes: 30, is_bookable: 1 },
              { id: 'sv2', name: 'Color', price: 4500, duration_minutes: 90, is_bookable: 1 },
              { id: 'sv3', name: 'Fringe', price: 900, duration_minutes: 30, is_bookable: 1 },
            ],
            total: 2,
          };
        case 'staff.members.list':
          return {
            rows: [
              { id: 's1', full_name: 'Eva Pro', status: 'active', is_bookable: 1 },
              { id: 's2', full_name: 'Marta Pro', status: 'active', is_bookable: 1 },
            ],
            total: 2,
          };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 9, calendar_end_hour: 19, default_duration: 60 }];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });
      if (name === 'appointments.availability.slots') {
        const next = slotAnswers.shift();
        // The real SDK resolves a command with the dispatcher's envelope, the read-back travels
        // in `result` (seen on hub:stable 1.1.30). A bare `{ rows }` here once hid a form that
        // painted "no free times" on every real day.
        return { new_ids: [], ok: true, operations: 0, result: await (next ? next(payload) : FREE) };
      }
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
  updateComplete: Promise<unknown>;
  newServiceId: string;
  newStaffId: string;
  newStartDate: string;
  newStartTime: string;
  newDuration: string;
  services: Array<Record<string, unknown>>;
  settings: Record<string, unknown>;
  onServiceChange: (id: string) => void;
  onSlotClick: (ev: CustomEvent<{ resourceId: string; time: string }>) => Promise<void>;
};

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await settle(el);
  return el;
}

/** Lets the component render, fire its slot request, get the answer and paint it. */
async function settle(el: Wc): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
  }
}

const form = (el: Wc) => el.shadowRoot.querySelector('form[data-mode="create"]')!;
const slotCalls = () => calls.filter((c) => c.name === 'appointments.availability.slots');
const slotButtons = (el: Wc) =>
  Array.from(form(el).querySelectorAll('[data-testid^="appointments-list-slot-"]')) as HTMLElement[];

async function pick(el: Wc, { service = 'sv1', staff = 's1', date = '2026-10-05' } = {}): Promise<void> {
  if (service) el.onServiceChange(service);
  if (staff) el.newStaffId = staff;
  if (date) el.newStartDate = date;
  await settle(el);
}

describe('the create form offers the free times of the day', () => {
  it('asks the availability engine with the day, the professional and the duration of the service', async () => {
    const el = await mount();
    await pick(el);

    expect(slotCalls().length, 'the free times come from the engine, not from the browser').toBe(1);
    expect(slotCalls()[0].payload).toEqual({
      date: '2026-10-05',
      staff_id: 's1',
      duration_minutes: 30,
      allow_short_notice: true,
    });
  });

  it('asks as the counter: the hours inside the customer notice are offered too (appointments#234)', async () => {
    const el = await mount();
    await pick(el);

    expect(
      slotCalls()[0].payload.allow_short_notice,
      'the minimum notice is the customer window; the counter books inside it, as `create` already declares',
    ).toBe(true);
  });

  it('paints one button per free time, in the hub clock', async () => {
    const el = await mount();
    await pick(el);

    const buttons = slotButtons(el);
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual([
      'appointments-list-slot-1000',
      'appointments-list-slot-1115',
    ]);
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['10:00', '11:15']);
  });

  it('a tap on a free time fills the time field and marks that button as the chosen one', async () => {
    const el = await mount();
    await pick(el);

    slotButtons(el)[1].click();
    await settle(el);

    expect(el.newStartTime, 'the tapped hour is the hour that will be booked').toBe('11:15');
    const [first, second] = slotButtons(el);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(first.getAttribute('aria-pressed')).toBe('false');
    expect([first.getAttribute('fill'), second.getAttribute('fill')], 'the chosen hour is painted apart').toEqual([
      'outline',
      'solid',
    ]);
    const timeField = form(el).querySelector('ion-input[data-role="start-time"]') as HTMLElement & { value: string };
    expect(timeField.value, 'the field repaints the chosen hour').toBe('11:15');
  });

  it('keeps the hour typed by hand as the alternative', async () => {
    const el = await mount();
    await pick(el);
    expect(form(el).querySelector('ion-input[data-role="start-time"]'), 'typing another hour stays possible').toBeTruthy();
  });

  it.each([
    ['service', { service: '' }],
    ['professional', { staff: '' }],
    ['day', { date: '' }],
  ])('does not ask, and says what is missing, while the %s is not chosen', async (_what, missing) => {
    const el = await mount();
    await pick(el, missing);

    expect(slotCalls().length).toBe(0);
    expect(slotButtons(el).length).toBe(0);
    expect(form(el).querySelector('[data-testid="appointments-list-slots-hint"]')?.textContent).toContain('ui.freeSlotsHint');
  });

  it('asks again when the professional, the day or the service changes', async () => {
    const el = await mount();
    await pick(el);

    el.newStaffId = 's2';
    await settle(el);
    expect(slotCalls().at(-1)!.payload).toEqual({ date: '2026-10-05', staff_id: 's2', duration_minutes: 30, allow_short_notice: true });

    el.newStartDate = '2026-10-06';
    await settle(el);
    expect(slotCalls().at(-1)!.payload).toEqual({ date: '2026-10-06', staff_id: 's2', duration_minutes: 30, allow_short_notice: true });

    el.onServiceChange('sv2');
    await settle(el);
    expect(slotCalls().at(-1)!.payload, 'a longer service fits in fewer places').toEqual({
      date: '2026-10-06',
      staff_id: 's2',
      duration_minutes: 90,
      allow_short_notice: true,
    });
    expect(slotCalls().length).toBe(4);
  });

  it('drops the painted hours when the question stops being complete (the form empties after a booking)', async () => {
    const el = await mount();
    await pick(el);
    expect(slotButtons(el).length).toBe(2);

    // What a successful booking does to the form: the next one must not open showing the hours of
    // the last professional — the one just booked among them — as if they were still free.
    el.newServiceId = '';
    el.newStaffId = '';
    await settle(el);

    expect(slotButtons(el).length).toBe(0);
    expect(form(el).querySelector('[data-testid="appointments-list-slots-hint"]')?.textContent).toContain('ui.freeSlotsHint');
    expect(slotCalls().length, 'an incomplete question is not asked').toBe(1);
  });

  it('asks again when the minutes are typed by hand', async () => {
    const el = await mount();
    await pick(el);
    el.newDuration = '45';
    await settle(el);
    expect(slotCalls().at(-1)!.payload.duration_minutes).toBe(45);
  });

  it('asks as soon as the service arrives, even when the minutes were typed first with its length', async () => {
    const el = await mount();
    el.newDuration = '30';
    el.newStaffId = 's1';
    el.newStartDate = '2026-10-05';
    await settle(el);
    expect(slotCalls().length, 'no service yet → no question').toBe(0);

    el.onServiceChange('sv1'); // 30 min, the length already typed: only the service changes
    await settle(el);
    expect(slotCalls().length).toBe(1);
    expect(slotButtons(el).length).toBe(2);
  });

  it('asks again with the default length of the settings when they arrive after the question', async () => {
    const el = await mount();
    el.services = [...el.services, { id: 'sv4', name: 'Consultation', price: 0, is_bookable: 1 }];
    el.settings = {};
    await settle(el);
    await pick(el, { service: 'sv4' }); // a service without its own length → the default one
    expect(slotCalls().at(-1)!.payload.duration_minutes).toBe(60);

    el.settings = { default_duration: 45 };
    await settle(el);
    expect(slotCalls().at(-1)!.payload.duration_minutes).toBe(45);
  });

  it('does not ask twice for the same question', async () => {
    const el = await mount();
    await pick(el);
    el.newStartTime = '10:00'; // choosing an hour does not change which hours are free
    await settle(el);
    el.onServiceChange('sv3'); // another service of the same length: same day, same person, same fit
    await settle(el);
    expect(slotCalls().length).toBe(1);
    expect(slotButtons(el).length, 'the answer already painted stays').toBe(2);
  });

  it('shows a loading state while the engine answers', async () => {
    let release!: () => void;
    slotAnswers.push(() => new Promise((resolve) => (release = () => resolve(FREE))));
    const el = await mount();
    await pick(el);

    expect(form(el).querySelector('[data-testid="appointments-list-slots-loading"]'), 'loading is visible').toBeTruthy();
    expect(slotButtons(el).length).toBe(0);

    release();
    await settle(el);
    expect(form(el).querySelector('[data-testid="appointments-list-slots-loading"]')).toBeNull();
    expect(slotButtons(el).length).toBe(2);
  });

  it('says so when there is no free time that day, and still lets the hour be typed', async () => {
    slotAnswers.push(async () => ({ rows: [], total: 0, limit: 0, offset: 0 }));
    const el = await mount();
    await pick(el);

    expect(slotButtons(el).length).toBe(0);
    expect(form(el).querySelector('[data-testid="appointments-list-slots-empty"]')?.textContent).toContain('ui.freeSlotsEmpty');
    expect(form(el).querySelector('ion-input[data-role="start-time"]')).toBeTruthy();
  });

  it('shows the refusal of the engine by its code, with a retry that asks again', async () => {
    slotAnswers.push(async () => {
      throw Object.assign(new Error('raw'), { code: 'appointments.staff_hours_unavailable' });
    });
    const el = await mount();
    await pick(el);

    const error = form(el).querySelector('[data-testid="appointments-list-slots-error"]');
    expect(error, 'a failed read is visible, not an empty list that looks like a full day').toBeTruthy();
    expect(error!.textContent).not.toContain('raw');
    // The code is translated by the module's `errors` catalog (ADR-0055), never the raw message.
    const catalogText = (esLocale as { errors: Record<string, string> }).errors['appointments.staff_hours_unavailable'];
    expect(error!.textContent).toContain(catalogText);
    expect(slotButtons(el).length).toBe(0);

    (form(el).querySelector('[data-testid="appointments-list-slots-retry"]') as HTMLElement).click();
    await settle(el);
    expect(slotCalls().length).toBe(2);
    expect(form(el).querySelector('[data-testid="appointments-list-slots-error"]')).toBeNull();
    expect(slotButtons(el).length).toBe(2);
  });

  it('paints only the answer to the LAST question when an older one arrives late', async () => {
    let releaseFirst!: () => void;
    slotAnswers.push(
      () =>
        new Promise((resolve) =>
          (releaseFirst = () =>
            resolve({ rows: [{ start_time: '09:00', end_time: '09:30' }], total: 1, limit: 1, offset: 0 })),
        ),
    );
    slotAnswers.push(async () => ({ rows: [{ start_time: '16:00', end_time: '16:30' }], total: 1, limit: 1, offset: 0 }));
    const el = await mount();
    await pick(el); // first question: Eva, still pending
    el.newStaffId = 's2'; // second question: Marta, answered at once
    await settle(el);
    releaseFirst(); // Eva's answer arrives after Marta's
    await settle(el);

    expect(slotButtons(el).map((b) => b.textContent?.trim()), "Eva's hours are not Marta's").toEqual(['16:00']);
  });

  it('a late REFUSAL of an older question does not replace the answer to the newer one', async () => {
    let failFirst!: () => void;
    slotAnswers.push(
      () => new Promise((_resolve, reject) => (failFirst = () => reject(Object.assign(new Error('x'), { code: 'appointments.staff_hours_unavailable' })))),
    );
    slotAnswers.push(async () => ({ rows: [{ start_time: '16:00', end_time: '16:30' }], total: 1, limit: 1, offset: 0 }));
    const el = await mount();
    await pick(el);
    el.newStaffId = 's2';
    await settle(el);
    failFirst();
    await settle(el);

    expect(form(el).querySelector('[data-testid="appointments-list-slots-error"]')).toBeNull();
    expect(slotButtons(el).map((b) => b.textContent?.trim())).toEqual(['16:00']);
  });

  it('a tap replaces an hour left half-typed in the time field', async () => {
    const el = await mount();
    await pick(el);
    const timeField = form(el).querySelector('ion-input[data-role="start-time"]') as HTMLElement & { value: string };
    timeField.value = '11';
    timeField.dispatchEvent(new CustomEvent('ionInput'));
    await settle(el);

    slotButtons(el)[0].click();
    await settle(el);
    expect(el.newStartTime).toBe('10:00');
    expect(timeField.value, 'the half-typed "11" must not stay on screen over the chosen hour').toBe('10:00');
  });

  it('the empty slot of the timeline opens the form with that professional and asks for that day', async () => {
    const el = await mount();
    el.onServiceChange('sv1');
    await el.onSlotClick(new CustomEvent('slotClick', { detail: { resourceId: 's1', time: '10:00' } }));
    await settle(el);

    expect(slotCalls().at(-1)!.payload.staff_id).toBe('s1');
    expect(slotButtons(el).find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent?.trim()).toBe('10:00');
  });
});
