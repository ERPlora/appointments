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

const comandos: { name: string; payload: Record<string, unknown> }[] = [];
const consultas: { name: string; params: Record<string, unknown> }[] = [];

beforeEach(() => {
  comandos.length = 0;
  consultas.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    query: async (name: string, params: Record<string, unknown>) => {
      consultas.push({ name, params });
      return [
        {
          id: 'a1',
          appointment_number: 'A-001',
          customer_name: 'Ana',
          customer_phone: '600',
          service_name: 'Corte',
          staff_name: 'Eva',
          start_datetime: '2026-07-13T10:00:00.000Z',
          end_datetime: '2026-07-13T10:30:00.000Z',
          duration_minutes: 30,
          status: 'pending',
        },
      ];
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

type Tabla = HTMLElement & { addable: boolean; fill: boolean; panel: string; open: (p?: 'filters' | 'create') => void };
const tabla = (el: HTMLElement & { shadowRoot: ShadowRoot }) => el.shadowRoot.querySelector('ok-data-table') as Tabla | null;

describe('el alta vive DENTRO de la tabla (paridad con /employees e inventory)', () => {
  it('la tabla declara `addable` → pinta el «+» en su barra', async () => {
    const el = await montar();
    expect(tabla(el)?.addable, 'sin `addable` no hay «+» en la barra de la tabla').toBe(true);
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
    expect(sueltos.map((n) => n.tagName.toLowerCase()), 'el alcance de la consulta es día + estado').toEqual([
      'ion-input',
      'ion-select',
    ]);
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

describe('el alta sigue funcionando desde el panel', () => {
  it('crear una cita manda appointments.appointments.create y CIERRA el panel', async () => {
    const el = await montar();
    tabla(el)?.open('create');
    const wc = el as unknown as {
      newCustomer: string;
      newPhone: string;
      newService: string;
      newStart: string;
      newDuration: string;
      createAppointment: (ev: Event) => Promise<void>;
    };
    wc.newCustomer = 'Ana';
    wc.newPhone = '600123123';
    wc.newService = 'Corte';
    wc.newStart = '2026-07-13T10:00';
    wc.newDuration = '45';
    await wc.createAppointment(new Event('submit'));

    const alta = comandos.find((c) => c.name === 'appointments.appointments.create');
    expect(alta, 'no se mandó el alta de la cita').toBeTruthy();
    expect(alta!.payload.customer_name).toBe('Ana');
    expect(alta!.payload.service_name).toBe('Corte');
    expect(alta!.payload.duration_minutes).toBe(45);
    expect(tabla(el)?.panel, 'el panel de alta se queda abierto tras crear').toBe('none');
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
