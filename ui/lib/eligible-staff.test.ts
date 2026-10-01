// appointments#281 — who performs a service, read ONCE and shared by every professional picker.
//
// The agenda (appointments#272/#279) and the series view (appointments#281) narrow their
// professional pickers with the same read the server judges with
// (`staff.services.eligible_for_service`, staff#9). The rule lives here once, so the two screens
// cannot drift apart:
//
//   · one read per service, shared by every caller of the same reader;
//   · a failed read is NOT remembered as the answer: the next pick asks again;
//   · an empty answer means the hub has not narrowed the service — the whole team (`null`).
import { describe, expect, it } from 'vitest';
import { eligibleIds, eligibleReader, offeredStaff } from './eligible-staff';

describe('eligibleReader (appointments#281)', () => {
  it('reads each service once and hands the rows of the answer', async () => {
    const asked: string[] = [];
    const read = eligibleReader(async (serviceId) => {
      asked.push(serviceId);
      return { rows: [{ staff_id: 's1', custom_duration: 45 }], total: 1 };
    });
    expect(await read('sv1')).toEqual([{ staff_id: 's1', custom_duration: 45 }]);
    expect(await read('sv1')).toEqual([{ staff_id: 's1', custom_duration: 45 }]);
    await read('sv2');
    expect(asked, 'sv1 twice is one read').toEqual(['sv1', 'sv2']);
  });

  it('accepts a bare array as the answer', async () => {
    const read = eligibleReader(async () => [{ staff_id: 's2' }]);
    expect(await read('sv1')).toEqual([{ staff_id: 's2' }]);
  });

  it('a failed read is asked again on the next call, not remembered', async () => {
    let fail = true;
    let calls = 0;
    const read = eligibleReader(async () => {
      calls++;
      if (fail) throw new Error('forbidden');
      return [{ staff_id: 's1' }];
    });
    await expect(read('sv1')).rejects.toThrow('forbidden');
    fail = false;
    expect(await read('sv1')).toEqual([{ staff_id: 's1' }]);
    expect(calls).toBe(2);
  });
});

describe('eligibleIds (appointments#281)', () => {
  it('an empty answer is the whole team', () => {
    expect(eligibleIds([])).toBeNull();
  });

  it('the declared professionals, by id as text', () => {
    expect(eligibleIds([{ staff_id: 's1' }, { staff_id: 7 as unknown as string }])).toEqual(['s1', '7']);
  });
});

describe('offeredStaff (appointments#281)', () => {
  const team = [
    { id: 's1', full_name: 'Eva' },
    { id: 's2', full_name: 'Luis' },
  ];

  it('null keeps the whole team', () => {
    expect(offeredStaff(team, null)).toEqual(team);
  });

  it('a list keeps only who is in it, in the team order', () => {
    expect(offeredStaff(team, ['s2'])).toEqual([{ id: 's2', full_name: 'Luis' }]);
  });
});
