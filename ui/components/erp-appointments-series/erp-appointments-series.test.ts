// appointments#91 — LA PANTALLA DE SERIES.
//
// Hasta aquí la única puerta a una serie entraba por la agenda, encima de una ocurrencia concreta:
// una serie cuyas ocurrencias no se han materializado todavía (o cuya ventana ya pasó) era
// literalmente invisible, y `appointments.recurring.list` / `.get` no los pintaba nadie.
//
// DECISIÓN DE MERCADO (lo que hacen los que llevan años con clientes reales):
// · Fresha pone las opciones de repetición EN la cita («Doesn't repeat» → frecuencia + fin) y
//   materializa hasta 12 meses por delante; Vagaro deja editar la serie entera o sacar una cita de
//   ella; Google Calendar parte la serie al cambiar la regla («this and following»).
// · Ninguno tiene una «página de series» suelta en el menú: la serie se gestiona DONDE se vive la
//   agenda. Por eso esto NO es una entrada de navegación nueva —sería una página huérfana— sino una
//   vista más del módulo de agenda, al lado de «Lista» y «Por profesional».
//
// Y esta pantalla es donde vive el cambio de PAUTA (appointments#90): el panel de reprogramar mueve
// un HUECO, y meter ahí un selector de frecuencia sería pedirle a la recepcionista que redefina la
// serie mientras arrastra una cita.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
// El catálogo real: los tests afirman sobre la CLAVE que se pinta, nunca sobre la prosa
// (ADR-0055) — comparando contra el mismo catálogo que traduce la pantalla.
import esLocale from '../../../locales/es.json';

const commands: { name: string; payload: Record<string, unknown> }[] = [];
const queries: { name: string; params: Record<string, unknown> | undefined }[] = [];

/** Una serie tal y como la devuelve `appointments.recurring.list` (sin los tres ids). */
const SERIES_ROW = {
  id: 'r1',
  customer_name: 'Ana López',
  service_name: 'Corte',
  staff_name: 'Eva Pro',
  frequency: 'weekly',
  day_of_week: 0,
  time: '11:00',
  duration_minutes: 30,
  start_date: '2020-01-06',
  end_date: null,
  max_occurrences: null,
  is_active: 1,
};

/** …y la misma serie por `appointments.recurring.get`, que SÍ trae los tres ids. */
const SERIES_TEMPLATE = {
  ...SERIES_ROW,
  customer_id: 'c1',
  service_id: 'sv1',
  staff_id: 's1',
  split_from_id: null,
};

/** Dos ocurrencias pasadas y dos futuras: el corte tiene que caer en la PRIMERA futura. */
const OCCURRENCES = [
  { id: 'a1', occurrence_date: '2020-01-06', status: 'completed', converted_sale_id: null },
  { id: 'a2', occurrence_date: '2020-01-13', status: 'cancelled', converted_sale_id: null },
  { id: 'a3', occurrence_date: '2099-01-05', status: 'confirmed', converted_sale_id: null },
  { id: 'a4', occurrence_date: '2099-01-12', status: 'pending', converted_sale_id: null },
];

let listResult: unknown = { rows: [SERIES_ROW], total: 1 };
let failing = '';
let updateResult: Record<string, unknown> = {
  recurring_id: 'r2',
  split: true,
  pattern_changed: true,
  moved: 0,
  cancelled_pattern_change: 2,
  locked_invoiced: 0,
  kept_cancelled: 0,
};

beforeEach(() => {
  commands.length = 0;
  queries.length = 0;
  failing = '';
  listResult = { rows: [SERIES_ROW], total: 1 };
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params?: Record<string, unknown>) => {
      queries.push({ name, params });
      if (failing === name) throw new Error('boom');
      switch (name) {
        case 'appointments.recurring.list':
          return listResult;
        case 'appointments.recurring.get':
          return [SERIES_TEMPLATE];
        case 'appointments.recurring.occurrences':
          return OCCURRENCES;
        default:
          return [];
      }
    },
    command: async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      if (failing === name) throw new Error('boom');
      return name === 'appointments.recurring.update' ? updateResult : { ok: true };
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
  series: Record<string, unknown>[];
  loading: boolean;
  error: string;
  editingId: string;
  editFrequency: string;
  editDayOfWeek: string;
  editTime: string;
  editDuration: string;
  fromOccurrence: string;
  refresh: () => Promise<void>;
  openSeries: (row: Record<string, unknown>) => Promise<void>;
  submitEdit: (e: Event) => Promise<void>;
  materializeSeries: (row: Record<string, unknown>) => Promise<void>;
  deleteSeries: (row: Record<string, unknown>) => Promise<void>;
  busySeriesId: string;
  toggleSeriesActive: (
    row: Record<string, unknown>,
    nextActive: boolean,
    toggle?: { checked: boolean },
  ) => Promise<void>;
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-series');
  const el = document.createElement('erp-appointments-series') as unknown as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
};

describe('la lista de series', () => {
  it('pinta las series del hub', async () => {
    const el = await mount();
    expect(el.series.map((s) => s.id)).toEqual(['r1']);
    expect(queries.some((q) => q.name === 'appointments.recurring.list')).toBe(true);
  });

  it('tiene estado VACÍO propio, no una tabla en blanco', async () => {
    listResult = { rows: [], total: 0 };
    const el = await mount();
    const table = el.shadowRoot.querySelector('ok-data-table') as HTMLElement & {
      emptyMessage?: string;
    };
    expect(table?.emptyMessage).toBe(esLocale.ui.seriesEmpty);
    expect(table?.emptyMessage).not.toBe(esLocale.ui.loading);
  });

  it('cuando la consulta falla lo DICE, en vez de quedarse vacía', async () => {
    failing = 'appointments.recurring.list';
    const el = await mount();
    expect(el.error).not.toBe('');
    expect(el.shadowRoot.querySelector('ok-inline-feedback[tone="danger"]')).toBeTruthy();
  });
});

describe('abrir una serie', () => {
  it('carga su plantilla y sus ocurrencias, y corta en la PRIMERA futura', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    expect(el.editingId).toBe('r1');
    expect(el.editFrequency).toBe('weekly');
    expect(el.editTime).toBe('11:00');
    // Ni una fecha pasada: el pasado está congelado y el servidor adelantaría el corte igual.
    expect(el.fromOccurrence).toBe('2099-01-05');
    expect(queries.some((q) => q.name === 'appointments.recurring.occurrences')).toBe(true);
  });

  it('dice de qué mitad salió cuando la serie viene de un split', async () => {
    const el = await mount();
    (SERIES_TEMPLATE as Record<string, unknown>).split_from_id = 'r0';
    try {
      await el.openSeries(SERIES_ROW);
      await el.updateComplete;
      expect(el.shadowRoot.querySelector('[data-role="split-from"]')).toBeTruthy();
    } finally {
      (SERIES_TEMPLATE as Record<string, unknown>).split_from_id = null;
    }
  });
});

describe('cambiar la PAUTA desde la pantalla de series (appointments#90)', () => {
  it('manda recurring.update con el alcance cerrado, el corte y SOLO lo que cambió', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    el.editFrequency = 'biweekly';
    await el.submitEdit(new Event('submit'));

    const sent = commands.find((c) => c.name === 'appointments.recurring.update');
    expect(sent?.payload).toEqual({
      recurring_id: 'r1',
      scope: 'this_and_following',
      from_occurrence_date: '2099-01-05',
      frequency: 'biweekly',
    });
  });

  it('el día de la semana se puede VACIAR, y viaja como null explícito', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    el.editDayOfWeek = '';
    await el.submitEdit(new Event('submit'));
    const sent = commands.find((c) => c.name === 'appointments.recurring.update');
    expect(sent?.payload.day_of_week).toBeNull();
  });

  it('tras cambiar la pauta RESERVA las citas de la serie nueva — si no, la clienta se queda sin nada en el día nuevo', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    el.editFrequency = 'monthly';
    await el.submitEdit(new Event('submit'));

    const booked = commands.find((c) => c.name === 'appointments.recurring.materialize');
    expect(booked?.payload).toEqual({
      // La mitad NUEVA, la que contestó el servidor — no la que se abrió en pantalla.
      recurring_id: 'r2',
      customer_id: 'c1',
      service_id: 'sv1',
      staff_id: 's1',
    });
  });

  it('mover solo la HORA no reserva nada: esas citas se recolocan en sitio', async () => {
    updateResult = { ...updateResult, pattern_changed: false, split: true, moved: 2 };
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    el.editTime = '12:30';
    await el.submitEdit(new Event('submit'));
    expect(commands.map((c) => c.name)).toEqual(['appointments.recurring.update']);
    updateResult = { ...updateResult, pattern_changed: true };
  });

  it('guardar sin tocar nada NO escribe: el servidor lo rechazaría y el panel habría mentido', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    await el.submitEdit(new Event('submit'));
    expect(commands).toEqual([]);
  });
});

describe('las otras dos puertas que faltaban', () => {
  it('materializa la ventana de una serie con los tres ids de su plantilla', async () => {
    const el = await mount();
    await el.materializeSeries(SERIES_ROW);
    const booked = commands.find((c) => c.name === 'appointments.recurring.materialize');
    expect(booked?.payload).toEqual({
      recurring_id: 'r1',
      customer_id: 'c1',
      service_id: 'sv1',
      staff_id: 's1',
    });
  });

  it('borra una serie por su id', async () => {
    const el = await mount();
    await el.deleteSeries(SERIES_ROW);
    expect(commands.find((c) => c.name === 'appointments.recurring.delete')?.payload).toEqual({
      recurring_id: 'r1',
    });
  });
});

// appointments#110 — desactivar una serie sin borrarla, resto declarado de #91 (PR #109). El
// command estaba ausente y `recurring_list.sql` filtraba `is_active = 1` en duro: un botón
// «desactivar» sin arreglar eso habría hecho invisible a la serie, sin forma de reactivarla.
describe('desactivar/reactivar una serie sin borrarla (appointments#110)', () => {
  it('desactiva una serie activa por su id', async () => {
    const el = await mount();
    await el.toggleSeriesActive(SERIES_ROW, false);
    expect(commands.find((c) => c.name === 'appointments.recurring.deactivate')?.payload).toEqual({
      recurring_id: 'r1',
    });
  });

  it('reactiva una serie desactivada por su id', async () => {
    const el = await mount();
    await el.toggleSeriesActive({ ...SERIES_ROW, is_active: 0 }, true);
    expect(commands.find((c) => c.name === 'appointments.recurring.activate')?.payload).toEqual({
      recurring_id: 'r1',
    });
  });

  it('una serie desactivada SIGUE en la lista — la trampa que #91 rechazó', async () => {
    listResult = { rows: [{ ...SERIES_ROW, is_active: 0 }], total: 1 };
    const el = await mount();
    expect(el.series).toEqual([{ ...SERIES_ROW, is_active: 0 }]);
  });

  it('si el toggle falla lo DICE, en vez de fingir que se desactivó', async () => {
    const el = await mount();
    failing = 'appointments.recurring.deactivate';
    await el.toggleSeriesActive(SERIES_ROW, false);
    expect(el.error).toBeTruthy();
  });

  // Review of #114: the `ion-toggle` had already flipped itself when the command fails, and the
  // list row does not change (still `is_active: 1`), so Lit does not touch `?checked` again: the
  // switch stayed «off» over a series that is still active. A visible error is not enough if the
  // control lies underneath.
  it('when the toggle fails, the switch goes BACK to where it was', async () => {
    const el = await mount();
    failing = 'appointments.recurring.deactivate';
    const toggle = { checked: false };
    await el.toggleSeriesActive(SERIES_ROW, false, toggle);
    expect(el.error).toBeTruthy();
    expect(toggle.checked).toBe(true);
  });

  it('while the command is in flight the row is BUSY and a second tap fires nothing', async () => {
    const el = await mount();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const sdk = (globalThis as Record<string, unknown>).erplora as { command: unknown };
    sdk.command = async (name: string, payload: Record<string, unknown>) => {
      commands.push({ name, payload });
      await gate;
      return { ok: true };
    };
    const first = el.toggleSeriesActive(SERIES_ROW, false);
    await Promise.resolve();
    expect(el.busySeriesId).toBe('r1');
    await el.toggleSeriesActive(SERIES_ROW, true);
    expect(commands.filter((c) => c.name.startsWith('appointments.recurring.'))).toHaveLength(1);
    release();
    await first;
    expect(el.busySeriesId).toBe('');
  });
});

// pm#450 (outfitkit#150): editing a series reused the ALTA panel with open('create'). The table now
// has an «edit» mode and takes the whole header title — also the dialog's `aria-label`, which read
// the generic «Form». The body has no repeated «Editing …» line; the `.labels.newRecord` override
// STAYS as the fallback for shells with OutfitKit < 0.1.94, which ignore `title` and paint
// `newRecord` for the «edit» panel too (hub:stable 1.1.29 ships 0.1.73).
describe('editing a series titles the panel header (pm#450)', () => {
  type Table = HTMLElement & {
    shadowRoot: ShadowRoot;
    updateComplete: Promise<unknown>;
    labels: Record<string, string>;
    open: (panel?: unknown, opts?: { title?: string }) => void;
  };
  const table = (el: Wc) => el.shadowRoot.querySelector('ok-data-table') as Table;

  it("opens the panel with open('edit', { title: «Edit repeating appointment» })", async () => {
    const el = await mount();
    const calls: unknown[][] = [];
    table(el).open = (...args: unknown[]) => void calls.push(args);
    await el.openSeries(SERIES_ROW);
    expect(calls).toEqual([['edit', { title: esLocale.ui.seriesEditTitle }]]);
  });

  it('an old shell paints the same title for the «edit» panel (labels fallback), not «New»', async () => {
    const el = await mount();
    await el.openSeries(SERIES_ROW);
    await el.updateComplete;
    await table(el).updateComplete;
    expect(table(el).labels.newRecord).toBe(esLocale.ui.seriesEditTitle);
    expect(table(el).shadowRoot.querySelector('.drawer .dh')?.textContent).toContain(esLocale.ui.seriesEditTitle);
    expect(el.shadowRoot.querySelector('[slot="create"]')?.getAttribute('data-mode')).toBe('series-edit');
  });
});
