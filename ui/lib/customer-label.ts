// pm#637 — what the agenda paints where the customer's name was (APPOINTMENTS-F24).
//
// The listener of `customer.anonymized` blanks the name Citas copied from the sheet but keeps
// `customer_id` (it now names the pseudonymised sheet). A linked row with no name is therefore an
// erased customer and reads with the translated label the caller hands in; a row with neither a
// sheet nor a name is not an erasure and gets `fallback` (the neutral dash the other columns use,
// unless the caller has a better word for the place).

export interface CustomerRef {
  customer_id?: unknown;
  customer_name?: unknown;
}

export function customerLabel(row: CustomerRef, erasedLabel: string, fallback = '—'): string {
  const name = typeof row.customer_name === 'string' ? row.customer_name.trim() : '';
  if (name) return name;
  const id = typeof row.customer_id === 'string' ? row.customer_id.trim() : '';
  return id ? erasedLabel : fallback;
}
