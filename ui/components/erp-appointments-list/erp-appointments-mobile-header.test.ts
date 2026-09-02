// appointments#93 — the agenda's header on a phone.
//
// Measured on `qa-pm149` at 390×844: `.filters` was `flex-wrap: wrap` with three full-size
// controls — an `ion-input type=date` with a FLOATING label, the status `ion-select` and the
// Lista/Por-profesional `ion-segment`. At 390 px each one fell to its own line and the block
// measured ~300 px, so the first appointment (or the empty state) started below 55 % of the screen.
//
// The market answers this the same way in every appointment book (Fresha, Vagaro, Google Calendar
// mobile, Square Appointments): the DAY is the primary control and it lives on one compact line
// with a step back / step forward, while the secondary filters shrink instead of stacking. Same
// move that closed tables#64 and kitchen#60 — collapse the chrome to ONE row.
//
// happy-dom does no layout, so what is pinned here is the CONTRACT that makes the single row
// possible (the CSS rules and the DOM), plus the behaviour of the new day stepper. The pixels are
// measured in a real browser and reported in the PR.
process.env.TZ = 'Europe/Madrid';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const queries: { name: string; params: Record<string, unknown> }[] = [];

beforeEach(() => {
  queries.length = 0;
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params: Record<string, unknown>) => {
      queries.push({ name, params });
      switch (name) {
        case 'appointments.settings.get':
          return [{ calendar_start_hour: 8, calendar_end_hour: 20, default_duration: 30 }];
        default:
          return [];
      }
    },
    command: async () => ({}),
    on: () => () => {},
    locale: 'es',
    t: (_c: unknown, key: string) => key,
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
};

const mount = async (): Promise<Wc> => {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  el.day = '2026-08-17';
  await el.updateComplete;
  return el;
};

/** The component's own stylesheet, as text. */
const styles = (el: Wc): string =>
  [...(el.shadowRoot.adoptedStyleSheets ?? [])]
    .flatMap((sheet) => [...sheet.cssRules].map((r) => r.cssText))
    .join('\n') || [...el.shadowRoot.querySelectorAll('style')].map((s) => s.textContent).join('\n');

describe('appointments#93 · the scope bar is ONE row, not three', () => {
  it('the row does not wrap — wrapping IS the 300 px', async () => {
    const el = await mount();
    const css = styles(el);
    expect(css, '.filters must declare flex-wrap: nowrap').toMatch(
      /\.filters\s*\{[^}]*flex-wrap:\s*nowrap/,
    );
    expect(css, 'the old wrap rule must be gone').not.toMatch(
      /\.filters\s*\{[^}]*flex-wrap:\s*wrap/,
    );
  });

  it('the segment stops being a full-width row of its own', async () => {
    // Ionic gives the `ion-segment` host `width: 100%`: left alone it IS a line.
    const css = styles(await mount());
    expect(css).toMatch(/\.filters ion-segment\s*\{[^}]*width:\s*auto/);
  });

  it('carries a narrow-viewport block that shrinks the controls instead of stacking them', async () => {
    const css = styles(await mount());
    expect(css, 'a phone-width media query must exist').toMatch(/@media[^{]*max-width:\s*640px/);
  });

  it('the day input has no floating label (the label is a line of height on a phone)', async () => {
    const el = await mount();
    const day = el.shadowRoot.querySelector('.filters ion-input[data-role="day"]')!;
    expect(day, 'the day input must be tagged data-role="day"').toBeTruthy();
    expect(day.getAttribute('type')).toBe('date');
    expect(day.getAttribute('label-placement'), 'no floating label in the scope bar').toBeNull();
    expect(day.getAttribute('aria-label'), 'the accessible name stays').toBeTruthy();
  });

  it('the status filter keeps its accessible name without a floating label either', async () => {
    const el = await mount();
    const status = el.shadowRoot.querySelector('.filters ion-select[data-role="status"]')!;
    expect(status).toBeTruthy();
    expect(status.getAttribute('label-placement')).toBeNull();
    expect(status.getAttribute('aria-label')).toBeTruthy();
  });

  it('the view segment gives each button an icon and an accessible name', async () => {
    const el = await mount();
    const buttons = [...el.shadowRoot.querySelectorAll('.filters ion-segment ion-segment-button')];
    // Tres desde appointments#91 (lista · por profesional · periódicas): la barra sigue siendo UNA
    // fila, y lo que la mantiene así es que cada botón viaja con su icono en vez de con su texto.
    expect(buttons.length).toBe(3);
    for (const b of buttons) {
      expect(b.querySelector('ion-icon'), 'the label is hidden on a phone: the icon carries it').toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
    }
  });
});

describe('appointments#93 · the day is a STEP, the way every appointment book does it', () => {
  it('offers step back / step forward around the date', async () => {
    const el = await mount();
    expect(el.shadowRoot.querySelector('.filters [data-role="prev-day"]')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.filters [data-role="next-day"]')).toBeTruthy();
  });

  it('stepping forward loads the next day (and back, the previous one)', async () => {
    const el = await mount();
    const next = el.shadowRoot.querySelector('.filters [data-role="next-day"]') as HTMLElement;
    next.click();
    await el.updateComplete;
    expect(el.day).toBe('2026-08-18');

    const prev = el.shadowRoot.querySelector('.filters [data-role="prev-day"]') as HTMLElement;
    prev.click();
    prev.click();
    await el.updateComplete;
    expect(el.day).toBe('2026-08-16');
  });

  it('a step re-reads the agenda for the new day', async () => {
    const el = await mount();
    queries.length = 0;
    (el.shadowRoot.querySelector('.filters [data-role="next-day"]') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const list = queries.filter((q) => q.name === 'appointments.appointments.list').at(-1);
    expect(list, 'stepping the day must reload the list').toBeTruthy();
    // 2026-08-18 in Madrid starts at 22:00Z of the 17th.
    expect(String(list!.params.day_start)).toBe('2026-08-17T22:00:00.000Z');
  });

  it('a step crossing a MONTH boundary lands on the next month, not on the 32nd', async () => {
    const el = await mount();
    el.day = '2026-08-31';
    await el.updateComplete;
    (el.shadowRoot.querySelector('.filters [data-role="next-day"]') as HTMLElement).click();
    await el.updateComplete;
    expect(el.day).toBe('2026-09-01');
  });

  it('a step crossing the DST change stays one calendar day, not 23 or 25 hours', async () => {
    // Spain falls back on 2026-10-25: that day lasts 25 hours. A `+24h` stepper would land twice
    // on the same date or skip one.
    const el = await mount();
    el.day = '2026-10-25';
    await el.updateComplete;
    (el.shadowRoot.querySelector('.filters [data-role="next-day"]') as HTMLElement).click();
    await el.updateComplete;
    expect(el.day).toBe('2026-10-26');
  });
});
