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
/** What a command's HANDLER answers in THIS test — the `result` alone; the mock wraps it the way
 *  the runtime does.
 *
 *  This mock used to hand the answer back bare, on the belief that the SDK unwrapped it. It does
 *  not: `unwrap(env)` returns `env.data`, and the handler's answer travels INSIDE that, under
 *  `result` (hub#70), next to `new_ids` and `operations` — which is exactly how every other module
 *  reads one (`command<{ new_ids?: string[] }>('customers.create', …)`). Measured against
 *  `ghcr.io/erplora/hub:dev` while writing appointments#117:
 *  `{"new_ids":[],"ok":true,"operations":0,"result":{"source":"schedules","spans":[…]}}`.
 *  A mock that invents a friendlier envelope than the runtime's is a green light for a screen that
 *  cannot work — it is what let the appointments#105 fix ship reading a field that is never there. */
const commandAnswers: Record<string, unknown> = {};
/** What a command REFUSES with in this test, so degradation can be pinned as well as the happy path. */
const commandFailures: Record<string, Error> = {};
/** What a query answers in THIS test, when the default fixture is not the case under test. */
const queryAnswers: Record<string, unknown> = {};

beforeEach(() => {
  queries.length = 0;
  commands.length = 0;
  for (const k of Object.keys(commandAnswers)) delete commandAnswers[k];
  for (const k of Object.keys(commandFailures)) delete commandFailures[k];
  for (const k of Object.keys(queryAnswers)) delete queryAnswers[k];
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      if (name in queryAnswers) return queryAnswers[name];
      switch (name) {
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Marta', phone: '+34600111222' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Cut', duration_minutes: 30, is_bookable: 1 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva', status: 'active', is_bookable: 1 }], total: 1 };
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      const refusal = commandFailures[name];
      if (refusal) throw refusal;
      const envelope: Record<string, unknown> = { ok: true, operations: 0, new_ids: [] };
      if (name in commandAnswers) envelope.result = commandAnswers[name];
      // appointments#127: the free slots of a day are a HANDLER command now, not a Tier-0 query —
      // the hours belong to `schedules` and only the handler can read them. The envelope is the
      // one an unpaginated query used to answer (`{rows,total,limit,offset}`), inside `result`.
      else if (name === 'appointments.availability.slots') {
        const rows = [
          { slot_start: '2026-08-20T10:00:00', start_time: '10:00', end_time: '10:30' },
          { slot_start: '2026-08-20T11:00:00', start_time: '11:00', end_time: '11:30' },
        ];
        envelope.result = { rows, total: rows.length, limit: rows.length, offset: 0 };
      }
      return envelope;
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
    const asked = commands.filter((c) => c.name === 'appointments.availability.slots');
    expect(asked.length, 'the slots come from the hub, live').toBeGreaterThan(0);
    expect(asked[asked.length - 1].payload.duration_minutes).toBe(30);
    expect(
      queries.some((q) => q.name === 'appointments.availability.slots'),
      'the raw SQL half is the engine\u2019s read, not a door the screen may knock on',
    ).toBe(false);
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

  it('paints the clear «Cancel» in the medium tone from its own styles, not through color= (pm#392)', async () => {
    const el = await mount();
    await bindUpTo(el);
    const btn = shadow(el).querySelector('.cancel ion-button');
    expect(btn, 'the panel offers «Cancel»').not.toBeNull();
    expect(btn!.hasAttribute('color'), 'color= does not reach inside a shadow root').toBe(false);
    expect(btn!.getAttribute('fill')).toBe('clear');
    expect(btn!.classList.contains('tone-medium')).toBe(true);
    const css = (el.constructor as unknown as { elementStyles: { cssText: string }[] }).elementStyles
      .map((s) => s.cssText).join('\n').replace(/\s+/g, ' ');
    expect(css).toContain('ion-button.tone-medium[fill] {');
    expect(css).toContain('--color: var(--ion-color-medium, #636469)');
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
    const asked = commands.filter((c) => c.name === 'appointments.availability.slots');
    expect(asked[asked.length - 1].payload.exclude_hold_ref).toBe('req-1');
  });

  // ── appointments#105 · la pantalla mira LO MISMO que la puerta ───────────────────────────────
  //
  // Desde appointments#102 la autoridad del horario del negocio es `schedules`, y la puerta
  // (`appointments.appointments.create`) resuelve la fecha con su precedencia (ADR-0392). El SQL
  // de `availability.slots` no puede seguirla —una query de un módulo solo puede nombrar tablas de
  // ese módulo, así que `schedules_*` le está vedado por contrato—, de modo que para el hub que ya
  // movió sus horas la lista quedó OPTIMISTA: ofrecía las 10:00 a un salón que abre a las 11:00 y
  // `create` lo rechazaba un clic después con `appointments.outside_schedule`. La pantalla
  // contradiciendo a la puerta es exactamente el defecto que nombra appointments#105.
  //
  // El arreglo NO reimplementa la precedencia en TypeScript —eso sería una segunda autoridad, que
  // es la enfermedad, no la cura—: pregunta a `appointments.availability.day_opening`, que corre
  // la MISMA función que la puerta, y ofrece solo lo que quepa en lo que responde.
  async function pickService(el: Element) {
    const svc = shadow(el).querySelector('#svc') as HTMLSelectElement;
    svc.value = 'sv1';
    svc.dispatchEvent(new Event('change'));
    await settle(el);
  }

  function offeredTimes(el: Element): string[] {
    return [...shadow(el).querySelectorAll('.slot')].map((b) => (b.textContent ?? '').trim());
  }

  function lastSlotsQuery() {
    const asked = commands.filter((c) => c.name === 'appointments.availability.slots');
    return { name: asked[asked.length - 1].name, params: asked[asked.length - 1].payload };
  }

  // appointments#132: THE ENGINE DECIDES WHICH HOURS EXIST, THE SCREEN ONLY PAINTS THEM.
  //
  // Since appointments#127 `appointments.availability.slots` is a handler command that already
  // crosses its candidates with the open stretches of `schedules` — the very function the booking
  // door runs (ADR-0392). The filter this screen used to apply on top (the appointments#105 patch)
  // was a SECOND authority over the same question, and a second authority is the disease, not the
  // cure: the day the two disagree the screen wins silently, and an hour the engine kept on
  // purpose disappears with nobody able to say why. The screen keeps ASKING the door, because the
  // notices need it — an empty list cannot tell «shut» from «full» — but it no longer judges.
  it('paints the slots the engine hands back AS THEY COME, with no opinion of its own', async () => {
    // A shape the engine will not produce, on purpose: it keeps 08:00 (outside) and 12:45 (which
    // ends at 13:15, past closing) while the authority answers 11:00–13:00. Those two rows are the
    // ones a screen-side filter eats, so they are what makes this test fail if one comes back.
    commandAnswers['appointments.availability.slots'] = {
      rows: [
        { slot_start: '2026-08-20T08:00:00', slot_end: '2026-08-20T08:30:00', start_time: '08:00', end_time: '08:30' },
        { slot_start: '2026-08-20T11:00:00', slot_end: '2026-08-20T11:30:00', start_time: '11:00', end_time: '11:30' },
        { slot_start: '2026-08-20T12:45:00', slot_end: '2026-08-20T13:15:00', start_time: '12:45', end_time: '13:15' },
      ],
      total: 3,
      limit: 3,
      offset: 0,
    };
    commandAnswers['appointments.availability.day_opening'] = {
      source: 'schedules',
      spans: [{ start_minute: 660, end_minute: 780 }],
    };
    const el = await mount();
    await pickService(el);

    expect(
      offeredTimes(el),
      'not one row is dropped on the way to the screen: the engine already answered the hours',
    ).toEqual(['08:00', '11:00', '12:45']);
  });

  it('does not resurrect an hour the engine left out', async () => {
    // The other half of the same contract. The authority is open all morning and the engine still
    // hands back ONE slot, because a block, an appointment or a hold took the rest — verdicts the
    // screen cannot see. Filling the gaps from the opening hours would offer times already sold.
    commandAnswers['appointments.availability.slots'] = {
      rows: [
        { slot_start: '2026-08-20T11:00:00', slot_end: '2026-08-20T11:30:00', start_time: '11:00', end_time: '11:30' },
      ],
      total: 1,
      limit: 1,
      offset: 0,
    };
    commandAnswers['appointments.availability.day_opening'] = {
      source: 'schedules',
      spans: [{ start_minute: 540, end_minute: 1200 }],
    };
    const el = await mount();
    await pickService(el);

    expect(
      offeredTimes(el),
      'an open stretch is not a list of free hours: only the engine knows what is taken',
    ).toEqual(['11:00']);
  });

  it('asks the door about the very date it is showing, and the engine about that same one', async () => {
    // The authority opens 11:00-13:00 that day and the engine hands back the 11:00 it already
    // kept for it — that is the ONLY list the screen paints (appointments#132). What is pinned
    // here is that both questions are about the same date: asking the door about today while the
    // list is tomorrow's is how the closed-day notice ends up on the wrong day.
    commandAnswers['appointments.availability.slots'] = {
      rows: [
        { slot_start: '2026-08-20T11:00:00', slot_end: '2026-08-20T11:30:00', start_time: '11:00', end_time: '11:30' },
      ],
      total: 1,
      limit: 1,
      offset: 0,
    };
    commandAnswers['appointments.availability.day_opening'] = {
      source: 'schedules',
      spans: [{ start_minute: 660, end_minute: 780 }],
    };
    const el = await mount();
    await pickService(el);

    expect(
      commands.filter((c) => c.name === 'appointments.availability.day_opening').length,
      'la pantalla pregunta por la fecha que está mostrando, no adivina el horario',
    ).toBeGreaterThan(0);
    expect(
      commands.find((c) => c.name === 'appointments.availability.day_opening')?.payload.date,
      'y pregunta por LA fecha del selector',
    ).toBe(lastSlotsQuery().params.date);
    expect(
      'schedules_answers' in lastSlotsQuery().params,
      'appointments#118: el crucero se fue con las tablas propias que apagaba',
    ).toBe(false);
    expect(offeredTimes(el), 'y pinta la lista del motor, entera').toEqual(['11:00']);
  });

  it('says the business is SHUT, which an empty list cannot say on its own', async () => {
    // On a closed day the engine itself answers zero rows — `DayOpening::Closed` leaves no open
    // stretch for a candidate to fit into. That half is pinned where it now lives: the handler's
    // `slots_offers_nothing_on_a_day_the_authority_shuts` and `tests/availability.hub.test.py` §5,
    // against a real kernel. What is left for the screen is the REASON, and that is why
    // `day_opening` is still asked after appointments#132: «closed today» and «no times left» are
    // different sentences for whoever is on the phone, and an empty list says neither.
    commandAnswers['appointments.availability.slots'] = { rows: [], total: 0, limit: 0, offset: 0 };
    commandAnswers['appointments.availability.day_opening'] = { source: 'schedules', spans: [] };
    const el = await mount();
    await pickService(el);

    expect(offeredTimes(el), 'un día cerrado no tiene huecos, los proponga quien los proponga').toEqual([]);
    expect(
      shadow(el).textContent,
      'y se dice que está CERRADO, no que se hayan agotado los huecos: son cosas distintas para quien atiende',
    ).toContain('ui.bookingDayClosed');
  });

  it('says the day is FULL, not shut, when the business is open and the engine has nothing left', async () => {
    // The other direction of the same sentence, and the one that only the door can tell apart. The
    // salon IS open all day; the engine hands back zero rows because a block, the appointments
    // already taken or a hold ate every candidate. «Closed today» here is a LIE the person on the
    // phone acts on — they stop asking for that date. This is the half of appointments#132 that
    // pays for `askDayOpening()` surviving: without it an empty list has only one caption, and the
    // reason the call was kept stops being true.
    commandAnswers['appointments.availability.slots'] = { rows: [], total: 0, limit: 0, offset: 0 };
    commandAnswers['appointments.availability.day_opening'] = {
      source: 'schedules',
      spans: [{ start_minute: 540, end_minute: 1200 }],
    };
    const el = await mount();
    await pickService(el);

    expect(offeredTimes(el), 'lleno es lleno: no hay hueco que pintar').toEqual([]);
    expect(
      shadow(el).textContent,
      'pero el negocio ABRE ese día: decir «cerrado» manda a la clienta a otra fecha por una razón falsa',
    ).toContain('ui.bookingNoSlots');
    expect(
      shadow(el).textContent,
      'y no se dice CERRADO, que es la otra frase',
    ).not.toContain('ui.bookingDayClosed');
  });

  it('offers the whole day when the authority carries no rule for the date', async () => {
    // `source: "unset"` = la autoridad calla, y entonces la puerta no rechaza NADA (appointments
    // #118). Filtrar aquí borraría el día entero de una agenda que `create` habría aceptado.
    commandAnswers['appointments.availability.day_opening'] = { source: 'unset', spans: [] };
    const el = await mount();
    await pickService(el);

    expect(offeredTimes(el), 'un hub sin horario configurado no puede quedarse sin agenda').toEqual(['10:00', '11:00']);
    expect(
      shadow(el).textContent,
      'y no es un día CERRADO: nadie ha dicho que el negocio esté cerrado',
    ).not.toContain('ui.bookingDayClosed');
  });

  // 🪦 «drops the last slot of the day when it would run PAST closing time» vivía aquí y se fue con
  // appointments#132. Media franja no es franja —`create` exige que la cita TERMINE dentro del
  // tramo—, pero esa regla es del MOTOR desde appointments#127 y se prueba donde se aplica:
  // `handler/src/lib.rs::slots_keeps_only_the_hours_inside_the_open_stretches` (las 17:45 se van de
  // un 09:00-18:00) y `tests/availability.hub.test.py` §5 contra un kernel de verdad. Lo que le
  // toca a la pantalla —no volver a aplicarla— lo cubre el test de arriba, que le mete justo una
  // franja a caballo del cierre y exige que la pinte.

  function refusal(code: string): Error {
    return Object.assign(new Error(code), { code });
  }

  it('degrades instead of blocking when the role may not read the schedule', async () => {
    commandFailures['appointments.availability.day_opening'] = refusal('permission_denied');
    const el = await mount();
    await pickService(el);

    expect(
      offeredTimes(el),
      'no poder preguntar es peor lista, no LA LISTA VACÍA: reservar no puede depender de este permiso',
    ).toEqual(['10:00', '11:00']);
    expect(
      shadow(el).textContent,
      'un rol sin `view_schedule` es un ROL, no una avería: no se le grita al operador por ello',
    ).not.toContain('ui.openingUnknown');
  });

  it('says so out loud when the hours could not be checked for any other reason', async () => {
    // La avería SÍ se ve. Volver a la lista optimista en silencio es el defecto de #105 otra vez,
    // ahora con el arreglo puesto — y sin decirlo nadie se enteraría hasta que `create` rechazara.
    commandFailures['appointments.availability.day_opening'] = refusal('internal_error');
    const el = await mount();
    await pickService(el);

    expect(
      offeredTimes(el),
      'avisar no es bloquear: con el horario en duda se sigue pudiendo reservar',
    ).toEqual(['10:00', '11:00']);
    expect(
      shadow(el).textContent,
      'un fallo que no se ve no existe: la lista ha dejado de estar comprobada y hay que decirlo',
    ).toContain('ui.openingUnknown');
  });

  it('never asks a role that cannot read the schedule, and books all the same', async () => {
    ((globalThis as Record<string, unknown>).erplora as { hasPermission: (p: string) => boolean })
      .hasPermission = (p: string) => p !== 'appointments.view_schedule';
    const el = await mount();
    await pickService(el);

    expect(
      commands.filter((c) => c.name === 'appointments.availability.day_opening'),
      'una llamada que va a ser rechazada por contrato no se hace',
    ).toEqual([]);
    expect(offeredTimes(el)).toEqual(['10:00', '11:00']);
    expect(shadow(el).textContent).not.toContain('ui.openingUnknown');
  });
});
