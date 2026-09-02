// appointments#91 — LA PUERTA a las series está EN LA AGENDA.
//
// La issue lo dice sin rodeos: hoy sólo se llega a una serie desde una cita concreta, así que una
// serie sin ocurrencias materializadas (o con la ventana ya pasada) es invisible. La entrada nueva
// NO es una página con su icono en el menú —ninguno de los productos del sector la tiene: Fresha,
// Vagaro, Booksy y Square gestionan la serie desde la agenda— sino una vista más del mismo módulo,
// al lado de «Lista» y «Por profesional», que es donde la recepcionista ya está mirando.
process.env.TZ = 'Europe/Madrid';

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import esLocale from '../../../locales/es.json';

beforeEach(() => {
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string) => {
      switch (name) {
        case 'appointments.appointments.list':
          return [];
        case 'customers.list':
        case 'services.services.list':
        case 'staff.members.list':
          return { rows: [], total: 0 };
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 8, calendar_end_hour: 20 }];
        default:
          return [];
      }
    },
    command: async () => ({ ok: true }),
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
  view: string;
  refresh: () => Promise<void>;
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
};

describe('la agenda ofrece la vista de series', () => {
  it('el conmutador tiene la tercera opción, junto a lista y profesional', async () => {
    const el = await mount();
    const values = [...el.shadowRoot.querySelectorAll('ion-segment-button')].map((b) =>
      b.getAttribute('value'),
    );
    expect(values).toEqual(['list', 'staff', 'series']);
  });

  it('en «series» pinta la pantalla de series y NO la agenda del día', async () => {
    const el = await mount();
    el.view = 'series';
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('erp-appointments-series')).toBeTruthy();
    expect(el.shadowRoot.querySelector('ok-scheduler')).toBeNull();
    // El día y el estado son el alcance de la consulta de la AGENDA: en series no filtran nada, y
    // dejarlos puestos sería prometer un filtro que no existe.
    expect(el.shadowRoot.querySelector('[data-role="day"]')).toBeNull();
    expect(el.shadowRoot.querySelector('[data-role="status"]')).toBeNull();
  });

  it('vuelve a la agenda sin recargar la página', async () => {
    const el = await mount();
    el.view = 'series';
    await el.updateComplete;
    el.view = 'list';
    await el.updateComplete;
    expect(el.shadowRoot.querySelector('erp-appointments-series')).toBeNull();
    expect(el.shadowRoot.querySelector('ok-data-table')).toBeTruthy();
  });

  it('la opción está traducida, no es una clave suelta', async () => {
    const el = await mount();
    const labels = [...el.shadowRoot.querySelectorAll('ion-segment-button ion-label')].map((l) =>
      l.textContent?.trim(),
    );
    expect(labels).toContain(esLocale.ui.viewSeries);
  });
});
