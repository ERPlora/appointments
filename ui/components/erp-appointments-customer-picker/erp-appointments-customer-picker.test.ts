// appointments#306 — the customer field of a booking must reach EVERY customer, not the first 500.
//
// The create panel and the new-series panel loaded `customers.list` ONCE with `limit: 500` sorted
// by name and painted it in an `ion-select`: a salon that imported 800 customers could not book the
// ones after the 500th, and typing did nothing because nothing searched. A failed load was
// swallowed into an empty list, which reads as «you have no customers».
//
// The picker asks the SERVER on every keystroke (the list engine's `search`, which matches name,
// phone and email, case- and accent-insensitively) and paints what the server answers — no
// client-side filter on top, or «jose» would hide «José» that the server just found. The fixture
// below is a fake list engine with 802 rows that honours `search`, `sort` and `limit`, so a picker
// that falls back to a cut list cannot pass.
import { beforeEach, describe, expect, it } from 'vitest';

import { customersListEngine as listEngine, type FakeCustomer as Row } from '../../test/fake-customers-engine';

type Answer = (params: Record<string, unknown>) => Promise<unknown>;
let answer: Answer;
const asked: Record<string, unknown>[] = [];

beforeEach(() => {
  asked.length = 0;
  answer = async (params) => listEngine(params);
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async (name: string, params: Record<string, unknown> = {}) => {
      if (name !== 'customers.list') return [];
      asked.push(params);
      return answer(params);
    },
    command: async () => ({}),
    on: () => () => {},
    notify: () => {},
    locale: 'es',
    t: (_catalog: unknown, key: string) => key,
  };
});

type Picker = HTMLElement & {
  shadowRoot: ShadowRoot;
  customer: Row | null;
  label: string;
  updateComplete: Promise<unknown>;
};

const settle = async (el: Picker) => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
};

async function mount(): Promise<Picker> {
  await import('./erp-appointments-customer-picker');
  const el = document.createElement('erp-appointments-customer-picker') as Picker;
  el.label = 'Customer';
  document.body.appendChild(el);
  await settle(el);
  return el;
}

const hook = (el: Picker, testid: string) =>
  el.shadowRoot.querySelector(`[data-testid="${testid}"]`) as (HTMLElement & { value?: string }) | null;

const optionIds = (el: Picker) =>
  [...el.shadowRoot.querySelectorAll('[data-testid^="appointments-customer-picker-option-"]')].map((o) =>
    o.getAttribute('data-testid')!.replace('appointments-customer-picker-option-', ''),
  );

/** What `ion-input` emits while the receptionist types. */
async function type(el: Picker, value: string) {
  const input = hook(el, 'appointments-customer-picker-input');
  expect(input, 'the search field must be rendered').toBeTruthy();
  input!.value = value;
  input!.dispatchEvent(new CustomEvent('ionInput', { detail: { value }, bubbles: true, composed: true }));
  await settle(el);
}

describe('appointments#306 — the customer picker searches the server, not a cut list', () => {
  it('finds a customer that sorts after the first 500 by typing her name', async () => {
    const el = await mount();
    await type(el, 'zamora');
    expect(optionIds(el)).toEqual(['c-zoe']);
    const last = asked.at(-1)!;
    expect(last.search, 'the typed text goes to the server').toBe('zamora');
  });

  it('finds her by phone number', async () => {
    const el = await mount();
    await type(el, '699000');
    expect(optionIds(el)).toEqual(['c-zoe']);
    expect(hook(el, 'appointments-customer-picker-option-c-zoe')?.textContent).toContain('699000123');
  });

  it('paints what the server found, without filtering it again in the browser (accents)', async () => {
    const el = await mount();
    await type(el, 'jose nunez');
    expect(optionIds(el), 'the server folds accents; a browser filter would hide «José Núñez»').toEqual(['c-jose']);
  });

  it('never asks for the whole book: every read is one short page', async () => {
    const el = await mount();
    hook(el, 'appointments-customer-picker-input')!.dispatchEvent(new CustomEvent('ionFocus', { bubbles: true, composed: true }));
    await settle(el);
    await type(el, 'cliente');
    expect(asked.length).toBeGreaterThan(0);
    for (const p of asked) expect(Number(p.limit)).toBeLessThanOrEqual(50);
    expect(hook(el, 'appointments-customer-picker-more'), 'a full page says «keep typing»').toBeTruthy();
  });

  it('picking a result hands the whole customer to the form and closes the list', async () => {
    const el = await mount();
    const picked: unknown[] = [];
    el.addEventListener('customer-change', (e) => picked.push((e as CustomEvent).detail.customer));
    await type(el, 'zamora');
    hook(el, 'appointments-customer-picker-option-c-zoe')!.click();
    await settle(el);
    expect(picked).toEqual([{ id: 'c-zoe', name: 'Zoe Zamora', phone: '699000123', email: 'zoe@example.com' }]);
    expect(optionIds(el), 'the list closes once she is chosen').toEqual([]);
  });

  it('Enter picks the first result instead of submitting the booking half-filled', async () => {
    const el = await mount();
    const picked: unknown[] = [];
    el.addEventListener('customer-change', (e) => picked.push((e as CustomEvent).detail.customer));
    await type(el, 'zamora');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
    hook(el, 'appointments-customer-picker-input')!.dispatchEvent(enter);
    await settle(el);
    expect(enter.defaultPrevented, 'Enter must not reach the form').toBe(true);
    expect(picked).toEqual([{ id: 'c-zoe', name: 'Zoe Zamora', phone: '699000123', email: 'zoe@example.com' }]);
  });

  it('shows the chosen customer in the field', async () => {
    const el = await mount();
    el.customer = { id: 'c-zoe', name: 'Zoe Zamora', phone: '699000123', email: '' };
    await settle(el);
    expect(hook(el, 'appointments-customer-picker-input')?.value).toBe('Zoe Zamora');
  });

  it('a slow answer to an older keystroke never overwrites the newer one', async () => {
    const el = await mount();
    let releaseOld: () => void = () => {};
    answer = (params) =>
      params.search === 'z'
        ? new Promise((resolve) => {
            releaseOld = () => resolve(listEngine(params));
          })
        : Promise.resolve(listEngine(params));
    await type(el, 'z');
    await type(el, 'zamora');
    expect(optionIds(el)).toEqual(['c-zoe']);
    releaseOld();
    await settle(el);
    expect(optionIds(el), 'the stale «z» answer is dropped').toEqual(['c-zoe']);
  });

  it('a failed search is SAID, with a retry — never an empty list', async () => {
    const el = await mount();
    answer = async () => {
      throw Object.assign(new Error('boom'), { code: 'internal' });
    };
    await type(el, 'zamora');
    expect(hook(el, 'appointments-customer-picker-error'), 'the failure is visible').toBeTruthy();
    expect(hook(el, 'appointments-customer-picker-empty'), 'a failure is not «no customers»').toBeNull();
    answer = async (params) => listEngine(params);
    hook(el, 'appointments-customer-picker-retry')!.click();
    await settle(el);
    expect(hook(el, 'appointments-customer-picker-error')).toBeNull();
    expect(optionIds(el)).toEqual(['c-zoe']);
    expect(asked.at(-1)!.search, 'the retry repeats the same search').toBe('zamora');
  });

  it('a failure with nothing to list paints no empty results box under the error', async () => {
    const el = await mount();
    await type(el, 'nobody-like-this');
    answer = async () => {
      throw new Error('boom');
    };
    await type(el, 'nobody-like-this-either');
    expect(hook(el, 'appointments-customer-picker-error')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.results'), 'an empty bordered box reads as a broken field').toBeNull();
  });

  it('nobody matching is an empty state, not an error', async () => {
    const el = await mount();
    await type(el, 'nobody-like-this');
    expect(optionIds(el)).toEqual([]);
    expect(hook(el, 'appointments-customer-picker-empty')).toBeTruthy();
    expect(hook(el, 'appointments-customer-picker-error')).toBeNull();
  });

  // Review of appointments#320: the closing paths and the in-flight state had no test.
  it('Escape closes the list and stops there: the booking panel around it stays open', async () => {
    const el = await mount();
    const reachedPanel: string[] = [];
    document.body.addEventListener('keydown', (e) => reachedPanel.push((e as KeyboardEvent).key));
    await type(el, 'zamora');
    expect(optionIds(el)).toEqual(['c-zoe']);
    hook(el, 'appointments-customer-picker-input')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true, cancelable: true }),
    );
    await settle(el);
    expect(optionIds(el), 'Escape closes the list').toEqual([]);
    expect(reachedPanel, 'an Escape that reached the panel would close it and lose the draft').toEqual([]);
  });

  it('a tap outside the field closes the list', async () => {
    const el = await mount();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    await type(el, 'zamora');
    expect(optionIds(el)).toEqual(['c-zoe']);
    outside.click();
    await settle(el);
    expect(optionIds(el)).toEqual([]);
  });

  it('while the first answer is on its way the list says it is searching, not that nobody matches', async () => {
    let release: () => void = () => {};
    answer = (params) =>
      new Promise((resolve) => {
        release = () => resolve(listEngine(params));
      });
    const el = await mount();
    await type(el, 'zamora');
    expect(hook(el, 'appointments-customer-picker-searching')).toBeTruthy();
    expect(hook(el, 'appointments-customer-picker-empty')).toBeNull();
    release();
    await settle(el);
    expect(hook(el, 'appointments-customer-picker-searching')).toBeNull();
    expect(optionIds(el)).toEqual(['c-zoe']);
  });

  it('a failure that brings no message is still said, in the module\'s own words', async () => {
    const el = await mount();
    answer = async () => {
      throw new Error('');
    };
    await type(el, 'zamora');
    expect(hook(el, 'appointments-customer-picker-error')?.textContent?.trim()).toBe('ui.errLoadCustomers');
  });
});
