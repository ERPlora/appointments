// Contrato de la BARRA de la agenda de citas.
//
// El alta de una cita vive DENTRO de `ok-data-table`, detrás del «+» de su barra (panel
// `slot="create"`), igual que /employees del core y que el CRUD de productos de `inventory`.
// Fuera de la tabla no queda ningún control de ALTA, y el título lo pinta el topbar del shell.
//
// Lo que SÍ se queda fuera (y por eso está fijado aquí, para que nadie lo "arregle" moviéndolo al
// embudo de la tabla): el ALCANCE de la consulta — día y estado. `appointments.appointments.list`
// NO tiene bloque `list` en el module.json: es una query con binds (`day_start`/`day_end`/`status`/
// `staff_id`/`limit`), no una lista paginada del motor. El día es el que decide QUÉ se carga (la
// tabla no tiene ni columna de fecha), así que es un control de la vista, no un filtro de columna.
import { beforeEach, describe, expect, it } from 'vitest';

// appointments#12 — the clock of these fixtures is PINNED, it is not the machine's.
// Until now these tests built their instants with `new Date(y, m, d, h, mi)` and compared them
// against the component's output: green in Spain, red anywhere else, and green for the wrong
// reason (device == business by luck). The business zone is declared on the SDK stub below, the
// same way the shell publishes it in production, and the device is pinned to match it here so the
// assertions stay about WIRING. That the two can DISAGREE is proven in
// `erp-appointments-business-clock.test.ts`, with the device in Auckland.
process.env.TZ = 'Europe/Madrid';

const comandos: { name: string; payload: Record<string, unknown> }[] = [];
const consultas: { name: string; params: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  consultas.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    // The business timezone the runtime resolved (hub#1022) — what `erplora.timezone` carries.
    timezone: 'Europe/Madrid',
    // Shape-aware mock (appointments#21): the view also loads the linked catalogs
    // (customers/services/staff, paginated {rows}) and the module settings.
    query: async (name: string, params: Record<string, unknown>) => {
      consultas.push({ name, params });
      switch (name) {
        case 'customers.list':
          return { rows: [{ id: 'c1', name: 'Ana', phone: '600', email: '' }], total: 1 };
        case 'services.services.list':
          return { rows: [{ id: 'sv1', name: 'Corte', price: 2000, duration_minutes: 30 }], total: 1 };
        case 'staff.members.list':
          return { rows: [{ id: 's1', full_name: 'Eva', status: 'active', is_bookable: 1 }], total: 1 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 8, calendar_end_hour: 20, default_duration: 60 }];
        default:
          return [
            {
              id: 'a1',
              appointment_number: 'A-001',
              customer_id: 'c1',
              customer_name: 'Ana',
              service_id: 'sv1',
              service_name: 'Corte',
              staff_id: 's1',
              staff_name: 'Eva',
              start_datetime: '2026-07-13T10:00:00.000Z',
              end_datetime: '2026-07-13T10:30:00.000Z',
              duration_minutes: 30,
              status: 'pending',
            },
          ];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      comandos.push({ name, payload });
      return {};
    },
    on: () => () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

async function montar() {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el as HTMLElement & { shadowRoot: ShadowRoot };
}

type Tabla = HTMLElement & {
  addable: boolean;
  primaryAction?: { label: string; icon?: string };
  fill: boolean;
  panel: string;
  open: (p?: 'filters' | 'create') => void;
};
const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) => el.shadowRoot.querySelector('ok-data-table') as Tabla | null;

describe('el alta vive DENTRO de la tabla (paridad con /employees e inventory)', () => {
  // El «+» lo despacha el MÓDULO (`primaryAction`), no `addable` (appointments#42). Con `addable`
  // la tabla abría el panel por su cuenta y el módulo no se enteraba; desde que el panel también
  // sirve para REPROGRAMAR, eso dejaba el formulario de mover la cita anterior al pulsar «+».
  // Lo que se exige aquí sigue siendo lo mismo: hay un «+» y abre el panel de alta.
  it('la barra de la tabla pinta el «+» y abre el panel de ALTA', async () => {
    const el = await montar();
    const t = tabla(el)!;
    expect(t.primaryAction, 'sin acción primaria no hay «+» en la barra de la tabla').toBeTruthy();
    expect(t.primaryAction!.icon).toBe('add');

    t.dispatchEvent(new CustomEvent('primaryAction', { detail: {}, bubbles: true, composed: true }));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    expect(
      el.shadowRoot.querySelector('form[slot="create"]')?.getAttribute('data-mode'),
      'el «+» siempre abre el alta, nunca una reprogramación a medias',
    ).toBe('create');
  });

  it('la tabla llena el alto de la vista (`fill`)', async () => {
    const el = await montar();
    expect(tabla(el)?.fill, 'sin `fill` la tabla no ocupa el alto: sin scroll interno ni pie fijo').toBe(true);
  });

  it('el formulario de alta se proyecta en el panel `create` de la tabla', async () => {
    const el = await montar();
    const form = el.shadowRoot.querySelector('form[slot="create"]');
    expect(form, 'el formulario de alta no está en el slot `create`').toBeTruthy();
    expect(form?.closest('ok-data-table'), 'el formulario de alta cuelga fuera de la tabla').toBeTruthy();
  });

  it('no queda NINGÚN formulario fuera de la tabla', async () => {
    const el = await montar();
    const fuera = [...el.shadowRoot.querySelectorAll('form')].filter((n) => !n.closest('ok-data-table'));
    expect(fuera.length, 'hay un formulario de alta suelto encima de la tabla').toBe(0);
  });

  it('los únicos controles fuera de la tabla son los del ALCANCE de la consulta (día y estado)', async () => {
    const el = await montar();
    const sueltos = [...el.shadowRoot.querySelectorAll('ion-input, ion-select, ion-button')].filter(
      (n) => !n.closest('ok-data-table'),
    );
    expect(sueltos.every((n) => n.closest('.filters')), 'hay controles de alta sueltos fuera de la tabla').toBe(true);
    // appointments#93 — el alcance sigue siendo día + estado, pero el DÍA se pasa además con dos
    // flechas (es el gesto de toda agenda de salón, y la vista por profesional ya lo tenía). La
    // lista de tags era un proxy del contrato; lo que de verdad se exige es que ahí fuera no haya
    // NADA del alta, así que se comprueba por su papel, que es más fuerte que contar etiquetas.
    expect(
      sueltos.map((n) => n.getAttribute('data-role') ?? n.tagName.toLowerCase()).sort(),
      // appointments#205: the day carries its inline calendar (the native input paints the
      // BROWSER language, not the hub one) — still the query scope, not the create form.
      'el alcance de la consulta es día (con sus dos pasos y su calendario) + estado',
    ).toEqual(['day', 'day-calendar', 'next-day', 'prev-day', 'status']);
  });

  it('la vista no pinta su propio título (lo pone el topbar del shell)', async () => {
    const el = await montar();
    expect(el.shadowRoot.querySelector('h2'), 'el título duplicado: ya lo pinta el topbar').toBeNull();
  });
});

describe('el estado de la cita es de dominio cerrado → se elige, no se teclea', () => {
  it('el selector de estado ofrece los 6 estados de la máquina (+ «todos»)', async () => {
    const el = await montar();
    const opciones = [...el.shadowRoot.querySelectorAll('.filters ion-select-option')].map((o) =>
      (o as HTMLElement & { value?: string }).value ?? o.getAttribute('value'),
    );
    expect(opciones, 'el estado no ofrece el dominio cerrado de la migración').toEqual([
      '',
      'pending',
      'confirmed',
      'in_progress',
      'completed',
      'cancelled',
      'no_show',
    ]);
  });
});

// appointments#21: the create panel books against LINKED records (customer/service/staff
// ids picked from their modules), no longer free text — the old free-text contract is
// superseded by the issue spec (a real day needs the links for the per-professional view,
// availability and the appointment→sale handoff).
describe('el alta sigue funcionando desde el panel', () => {
  it('crear una cita manda appointments.appointments.create con los IDs y CIERRA el panel', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    const wc = el as unknown as {
      newCustomerId: string;
      newServiceId: string;
      newStaffId: string;
      newStart: string;
      newDuration: string;
      createAppointment: (ev: Event) => Promise<void>;
    };
    wc.newCustomerId = 'c1';
    wc.newServiceId = 'sv1';
    wc.newStaffId = 's1';
    wc.newStart = '2026-07-13T10:00';
    wc.newDuration = '45';
    await wc.createAppointment(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'appointments.appointments.create');
    expect(alta, 'no se mandó el alta de la cita').toBeTruthy();
    expect(alta!.payload.customer_id).toBe('c1');
    expect(alta!.payload.customer_name).toBe('Ana');
    expect(alta!.payload.service_id).toBe('sv1');
    expect(alta!.payload.service_name).toBe('Corte');
    expect(alta!.payload.staff_id).toBe('s1');
    expect(alta!.payload.duration_minutes).toBe(45);
    // appointments#76: the stored text carries the SALON's wall clock + its local offset, not a
    // UTC wall. The instant is the same the receptionist picked; the wall part is what the
    // availability engine compares row against row (a UTC wall = a window tatted by the offset).
    expect(
      new Date(alta!.payload.start_datetime as string).getTime(),
      'the sent instant does not match the picked time',
    ).toBe(new Date('2026-07-13T10:00').getTime());
    expect(String(alta!.payload.start_datetime).slice(0, 16), 'the sent WALL clock shifted').toBe('2026-07-13T10:00');
    expect(tabla(el)?.panel, 'el panel de alta se queda abierto tras crear').toBe('none');
  });
});

// appointments#75: choosing a service PRE-FILLS «Min.» with its catalogue duration. The screen
// already knew the number (it sent it in the payload) but painted the field EMPTY with the
// duration only as a pale placeholder: the receptionist could not see what the booking would
// last, so she could neither spot a wrong catalogue nor trim it by eye. The service IS the
// duration (Fresha, Vagaro, Square Appointments, Booksy); the operator edits the exception.
describe('al elegir servicio, «Min.» muestra la duración del catálogo (appointments#75)', () => {
  const elegirServicio = async (el: HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> }, id: string) => {
    const service = el.shadowRoot.querySelector('[data-role="service"]') as HTMLElement & { value?: string };
    service.value = id;
    service.dispatchEvent(new Event('ionChange'));
    await el.updateComplete;
  };

  it('elegir un servicio de 30 min rellena el campo Min. con 30', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    await elegirServicio(el as never, 'sv1');
    const minutes = el.shadowRoot.querySelector('[data-role="duration"]') as HTMLElement & { value?: string };
    expect(minutes?.value, 'el campo Min. sigue vacío: la duración solo está en el placeholder').toBe('30');
  });

  it('la excepción tecleada por la recepcionista sigue mandando en el payload', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    await elegirServicio(el as never, 'sv1');
    const wc = el as unknown as {
      newCustomerId: string;
      newStaffId: string;
      newStart: string;
      createAppointment: (ev: Event) => Promise<void>;
    };
    const minutes = el.shadowRoot.querySelector('[data-role="duration"]') as HTMLElement & { value?: string };
    minutes.value = '45';
    minutes.dispatchEvent(new Event('ionInput'));
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    wc.newCustomerId = 'c1';
    wc.newStaffId = 's1';
    wc.newStart = '2026-07-13T10:00';
    await wc.createAppointment(new Event('submit'));
    const alta = comandos.find((c) => c.name === 'appointments.appointments.create');
    expect(alta?.payload.duration_minutes, 'la excepción tecleada se perdió').toBe(45);
  });
});

// La HORA de la cita: el módulo guarda en UTC (el propio alta hace `new Date(local).toISOString()`),
// así que al PINTARLA hay que devolverla a la hora LOCAL del salón. Se pintaba con
// `toISOString().slice(11,16)` — o sea, en UTC —, y una cita creada a las 09:30 en Madrid (07:30Z)
// se listaba como «07:30»: la recepcionista veía el salón lleno dos horas antes de abrir.
describe('hora de la cita (se guarda en UTC, se pinta en LOCAL)', () => {
  it('una cita de las 09:30 en Madrid (07:30Z) se lista a las 09:30', async () => {
    const el = await montar();
    const cols = (el as unknown as { columns: { key: string; format?: (r: unknown) => string }[] })
      .columns;
    const colHora = cols.find((c) => c.key === 'start_datetime');

    // 07:30Z = 09:30 en Europe/Madrid (verano). El test corre con TZ=Europe/Madrid (vitest.config).
    const pintada = colHora?.format?.({ start_datetime: '2026-07-20T07:30:00.000Z' });
    const esperada = new Date('2026-07-20T07:30:00.000Z').toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(pintada, 'la agenda pinta la hora en UTC, no en la hora del salón').toBe(esperada);
  });
});

// ── appointments#155 · el aviso donde está la persona, y la walk-in que YA está en la silla ────
//
// La recepcionista apuntaba la clienta que acababa de entrar, pulsaba «Añadir cita», el botón
// decía «Guardando…» y volvía a «Añadir cita» sin más: el rechazo se pintaba en el
// `ok-inline-feedback` de la LISTA, que el panel del «+» tapa entero, y el camino de crear ni
// siquiera lanzaba un toast. Se veía al cerrar el formulario, cuando ya había pulsado tres veces.
//
// Y el rechazo en sí era el segundo problema: en un salón se apunta a diario lo que ya ha
// empezado. Decidido con el mercado (Mindbody/Booker trae el interruptor con ese nombre —«Allow
// Appointments in the Past»—, Acuity AVISA sin impedirlo, y donde está bloqueado —Calendly,
// GoHighLevel— es la queja de siempre): el mostrador declara `allow_past` y la cita se guarda.
describe('el rechazo del alta se ve DENTRO del formulario (appointments#155)', () => {
  const rechazar = (code: string) => {
    (globalThis as Record<string, any>).erplora.command = async (
      name: string,
      payload: Record<string, unknown>,
    ) => {
      comandos.push({ name, payload });
      throw Object.assign(new Error('refused'), { code });
    };
  };

  const rellenarYEnviar = async (el: HTMLElement & { shadowRoot: ShadowRoot }, start = '2026-07-13T10:00') => {
    const wc = el as unknown as {
      newCustomerId: string;
      newServiceId: string;
      newStaffId: string;
      newStart: string;
      updateComplete: Promise<unknown>;
      createAppointment: (ev: Event) => Promise<void>;
    };
    wc.newCustomerId = 'c1';
    wc.newServiceId = 'sv1';
    wc.newStaffId = 's1';
    wc.newStart = start;
    await wc.createAppointment(new Event('submit'));
    await wc.updateComplete;
  };

  it('pinta el mensaje DENTRO del panel de alta, no en la lista de detrás', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    rechazar('appointments.invalid_start');
    await rellenarYEnviar(el);
    const dentro = el.shadowRoot.querySelector('form[data-mode="create"] ok-inline-feedback[tone="danger"]');
    expect(dentro, 'el rechazo del alta se sigue pintando detrás del formulario').toBeTruthy();
  });

  it('además avisa con un toast, igual que el camino de mover la cita', async () => {
    const avisos: { type?: string; message?: string }[] = [];
    (globalThis as Record<string, any>).erplora.notify = (a: { type?: string; message?: string }) =>
      avisos.push(a);
    const el = await montar();
    tabla(el)?.open('create');
    rechazar('appointments.invalid_start');
    await rellenarYEnviar(el);
    expect(avisos.map((a) => a.type), 'el alta rechazada no notifica nada').toContain('error');
  });

  it('el mensaje se va al reintentar, no se queda pegado del intento anterior', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    rechazar('appointments.invalid_start');
    await rellenarYEnviar(el);
    (globalThis as Record<string, any>).erplora.command = async (
      name: string,
      payload: Record<string, unknown>,
    ) => {
      comandos.push({ name, payload });
      return {};
    };
    await rellenarYEnviar(el);
    expect(
      el.shadowRoot.querySelector('form[data-mode="create"] ok-inline-feedback[tone="danger"]'),
      'el aviso del intento anterior sobrevive al alta que sí funcionó',
    ).toBeFalsy();
  });

  it('el mostrador DECLARA `allow_past`: la walk-in que ya está en la silla se guarda', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    await rellenarYEnviar(el);
    const alta = comandos.find((c) => c.name === 'appointments.appointments.create');
    expect(
      alta?.payload.allow_past,
      'sin la declaración del mostrador el hub rechaza la hora que acaba de pasar',
    ).toBe(true);
  });

  // appointments#157: la antelación mínima es la ventana del CLIENTE (Fresha/Booksy la archivan en
  // la reserva online; Square/Mindbody la acotan al canal de cliente). La recepcionista que da hora
  // «para dentro de media hora» la declara y el hub no le contesta `too_soon`.
  it('el mostrador DECLARA `allow_short_notice`: da hora para dentro de media hora', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    await rellenarYEnviar(el);
    const alta = comandos.find((c) => c.name === 'appointments.appointments.create');
    expect(
      alta?.payload.allow_short_notice,
      'sin la declaración del mostrador el hub aplica la antelación de la reserva online',
    ).toBe(true);
  });

  it('avisa en el formulario cuando la hora elegida YA ha pasado', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    const wc = el as unknown as { newStart: string; updateComplete: Promise<unknown> };
    wc.newStart = '2020-01-01T10:00';
    await wc.updateComplete;
    expect(
      el.shadowRoot.querySelector('form[data-mode="create"] ok-inline-feedback[tone="warning"]'),
      'la cita se guardará en el pasado y el formulario no lo dice',
    ).toBeTruthy();
  });

  it('con una hora futura no avisa de nada', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    const wc = el as unknown as { newStart: string; updateComplete: Promise<unknown> };
    wc.newStart = '2099-01-01T10:00';
    await wc.updateComplete;
    expect(
      el.shadowRoot.querySelector('form[data-mode="create"] ok-inline-feedback[tone="warning"]'),
      'un aviso permanente es un aviso que nadie lee',
    ).toBeFalsy();
  });
});
