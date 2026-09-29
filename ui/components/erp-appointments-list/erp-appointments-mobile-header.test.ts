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

describe('appointments#93 · the scope bar stays compact on a phone', () => {
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
    // appointments#205: a text field painted in the hub language — the native date input takes the browser's format.
    expect(day.getAttribute('type')).toBe('text');
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

// appointments#206 — the same header, measured again on hub:stable at 390×844 (ios): the day
// stepper was allowed to shrink below its content (`min-width:0` inside a `nowrap` row), so the
// date box got 104 px while Chromium needs 138 px to print «26/09/2026» plus its calendar icon.
// The icon covered the year and the «next day» arrow landed 20 px on top of «Todos». In `md`
// the segment is a grid whose columns are `minmax(auto, 360px)`: with `width:auto` every button
// grew to 360 px (1080 px in total) and the row collapsed on itself at every width.
//
// Box measurement needs a browser, which the module suite does not have (happy-dom does no
// layout): the boxes are measured on the bench and reported in the PR. What is pinned here are
// the three rules without which the measured overlap comes back.
describe('appointments#206 · on a phone the header wraps instead of overlapping', () => {
  it('the row may wrap: one line that does not fit overlaps, it does not shrink legibly', async () => {
    const css = styles(await mount());
    expect(css).toMatch(/\.filters\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).not.toMatch(/\.filters\s*\{[^}]*flex-wrap:\s*nowrap/);
  });

  it('the day stepper never shrinks below its content', async () => {
    const css = styles(await mount());
    // happy-dom serializes the `flex` shorthand as its longhands: accept either spelling.
    const noShrink = (sel: string): RegExp =>
      new RegExp(`${sel}\\s*\\{[^}]*(flex:\\s*0 0 auto|flex-shrink:\\s*0\\b)`);
    expect(css).toMatch(noShrink('\\.filters \\.daynav'));
    expect(css).toMatch(noShrink('\\.filters \\.daynav ion-input'));
  });

  // appointments#243: this used to pin a fixed ≥ 8.625rem (138 px measured with the macOS font),
  // and that is exactly what clipped the year on desktop with the Linux/Android font. How wide the
  // box is now lives in agenda-day-fits-the-date.test.ts (10ch + padding + calendar button); what
  // stays here is the #206 half: the box cannot be squeezed below that width.
  it('the date box cannot be squeezed below the width it needs for a full date', async () => {
    const css = styles(await mount());
    const rule = css.match(/\.filters \.daynav ion-input\s*\{([^}]*)\}/)?.[1] ?? '';
    const value = (prop: string): string => rule.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*([^;]+)`))?.[1].trim() ?? '';
    expect(value('width'), 'the date box width').toMatch(/\dch\b/);
    expect(value('min-width'), 'and it cannot be squeezed below it').toBe(value('width'));
  });

  it('the view segment sizes its buttons to their content, not to Ionic md\'s 360 px columns', async () => {
    const css = styles(await mount());
    expect(css).toMatch(/\.filters ion-segment\s*\{[^}]*grid-auto-columns:\s*1fr/);
  });
});
