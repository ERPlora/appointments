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

const ROOT = join(__dirname, '../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'module.json'), 'utf8')) as {
  id: string;
  commands: Record<string, {
    sql?: string[];
    emit?: string[];
    expect_rows?: { op: string; n: number; error: string; message?: string };
  }>;
};

const TRANSITIONS = ['confirm', 'start', 'complete', 'cancel', 'no_show'] as const;
const cmd = (t: string) => manifest.commands[`appointments.appointments.${t}`];

const sqlOf = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

describe('a transition that does not apply is rejected, not celebrated', () => {
  it.each(TRANSITIONS)('%s declares the expect_rows gate', (t) => {
    const gate = cmd(t).expect_rows;
    expect(gate, `${t} emits ${cmd(t).emit?.join(', ')} even when it changes nothing`).toBeTruthy();
    expect(gate!.op).toBe('min');
    expect(gate!.n).toBeGreaterThanOrEqual(1);
  });

  it.each(TRANSITIONS)('%s uses a code in this module namespace, with a human fallback', (t) => {
    const gate = cmd(t).expect_rows!;
    expect(gate.error).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    expect(gate.error.split('.')[0], 'the installer rejects a foreign namespace').toBe(manifest.id);
    expect(gate.message, 'no shell translates these codes yet').toBeTruthy();
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
    const [transition] = cmd(t).sql!;
    expect(
      sqlOf(transition),
      `${transition} changes the row whatever state it was in`,
    ).toMatch(/\bAND\s+status\s*(?:=|\bIN\b|\bNOT\s+IN\b)/i);
  });

  it.each(TRANSITIONS)('%s writes history only for the update it just made', (t) => {
    const [, history] = cmd(t).sql!;
    expect(history, `${t} has no history statement`).toBeTruthy();
    expect(
      sqlOf(history),
      `${history} inserts unconditionally: a repeated transition would still count one row and slip past the gate`,
    ).toMatch(/updated_at\s*=\s*:now/i);
  });
});
