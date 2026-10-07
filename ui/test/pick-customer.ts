// Test helper (appointments#306): choose a customer the way the receptionist does — open the
// customer picker of a form, wait for the server's first page and tap her result. It replaces
// assigning the host's state or firing `ionChange` on the `ion-select` the picker replaced, so every
// form test goes through the same field a person uses.
import { expect } from 'vitest';

type Updating = HTMLElement & { updateComplete: Promise<unknown> };

async function settle(el: Updating) {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
  }
}

/**
 * `host` is the screen (`erp-appointments-list` / `erp-appointments-series`), `testid` the picker's
 * hook in it (`appointments-list-customer` / `appointments-series-create-customer`) and `id` the
 * customer to choose among those the fake `customers.list` answers with no search.
 */
export async function pickCustomer(host: Updating, testid: string, id: string): Promise<void> {
  await host.updateComplete;
  const picker = host.shadowRoot?.querySelector(`[data-testid="${testid}"]`) as Updating | null;
  expect(picker, `${testid} must be rendered`).toBeTruthy();
  await settle(picker!);
  const input = picker!.shadowRoot!.querySelector('[data-testid="appointments-customer-picker-input"]');
  expect(input, `${testid}: the search field`).toBeTruthy();
  input!.dispatchEvent(new CustomEvent('ionFocus', { bubbles: true, composed: true }));
  await settle(picker!);
  const option = picker!.shadowRoot!.querySelector(`[data-testid="appointments-customer-picker-option-${id}"]`) as HTMLElement | null;
  expect(option, `${testid}: customer ${id} must be offered`).toBeTruthy();
  option!.click();
  await settle(host);
}
