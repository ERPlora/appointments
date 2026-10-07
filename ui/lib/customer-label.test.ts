// pm#637 — what the agenda paints where the customer's name was.
//
// When Clientes erases a customer's personal data (GDPR), Citas blanks the name it copied into her
// appointments and series (APPOINTMENTS-F24) but keeps the link to the pseudonymised sheet. An
// empty cell would read as a broken row, so the screen says «Deleted customer» — the same words
// Clientes leaves on the erased sheet. A row with no sheet at all and no name is not an erasure:
// it gets the neutral dash, never a claim that somebody was deleted.
import { describe, expect, it } from 'vitest';
import { customerLabel } from './customer-label';

const ERASED = 'Deleted customer';

describe('customerLabel', () => {
  it('a written name is shown as it is', () => {
    expect(customerLabel({ customer_id: 'c1', customer_name: 'Ana López' }, ERASED)).toBe('Ana López');
  });

  it('a linked sheet with a blank name is an erased customer', () => {
    expect(customerLabel({ customer_id: 'c1', customer_name: '' }, ERASED)).toBe(ERASED);
    expect(customerLabel({ customer_id: 'c1', customer_name: null }, ERASED)).toBe(ERASED);
    expect(customerLabel({ customer_id: 'c1' }, ERASED)).toBe(ERASED);
  });

  it('no sheet and no name is a dash, not an erasure', () => {
    expect(customerLabel({ customer_id: '', customer_name: '' }, ERASED)).toBe('—');
    expect(customerLabel({ customer_id: null, customer_name: null }, ERASED)).toBe('—');
    expect(customerLabel({}, ERASED)).toBe('—');
  });

  it('a link made of blanks is no link', () => {
    expect(customerLabel({ customer_id: '  ', customer_name: '' }, ERASED)).toBe('—');
  });

  it('a name made of blanks is no name', () => {
    expect(customerLabel({ customer_id: 'c1', customer_name: '   ' }, ERASED)).toBe(ERASED);
  });
});
