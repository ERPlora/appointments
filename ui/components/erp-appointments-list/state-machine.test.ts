// A rejected transition must FAIL — not report success and emit the event again (appointments#18).
//
// Measured with the real runtime on 2026-07-16: confirming a `pending` appointment works; doing it
// a second time affects 0 rows, returns OK and **emits `appointments.appointment.confirmed` again**.
// Whoever listens to that event — the reminder, the agenda, the till — is told twice that something
// happened once.
//
// The SQL was never the problem, and that is what makes this cheap. Each transition already
// conditions on the previous state (`AND status = 'pending'`), and each history row is tied to the
// update that just happened (`AND a.updated_at = :now`), so a repeat leaves BOTH statements at zero
// rows. What was missing is the runtime being told that zero means no.
//
// `expect_rows` (hub#139) is exactly that: it sums the rows affected by the command's `sql` ops
// —never the outbox inserts— and, below the minimum, rolls the whole transaction back and returns a
// namespaced domain code instead of the generic failure. No row, no history, no event.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// appointments#12 — the clock of these fixtures is PINNED, it is not the machine's.
// Until now these tests built their instants with `new Date(y, m, d, h, mi)` and compared them
// against the component's output: green in Spain, red anywhere else, and green for the wrong
// reason (device == business by luck). The business zone is declared on the SDK stub below, the
// same way the shell publishes it in production, and the device is pinned to match it here so the
// assertions stay about WIRING. That the two can DISAGREE is proven in
// `erp-appointments-business-clock.test.ts`, with the device in Auckland.
process.env.TZ = 'Europe/Madrid';

const ROOT = join(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as {
  id: string;
  commands: Record<string, {
    sql?: string[];
    emit?: string[];
    expect_rows?: { op: string; n: number; error: string; message?: string };
    handler?: { type: string; file: string; function: string };
    reads?: { query: string; params?: Record<string, string>; required?: boolean }[];
  }>;
};

const TRANSITIONS = ['confirm', 'start', 'complete', 'cancel', 'no_show'] as const;

// `cancel` stopped being a declarative command in appointments#6 (PR #51): it runs the WASM handler
// `cancel_appointment`, because the cancellation policy — staff may always cancel, the customer is
// subject to `allow_customer_cancellation`/`cancellation_notice_hours` — is a decision taken from
// the pre-loaded `reads`, which no `expect_rows` can express. The gate did not disappear, it MOVED:
// the handler refuses with the same namespaced code (`appointments.cannot_cancel`) BEFORE returning
// any intention, so a refusal writes no row, no history and no event, exactly as the gate did.
// The other four transitions are still pure SQL and still carry the declarative gate.
const DECLARATIVE = ['confirm', 'start', 'complete', 'no_show'] as const;
const cmd = (t: string) => manifest.commands[`appointments.appointments.${t}`];

// The two statements of a transition — the row update and its history line — wherever they live.
// A declarative command lists both in its own `sql`; `cancel` reaches them through the ONE intention
// its handler emits (`appointments._cancel_row`), whose `sql` carries the UPDATE and then the history
// line — one command, so both see the same `:now` (appointments#196). Same two statements, one
// indirection apart, so the SQL-shape guarantees below still cover all five transitions.
const statementsOf = (t: string): (string | undefined)[] =>
  t === 'cancel' ? (manifest.commands['appointments._cancel_row']?.sql ?? []) : (cmd(t).sql ?? []);

const sqlOf = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

describe('a transition that does not apply is rejected, not celebrated', () => {
  it.each(DECLARATIVE)('%s declares the expect_rows gate', (t) => {
    const gate = cmd(t).expect_rows;
    expect(gate, `${t} emits ${cmd(t).emit?.join(', ')} even when it changes nothing`).toBeTruthy();
    expect(gate!.op).toBe('min');
    expect(gate!.n).toBeGreaterThanOrEqual(1);
  });

  it.each(DECLARATIVE)('%s uses a code in this module namespace, with a human fallback', (t) => {
    const gate = cmd(t).expect_rows!;
    expect(gate.error).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    expect(gate.error.split('.')[0], 'the installer rejects a foreign namespace').toBe(manifest.id);
    expect(gate.message, 'no shell translates these codes yet').toBeTruthy();
  });

  // `cancel` keeps the same promise through the handler. Asserting the wiring here — cheap, no
  // Postgres — keeps the pair honest: leaving `expect_rows` behind next to a handler would be a
  // gate that counts rows the handler never let happen, and dropping the `reads` would leave the
  // handler deciding the policy blind. The refusal codes themselves (`cannot_cancel`,
  // `customer_cancellation_disabled`, `cancellation_notice_required`) and their Spanish text are
  // covered by tests/cancel.contract.test.py, which also runs the two intentions against Postgres.
  it('cancel moved its gate into the handler, and kept no declarative leftovers', () => {
    const cancel = cmd('cancel');
    expect(cancel.handler?.function, 'cancel must run the WASM handler').toBe('cancel_appointment');
    expect(cancel.expect_rows, 'a handler command counts no rows: stale gate').toBeUndefined();
    expect(cancel.sql, 'the handler owns the statements, as intentions').toBeUndefined();

    const reads = Object.fromEntries((cancel.reads ?? []).map((r) => [r.query, r]));
    const row = reads['appointments.appointments.get'];
    expect(row, 'without the row the handler cannot guard the state').toBeTruthy();
    expect(row.params?.appointment_id).toBe('payload.appointment_id');
    expect(row.required, 'no row, no decision').toBe(true);
    expect(reads['appointments.settings.get']?.required, 'the policy is read, not sent').toBe(true);

    expect(cancel.emit).toContain('appointments.appointment.cancelled');
  });
});

// The gate counts the SUM of the rows affected by every `sql` op of the command. That only works
// because the history insert is tied to the update: if it inserted unconditionally, a repeated
// transition would still total 1 row and the gate would wave it through — a guard that looks right
// and protects nothing.
describe('the guard can only work because the history follows the update', () => {
  // The set of states a transition accepts is written as `= 'pending'`, `IN (…)` or `NOT IN (…)`
  // depending on the transition — `cancel` is defined by what it refuses, not by what it requires.
  // All three shapes are a guard; only the absence of one is a bug.
  it.each(TRANSITIONS)('%s conditions the change on the previous state', (t) => {
    const [transition] = statementsOf(t);
    expect(transition, `${t} has no row statement`).toBeTruthy();
    expect(
      sqlOf(transition!),
      `${transition} changes the row whatever state it was in`,
    ).toMatch(/\bAND\s+status\s*(?:=|\bIN\b|\bNOT\s+IN\b)/i);
  });

  it.each(TRANSITIONS)('%s writes history only for the update it just made', (t) => {
    const [, history] = statementsOf(t);
    expect(history, `${t} has no history statement`).toBeTruthy();
    expect(
      sqlOf(history!),
      `${history} inserts unconditionally: a repeated transition would still count one row and slip past the gate`,
    ).toMatch(/updated_at\s*=\s*:now/i);
  });
});
