// Contract of the panel that BINDS a chat request to real records (appointments#38).
//
// This component is the filler of the `whatsapp_inbox.request.booking` slot: the inbox has the
// message, this module has the diary, and neither imports the other. What is pinned here is the
// half a Rust unit test cannot see — the promises this panel makes to its host and to the two
// rules the market is unanimous about:
//
//   1. **It never decides who the customer is.** Auto-creating a customer per phone number is how
//      Vagaro ended up shipping a duplicate-merge engine with match scores and how salons collect
//      fake bookings from unverified numbers. Creating one is an explicit act, prefilled.
//   2. **The time comes from LIVE availability**, never from the message. Hours pass between «can
//      I come tomorrow at ten» and somebody reading it; the diary moved meanwhile. Only slots
//      `appointments.availability.slots` returns can be picked.
//
// And the handover itself: the panel does NOT approve anything. Approving is the inbox's command
// — this module does not know how a WhatsApp request is approved, only what a booking needs — so
// it answers with `erp:booking-resolved` carrying the four ids and lets the host do the rest.
import { beforeEach, describe, expect, it } from 'vitest';

const queries: { name: string; params: Record<string, unknown> }[] = [];
const commands: { name: string; payload: Record<string, unknown> }[] = [];

beforeEach(() => {
  queries.length = 0;
  commands.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Marta', phone: '+34600111222' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Cut', duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva', status: 'active', is_bookable: 1 }], total: 1 };
        case 'appointments.availability.slots':
          return [
            { slot_start: '2026-08-20T10:00:00', start_time: '10:00', end_time: '10:30' },
            { slot_start: '2026-08-20T11:00:00', start_time: '11:00', end_time: '11:30' },
          ];
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      return {};
    },
    hasPermission: () => true,
    locale: 'en',
    t: (_catalog: unknown, key: string) => key,
  };
});

const REQUEST = {
  request_id: 'req-1',
  request_type: 'appointment',
  customer_id: '',
  contact_name: 'Marta',
  contact_phone: '+34600111222',
  raw_summary: 'a cut tomorrow at ten if possible',
};

async function mount(detail: Record<string, unknown> = REQUEST) {
  await import('./erp-appointments-request-booking');
  const el = document.createElement('erp-appointments-request-booking');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  el.dispatchEvent(new CustomEvent('erp:whatsapp-request', { detail }));
  await settle(el);
  return el;
}

async function settle(el: Element) {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  }
}

function shadow(el: Element): ShadowRoot {
  return (el as unknown as { renderRoot: ShadowRoot }).renderRoot;
}

describe('erp-appointments-request-booking', () => {
  it('renders nothing until the host says which request is open', async () => {
    await import('./erp-appointments-request-booking');
    const el = document.createElement('erp-appointments-request-booking');
    document.body.appendChild(el);
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(shadow(el).querySelector('.panel'), 'a slot filler with no context must draw nothing').toBeNull();
  });

  it('shows what the customer actually asked for, so the operator books THAT', async () => {
    const el = await mount();
    expect(shadow(el).textContent).toContain('a cut tomorrow at ten if possible');
  });

  it('searches the customer by PHONE, and creates none on its own', async () => {
    const el = await mount();
    const search = queries.filter((q) => q.name === 'customers.list');
    expect(search.length, 'the panel looks the contact up').toBeGreaterThan(0);
    expect(
      search[0].params.search,
      'the phone is the strongest hint the chat gives; two «Marta» are two Martas',
    ).toBe('+34600111222');
    expect(
      commands.some((c) => c.name === 'customers.create'),
      'a customer is never created as a side effect of opening the panel',
    ).toBe(false);
    void el;
  });

  it('asks the availability engine for the free slots, never the message', async () => {
    const el = await mount();
    const svc = shadow(el).querySelector('#svc') as HTMLSelectElement;
    svc.value = 'sv1';
    svc.dispatchEvent(new Event('change'));
    await settle(el);
    const asked = queries.filter((q) => q.name === 'appointments.availability.slots');
    expect(asked.length, 'the slots come from the hub, live').toBeGreaterThan(0);
    expect(asked[asked.length - 1].params.duration_minutes).toBe(30);
  });

  it('hands the BOUND request back to the host and approves nothing itself', async () => {
    const el = await mount();
    const resolved: Array<Record<string, unknown>> = [];
    el.addEventListener('erp:booking-resolved', (e) => resolved.push((e as CustomEvent).detail));

    (shadow(el).querySelector('.match') as HTMLButtonElement).click();
    const svc = shadow(el).querySelector('#svc') as HTMLSelectElement;
    svc.value = 'sv1';
    svc.dispatchEvent(new Event('change'));
    await settle(el);
    const stf = shadow(el).querySelector('#stf') as HTMLSelectElement;
    stf.value = 's1';
    stf.dispatchEvent(new Event('change'));
    await settle(el);
    (shadow(el).querySelector('.slot') as HTMLButtonElement).click();
    await settle(el);
    (shadow(el).querySelector('.go ion-button') as HTMLElement).click();
    await settle(el);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      request_id: 'req-1',
      customer_id: 'c1',
      service_id: 'sv1',
      staff_id: 's1',
      start_datetime: '2026-08-20T10:00:00',
    });
    expect(
      commands.some((c) => c.name.startsWith('whatsapp_inbox.')),
      'approving is the inbox’s command: this module must not reach into it',
    ).toBe(false);
    expect(
      commands.some((c) => c.name === 'appointments.appointments.create'),
      'the booking goes through the approval + the event bus, so it happens once and only once',
    ).toBe(false);
  });

  it('cannot confirm until all four ids are bound', async () => {
    const el = await mount();
    const go = shadow(el).querySelector('.go ion-button') as HTMLElement & { disabled?: boolean };
    expect(go.hasAttribute('disabled'), 'an unbound request has nothing to book').toBe(true);
  });

  // ── appointments#69 · elegir el hueco lo APARTA ──────────────────────────────────────────────
  //
  // Entre elegir la hora y aprobar pasan segundos o minutos, y en un salón hay más de una persona
  // mirando la misma bandeja. Retener mientras se decide es lo que hace el mercado con un reloj
  // corto (Square 15 min, Appointedd 7, Timify 5), y el reloj empieza AQUÍ: un mensaje parseado por
  // el modelo no trae ni profesional ni hora, así que hasta que alguien elige no hay nada que
  // apartar.
  async function bindUpTo(el: Element, opts: { slot?: boolean } = {}) {
    (shadow(el).querySelector('.match') as HTMLButtonElement).click();
    const svc = shadow(el).querySelector('#svc') as HTMLSelectElement;
    svc.value = 'sv1';
    svc.dispatchEvent(new Event('change'));
    await settle(el);
    const stf = shadow(el).querySelector('#stf') as HTMLSelectElement;
    stf.value = 's1';
    stf.dispatchEvent(new Event('change'));
    await settle(el);
    if (opts.slot !== false) {
      (shadow(el).querySelector('.slot') as HTMLButtonElement).click();
      await settle(el);
    }
  }

  it('sets the chosen slot aside so the counter cannot sell it while the operator decides', async () => {
    const el = await mount();
    await bindUpTo(el);

    const held = commands.filter((c) => c.name === 'appointments.slots.hold');
    expect(held.length, 'picking a time has to set it aside').toBe(1);
    expect(held[0].payload).toMatchObject({
      source: 'whatsapp_inbox',
      source_ref: 'req-1',
      staff_id: 's1',
      start_datetime: '2026-08-20T10:00:00',
    });
    expect(
      held[0].payload.expires_at,
      'the TTL is the server’s: a caller that picks its own expiry can set a whole agenda aside',
    ).toBeUndefined();
  });

  it('moves the hold instead of stacking one per click', async () => {
    const el = await mount();
    await bindUpTo(el);
    const slots = shadow(el).querySelectorAll('.slot');
    (slots[slots.length - 1] as HTMLButtonElement).click();
    await settle(el);

    const held = commands.filter((c) => c.name === 'appointments.slots.hold');
    expect(held.length, 'each pick re-holds; the (source, source_ref) key moves the same row').toBe(2);
    expect(held[1].payload.source_ref, 'same request = same hold, moved').toBe('req-1');
    expect(
      commands.filter((c) => c.name === 'appointments.slots.release_hold').length,
      'changing your mind mid-panel is not a release; the upsert moves it',
    ).toBe(0);
  });

  it('gives the slot back when the operator walks away', async () => {
    const el = await mount();
    await bindUpTo(el);
    (shadow(el).querySelector('.cancel ion-button') as HTMLElement).click();
    await settle(el);

    const released = commands.filter((c) => c.name === 'appointments.slots.release_hold');
    expect(released.length, 'a hold nobody is going to use has to go back on sale').toBe(1);
    expect(released[0].payload).toMatchObject({ source: 'whatsapp_inbox', source_ref: 'req-1' });
  });

  it('does not release on confirm — the booking CONSUMES the hold, server-side', async () => {
    const el = await mount();
    await bindUpTo(el);
    (shadow(el).querySelector('.go ion-button') as HTMLElement).click();
    await settle(el);

    expect(
      commands.some((c) => c.name === 'appointments.slots.release_hold'),
      'releasing here would free the slot a heartbeat before its own appointment is written',
    ).toBe(false);
  });

  it('asks for the slots excluding its OWN hold, or it would hide the time it just took', async () => {
    const el = await mount();
    await bindUpTo(el);
    const asked = queries.filter((q) => q.name === 'appointments.availability.slots');
    expect(asked[asked.length - 1].params.exclude_hold_ref).toBe('req-1');
  });
});
