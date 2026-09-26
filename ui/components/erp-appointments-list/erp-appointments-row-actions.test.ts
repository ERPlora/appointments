// appointments#137 — a row action is only offered when the appointment is in a state the command
// behind it accepts.
//
// Since appointments#18 every transition refuses a wrong state with a namespaced code
// (`appointments.cannot_confirm`, …), so pressing «Confirmar» on an appointment that is already
// confirmed no longer fails silently — it fails with an error. That is still a button inviting the
// front desk to do something that cannot be done, while «Cobrar» and «Reprogramar» next to it are
// already greyed out when they do not apply. Since appointments#136 self-booked appointments are
// born confirmed, so «Confirmar» is wrong on half the agenda of a salon with WhatsApp enabled.
//
// The source of truth is the COMMAND, not this test: the accepted states are read from the status
// guard in each transition's SQL (`AND status = 'x'` / `AND status IN (…)` / `NOT IN (…)`), so if a
// guard changes and the toolbar does not, this goes red.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

process.env.TZ = 'Europe/Madrid';

const ROOT = join(__dirname, '../../..');

// Every status the column can hold (migrations/postgres/001_init.sql).
const STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;

/** States the transition's SQL guard lets through, parsed from its WHERE clause. */
function acceptedBySql(file: string): string[] {
  const sql = readFileSync(join(ROOT, 'commands', file), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const list = (s: string) => [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const notIn = sql.match(/AND\s+status\s+NOT\s+IN\s*\(([^)]*)\)/i);
  if (notIn) {
    const excluded = list(notIn[1]);
    return STATUSES.filter((s) => !excluded.includes(s));
  }
  const inList = sql.match(/AND\s+status\s+IN\s*\(([^)]*)\)/i);
  if (inList) return list(inList[1]);
  const eq = sql.match(/AND\s+status\s*=\s*'([a-z_]+)'/i);
  if (eq) return [eq[1]];
  throw new Error(`no status guard found in commands/${file}`);
}

const GUARDED = {
  confirm: 'appointment_confirm.sql',
  start: 'appointment_start.sql',
  complete: 'appointment_complete.sql',
  no_show: 'appointment_no_show.sql',
  // `cancel` runs the WASM handler, which refuses cancelled|completed; the SQL keeps the same
  // guard as the last line of defence, so it is the one read here.
  cancel: 'appointment_cancel.sql',
} as const;

function installSdk() {
  (globalThis as Record<string, unknown>).erplora = {
    timezone: 'Europe/Madrid',
    query: async () => [],
    queryAll: async () => [],
    queryOptional: async () => undefined,
    command: async () => ({}),
    locale: 'es',
    currency: 'EUR',
    formatMoney: (c: number) => `${((c || 0) / 100).toFixed(2)} €`,
    t: (_c: unknown, key: string) => key,
    notify: () => {},
  };
}

interface RowAction {
  id: string;
  disabled?: (row: Record<string, unknown>) => boolean;
}

async function rowActions(): Promise<RowAction[]> {
  installSdk();
  await import('./erp-appointments-list');
  const el = document.createElement('erp-appointments-list');
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return (el as unknown as { rowActions: RowAction[] }).rowActions;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the guard parser reads the real SQL (control)', () => {
  it('confirm is accepted only from pending', () => {
    expect(acceptedBySql(GUARDED.confirm)).toEqual(['pending']);
  });
  it('cancel is refused only on cancelled and completed', () => {
    expect(acceptedBySql(GUARDED.cancel).sort()).toEqual(
      ['confirmed', 'in_progress', 'no_show', 'pending'],
    );
  });
});

describe('row actions follow the state the command accepts (appointments#137)', () => {
  for (const [id, file] of Object.entries(GUARDED)) {
    for (const status of STATUSES) {
      const accepted = acceptedBySql(file).includes(status);
      it(`${id} is ${accepted ? 'enabled' : 'disabled'} on a ${status} appointment`, async () => {
        const action = (await rowActions()).find((a) => a.id === id);
        expect(action, `row action ${id} must exist`).toBeDefined();
        const disabled = !!action?.disabled?.({ id: 'ap-1', status });
        expect(disabled).toBe(!accepted);
      });
    }
  }
});
