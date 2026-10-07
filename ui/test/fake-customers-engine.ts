// Test helper (appointments#306): a fake `customers.list` that behaves like the hub's list engine —
// `search` matches name, phone and email case- and accent-insensitively, rows come sorted by name
// and `limit` is honoured — over a book of 802 customers. Two of them sort after the 500th by
// name, so any picker that falls back to «load a cut list and choose from it» cannot reach them.

export interface FakeCustomer {
  id: string;
  name: string;
  phone: string;
  email: string;
}

export const ZOE: FakeCustomer = { id: 'c-zoe', name: 'Zoe Zamora', phone: '699000123', email: 'zoe@example.com' };
export const JOSE: FakeCustomer = { id: 'c-jose', name: 'José Núñez', phone: '611222333', email: '' };

/** 800 «Cliente NNN» (they sort first) + Zoe and José, who a 500-row cut never reaches. */
export const BIG_BOOK: FakeCustomer[] = [
  ...Array.from({ length: 800 }, (_, i) => {
    const n = String(i).padStart(3, '0');
    return { id: `c${n}`, name: `Cliente ${n}`, phone: `600000${n}`, email: `cliente${n}@example.com` };
  }),
  ZOE,
  JOSE,
];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** What `customers.list` answers through the list engine for these params. */
export function customersListEngine(params: Record<string, unknown> = {}, book: FakeCustomer[] = BIG_BOOK) {
  const search = typeof params.search === 'string' ? fold(params.search) : '';
  const limit = Math.min(Number(params.limit ?? 50) || 50, 500);
  const hits = book
    .filter((r) => !search || [r.name, r.phone, r.email].some((v) => fold(v).includes(search)))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows: hits.slice(0, limit), total: hits.length };
}
