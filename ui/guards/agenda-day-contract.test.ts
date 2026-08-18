// Static contract guard for appointments#21 — "the agenda cannot run a real day".
//
// The module is declarative data (manifest + SQL): asserting that contract IS asserting
// behavior. Same guard style as modules/verifactu/ui/guards/*.
//
// What a real salon day requires (Fresha/Vagaro as the reference standard):
//   1. AUDITED TRANSITIONS — every status transition command (confirm/start/complete/
//      cancel/no_show/reschedule) must leave an appointments_history row. Before this
//      guard only `created` was recorded (by the WASM create handler).
//   2. NO SILENT NO-OPS ON RESCHEDULE — rescheduling a terminal appointment must FAIL
//      (gate-table CHECK, the appointments#20 pattern), not return a silent OK.
//   3. LINKED BOOKING — `appointments.appointments.create` must require the customer,
//      service and staff LINKS (ids), not free text: the day view, availability engine
//      and appointment→sale handoff all key off those ids.
//   4. DAY VIEW DATA — `appointments.appointments.list` must expose staff_id (grouping
//      by professional) and the linked ids for downstream flows.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODULE_DIR = join(__dirname, '..', '..');
const manifest = JSON.parse(readFileSync(join(MODULE_DIR, 'module.json'), 'utf8'));

const read = (rel: string): string => readFileSync(join(MODULE_DIR, rel), 'utf8');

// action recorded in appointments_history per transition command (domain of 001_init.sql)
const TRANSITIONS: Record<string, string> = {
  'appointments.appointments.confirm': 'confirmed',
  'appointments.appointments.start': 'started',
  'appointments.appointments.complete': 'completed',
  'appointments.appointments.cancel': 'cancelled',
  'appointments.appointments.no_show': 'no_show',
  'appointments.appointments.reschedule': 'rescheduled',
};

// appointments#6: `cancel` is a Tier 2 command now (the cancellation policy lives in the WASM
// handler, which decides from its pre-loaded reads); its SQL chain is the ordered list of
// intentions the handler emits — internal commands of this module. The audit-trail contract is
// the same: the history statement runs after the row UPDATE, pinned to the run.
const HANDLER_CHAINS: Record<string, string[]> = {
  'appointments.appointments.cancel': ['appointments._cancel_row', 'appointments._history_cancel'],
};

/** The SQL files a transition command runs, in order — declared `sql[]` or the handler's chain. */
const sqlChain = (command: string): string[] => {
  const def = manifest.commands[command];
  if (Array.isArray(def.sql)) return def.sql;
  const chain = HANDLER_CHAINS[command];
  expect(chain, `${command} has a handler but no known intention chain`).toBeTruthy();
  return chain!.flatMap((op) => {
    expect(manifest.commands[op], `intention ${op} is not a declared command`).toBeTruthy();
    return manifest.commands[op].sql as string[];
  });
};

describe('status transitions leave an audit trail (appointments_history)', () => {
  for (const [command, action] of Object.entries(TRANSITIONS)) {
    it(`${command} records action '${action}'`, () => {
      const sqlFiles = sqlChain(command);
      const historyFile = sqlFiles.find((f) => f.includes('_history_'));
      expect(historyFile, `${command} declares no history statement in its sql[]`).toBeTruthy();

      const sql = read(historyFile!);
      expect(sql, 'history statement must insert into appointments_history').toMatch(
        /INSERT INTO appointments_history/i,
      );
      expect(sql, `history statement must record the '${action}' action literal`).toContain(
        `'${action}'`,
      );
      // The INSERT..SELECT must be pinned to THIS command run (verifactu#27 pattern used by
      // _appointment_overlap_assert.sql): a no-op transition must NOT add a history row.
      expect(sql, 'history insert must be pinned to the run via updated_at = :now').toMatch(
        /updated_at\s*=\s*:now/,
      );
    });

    it(`${command} runs the history statement AFTER the UPDATE`, () => {
      const sqlFiles = sqlChain(command);
      const historyIdx = sqlFiles.findIndex((f) => f.includes('_history_'));
      const updateIdx = sqlFiles.findIndex((f) => !f.includes('_history_') && !f.includes('assert'));
      expect(historyIdx, 'history statement missing').toBeGreaterThan(updateIdx);
    });
  }
});

describe('reschedule on a terminal appointment fails instead of silently succeeding', () => {
  it('reschedule declares a state gate BEFORE the UPDATE', () => {
    const sqlFiles: string[] = manifest.commands['appointments.appointments.reschedule'].sql;
    const gateIdx = sqlFiles.findIndex((f) => f.includes('_reschedule_state_assert'));
    const updateIdx = sqlFiles.findIndex((f) => f.endsWith('appointment_reschedule.sql'));
    expect(gateIdx, 'reschedule has no state assert (terminal reschedule = silent OK)').toBeGreaterThanOrEqual(0);
    expect(gateIdx, 'the state assert must run before the UPDATE').toBeLessThan(updateIdx);
  });

  it('the state gate uses the appointments__gate CHECK and the reschedulable status domain', () => {
    const sql = read('commands/_reschedule_state_assert.sql');
    expect(sql).toMatch(/INSERT INTO appointments__gate/i);
    expect(sql, 'only pending|confirmed appointments can be rescheduled').toMatch(
      /status\s+IN\s*\(\s*'pending'\s*,\s*'confirmed'\s*\)/i,
    );
  });
});

describe('booking is LINKED, not free text (create requires customer/service/staff ids)', () => {
  const schema = JSON.parse(read('schemas/appointment_create.json'));

  for (const field of ['customer_id', 'service_id', 'staff_id']) {
    it(`create requires ${field}`, () => {
      expect(schema.required, `${field} must be required by the create payload schema`).toContain(field);
      expect(schema.properties[field].type, `${field} must be a non-null id`).toBe('string');
      expect(schema.properties[field].minLength, `${field} must reject the empty string`).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('the day list feeds the per-professional view and downstream flows', () => {
  const sql = read('queries/appointments_list.sql');

  for (const col of ['staff_id', 'customer_id', 'service_id', 'service_price']) {
    it(`appointments.appointments.list exposes ${col}`, () => {
      expect(sql, `${col} missing from the list SELECT`).toMatch(new RegExp(`\\b${col}\\b`));
    });
  }
});

describe('the staff module is a declared dependency (the agenda books against it)', () => {
  it('depends_on includes staff', () => {
    expect(manifest.depends_on).toContain('staff');
  });
});
