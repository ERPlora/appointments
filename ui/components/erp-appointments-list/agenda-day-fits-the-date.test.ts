// appointments#243 — the agenda day field at the top of the list must show the WHOLE date.
// On a desktop (≥641 px) it read «09/29/202»: the field was a fixed 9rem (144 px) and the stepper
// rule `.filters .daynav ion-button { width:44px }` also caught the calendar button INSIDE the
// field (4 px more than the 40 px it gets on a phone). 144 − 10 (padding) − 44 = 90 px for a date
// that measures 93 px with Chromium's Linux/Android font, so the last digit went under the icon.
//
// Layout cannot be measured under happy-dom, so this pins the width BUDGET the field is built on,
// resolved against the component's real stylesheet and matched against the real elements:
//   · the calendar button has ONE width at every viewport (no stepper rule leaks into it);
//   · the field is sized in `ch` (the font's own digit width) for a 10-character date, plus its
//     padding-start and that calendar button — so a wider font widens the field instead of
//     clipping the year.
// The rendered check (es/en × ios/md × 390/834/1440 on hub:stable, Chromium Linux) is in the PR.
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async () => [],
    command: async () => ({}),
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Wc = HTMLElement & { shadowRoot: ShadowRoot; updateComplete: Promise<unknown> };

async function mount(): Promise<Wc> {
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list') as Wc;
  document.body.appendChild(el);
  await el.updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}

type Decl = { selector: string; media: string; value: string };

/** Every `prop` declaration of the component's stylesheet whose selector matches `node`. */
function declarationsFor(node: Element, prop: string): Decl[] {
  const Ctor = customElements.get('erp-appointments-list') as unknown as { styles: { cssText: string } | { cssText: string }[] };
  const cssText = ([] as { cssText: string }[]).concat(Ctor.styles).map((s) => s.cssText).join('\n');
  // Comments out first: they mention selectors and widths in prose.
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Decl[] = [];
  const walk = (block: string, media: string) => {
    const re = /([^{}]+)\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      const head = m[1].trim();
      if (head.startsWith('@media')) {
        walk(m[2], head);
        continue;
      }
      if (head.startsWith('@')) continue;
      const selectors = head.split(',').map((s) => s.trim().replace(/^:host\s*/, ''));
      const hit = selectors.find((s) => {
        try {
          return s !== '' && node.matches(s);
        } catch {
          return false;
        }
      });
      if (!hit) continue;
      for (const d of m[2].split(';')) {
        const [k, ...v] = d.split(':');
        if (k?.trim() === prop) out.push({ selector: hit, media, value: v.join(':').trim() });
      }
    }
  };
  walk(css, '');
  return out;
}

const px = (v: string): number => {
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim());
  expect(m, `expected a px length, got «${v}»`).toBeTruthy();
  return Number(m![1]);
};

describe('appointments#243 · the agenda day field fits the whole date', () => {
  it('the calendar button inside the field has one width at every viewport (the stepper size does not leak into it)', async () => {
    const el = await mount();
    const cal = el.shadowRoot.querySelector('[data-testid="appointments-list-day-calendar"]');
    expect(cal, 'the calendar button must be rendered').toBeTruthy();
    const widths = declarationsFor(cal!, 'width');
    expect(widths.length, 'the calendar button needs an explicit width for the field budget').toBeGreaterThan(0);
    const values = new Set(widths.map((w) => px(w.value)));
    expect([...values], JSON.stringify(widths)).toHaveLength(1);
  });

  it('the stepper buttons keep their 44 px touch width (the fix does not shrink them)', async () => {
    const el = await mount();
    for (const id of ['appointments-list-prev-day', 'appointments-list-next-day']) {
      const b = el.shadowRoot.querySelector(`[data-testid="${id}"]`)!;
      const base = declarationsFor(b, 'width').filter((w) => w.media === '');
      expect(base.map((w) => w.value), id).toContain('44px');
    }
  });

  it('the field is sized for a 10-character date in the font’s own digits, plus its padding and the calendar button', async () => {
    const el = await mount();
    const field = el.shadowRoot.querySelector('[data-testid="appointments-list-day"]')!;
    const cal = el.shadowRoot.querySelector('[data-testid="appointments-list-day-calendar"]')!;
    const calWidth = px(declarationsFor(cal, 'width')[0].value);
    const padStart = declarationsFor(field, '--padding-start').map((d) => px(d.value));
    expect(padStart, 'the field padding-start must be pinned').toHaveLength(1);

    const widths = declarationsFor(field, 'width');
    expect(widths.length).toBeGreaterThan(0);
    for (const w of widths) {
      const calc = /^calc\((.*)\)$/.exec(w.value);
      expect(calc, `width must be a calc() in ch + px, got «${w.value}» (${w.selector} ${w.media})`).toBeTruthy();
      const terms = calc![1].split('+').map((t) => t.trim());
      const ch = terms.filter((t) => t.endsWith('ch')).reduce((s, t) => s + Number(t.slice(0, -2)), 0);
      const fixed = terms.filter((t) => t.endsWith('px')).reduce((s, t) => s + px(t), 0);
      expect(terms.every((t) => t.endsWith('ch') || t.endsWith('px')), w.value).toBe(true);
      expect(ch, 'room for «dd/mm/yyyy»: 10 characters').toBeGreaterThanOrEqual(10);
      expect(fixed, 'padding-start + calendar button').toBeGreaterThanOrEqual(padStart[0] + calWidth);
    }
    // A min-width that is not the same budget would cap nothing but could hide a regression.
    for (const w of declarationsFor(field, 'min-width')) expect(w.value).toBe(widths[0].value);
  });
});
