// appointments#12 — the clock of the module is the BUSINESS clock, never the device's.
//
// What this replaces (`ui/lib/day-bounds.ts`, PR #85): the agenda had already been moved off UTC
// days, but only as far as the DEVICE's zone (`new Date(y, m - 1, d)`, `d.getHours()`). Its own
// doc-comment claimed «en la zona del NEGOCIO» and the code did not do it.
//
// 🔴 Why the device is the wrong authority, with the case that broke it in the field: Square let
// the zone follow the device for years — a tablet set to another zone moved appointments that were
// already booked, and they closed it by LOCKING the zone to the business
// (https://community.squareup.com/t5/Appointments-Bookings/Why-is-the-time-zone-incorrect-with-Square-Appointments/m-p/345366).
// The salon's day is the salon's wall clock, whatever the iPad in the reception thinks.
//
// The zone comes from the CORE — `erplora.timezone`, resolved by `settings::timezone_of`
// (hub#731/hub#1022) — so there is exactly one authority for it. No second copy in this module.
//
// Every test here runs with the DEVICE in `Pacific/Auckland` (UTC+12) while the business is in
// `Europe/Madrid`: any answer that came from the device clock would be off by 10-11 hours and
// could not pass by accident.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  businessTimezone,
  todayISO,
  dayBounds,
  wallClock,
  formatWallTime,
  toInputValue,
  wallToInstant,
  deviceZoneDiffers,
  wallToBusinessIso,
  toInstantMs,
  InvalidLocalTimeError,
} from './business-time';

const MADRID = 'Europe/Madrid';
const DEVICE = 'Pacific/Auckland';
const previousTZ = process.env.TZ;

beforeAll(() => {
  // A real device in another zone, not a mock: Node re-reads `TZ` on every `Date` call.
  process.env.TZ = DEVICE;
});
afterAll(() => {
  process.env.TZ = previousTZ;
  delete (globalThis as { erplora?: unknown }).erplora;
});

const withSdkTimezone = <T>(tz: string | undefined, fn: () => T): T => {
  const g = globalThis as { erplora?: { timezone?: string } };
  const previous = g.erplora;
  g.erplora = tz === undefined ? {} : { timezone: tz };
  try {
    return fn();
  } finally {
    g.erplora = previous;
  }
};

describe('the device really is in another zone (guard for the guard)', () => {
  it('the device clock disagrees with Madrid, so a device answer cannot pass by accident', () => {
    expect(new Date('2026-08-22T07:30:00Z').getHours()).toBe(19); // Auckland, not 09:30 Madrid
  });
});

describe('businessTimezone — one authority: the core', () => {
  it('reads `erplora.timezone` (the IANA the runtime resolved)', () => {
    expect(withSdkTimezone(MADRID, () => businessTimezone())).toBe(MADRID);
  });

  it('degrades to UTC when the shell published nothing — NEVER to the device zone', () => {
    // Same fallback the runtime itself uses (`timezone_name()` → `UTC`). Falling back to the
    // device would be the Square bug, silently.
    expect(withSdkTimezone(undefined, () => businessTimezone())).toBe('UTC');
  });

  it('degrades to UTC when the SDK is not initialised at all', () => {
    const g = globalThis as { erplora?: unknown };
    const previous = g.erplora;
    delete g.erplora;
    try {
      expect(businessTimezone()).toBe('UTC');
    } finally {
      g.erplora = previous;
    }
  });
});

describe('todayISO — «today» is the business day', () => {
  it('at 23:30 in Madrid it is still that day, though the device already ticked over', () => {
    // 2026-08-22T21:30Z = 23:30 in Madrid (CEST) but 09:30 of the 23rd in Auckland.
    const now = new Date('2026-08-22T21:30:00Z');
    expect(todayISO(MADRID, now)).toBe('2026-08-22');
  });

  it('at 00:30 in Madrid it is already the new day, though UTC is still on the previous one', () => {
    // The case pm#93 found: 00:30 in Madrid is 22:30 of the day BEFORE in UTC.
    const now = new Date('2026-08-21T22:30:00Z');
    expect(todayISO(MADRID, now)).toBe('2026-08-22');
  });
});

describe('dayBounds — the window is the business day, in instants', () => {
  it('summer (CEST, +2): midnight to midnight in Madrid', () => {
    expect(dayBounds('2026-08-22', MADRID)).toEqual({
      day_start: '2026-08-21T22:00:00.000Z',
      day_end: '2026-08-22T22:00:00.000Z',
    });
  });

  it('winter (CET, +1)', () => {
    expect(dayBounds('2026-01-15', MADRID)).toEqual({
      day_start: '2026-01-14T23:00:00.000Z',
      day_end: '2026-01-15T23:00:00.000Z',
    });
  });

  it('the spring transition day lasts 23 h, not 24', () => {
    // 2026-03-29 in Madrid: 02:00 → 03:00. A `+24 h` window would swallow an hour of the NEXT day.
    const { day_start, day_end } = dayBounds('2026-03-29', MADRID);
    expect(day_start).toBe('2026-03-28T23:00:00.000Z');
    expect(day_end).toBe('2026-03-29T22:00:00.000Z');
    expect(new Date(day_end).getTime() - new Date(day_start).getTime()).toBe(23 * 3600_000);
  });

  it('the autumn transition day lasts 25 h, not 24', () => {
    // 2026-10-25 in Madrid: 03:00 → 02:00. A `+24 h` window would leave the last hour of
    // appointments OUT of the agenda — once a year, in silence.
    const { day_start, day_end } = dayBounds('2026-10-25', MADRID);
    expect(day_start).toBe('2026-10-24T22:00:00.000Z');
    expect(day_end).toBe('2026-10-25T23:00:00.000Z');
    expect(new Date(day_end).getTime() - new Date(day_start).getTime()).toBe(25 * 3600_000);
  });

  it('works for a zone that is not ours (the module is not Spain-only)', () => {
    expect(dayBounds('2026-07-15', 'America/New_York').day_start).toBe('2026-07-15T04:00:00.000Z');
    expect(dayBounds('2026-07-15', 'America/Phoenix').day_start).toBe('2026-07-15T07:00:00.000Z');
  });
});

describe('reading an instant back as the business wall clock', () => {
  it('wallClock paints the salon hour, not the device hour', () => {
    // 07:30Z = 09:30 in Madrid. The device (Auckland) would say 19:30 and `ok-scheduler` would
    // drop the block ten hours down the timeline.
    expect(wallClock('2026-08-22T07:30:00Z', MADRID)).toBe('09:30');
  });

  it('wallClock returns 00:00 for garbage instead of throwing at the grid', () => {
    expect(wallClock('not-a-date', MADRID)).toBe('00:00');
  });

  it('formatWallTime formats in the business zone with the active locale', () => {
    expect(formatWallTime('2026-08-22T07:30:00Z', MADRID, 'es')).toBe('09:30');
  });

  it('formatWallTime gives back what it got when the instant is unreadable', () => {
    expect(formatWallTime('nope', MADRID, 'es')).toBe('nope');
  });

  it('toInputValue pre-fills `datetime-local` with the business wall time', () => {
    expect(toInputValue('2026-08-22T07:30:00Z', MADRID)).toBe('2026-08-22T09:30');
  });

  it('midnight in the business zone is 00:00, never 24:00', () => {
    // `Intl` with `hour12: false` answers «24» for midnight in some engines; that would make the
    // day boundary land on the wrong date.
    expect(wallClock('2026-08-21T22:00:00.000Z', MADRID)).toBe('00:00');
    expect(toInputValue('2026-08-21T22:00:00.000Z', MADRID)).toBe('2026-08-22T00:00');
  });
});

describe('wallToInstant — what the receptionist types is BUSINESS wall time', () => {
  it('summer wall time resolves with the summer offset', () => {
    expect(wallToInstant('2026-08-22T09:30', MADRID)).toBe('2026-08-22T07:30:00.000Z');
  });

  it('winter wall time resolves with the winter offset', () => {
    expect(wallToInstant('2026-01-15T09:30', MADRID)).toBe('2026-01-15T08:30:00.000Z');
  });

  it('accepts seconds and ignores them being absent', () => {
    expect(wallToInstant('2026-08-22T09:30:45', MADRID)).toBe('2026-08-22T07:30:45.000Z');
  });

  it('🔴 a wall time that DOES NOT EXIST is refused, not silently moved', () => {
    // 2026-03-29 02:30 in Madrid never happens: the clock jumps 02:00 → 03:00. Every other
    // engine would quietly hand back 01:30Z or 03:30Z and the salon would find an appointment
    // it never booked.
    expect(() => wallToInstant('2026-03-29T02:30', MADRID)).toThrow(InvalidLocalTimeError);
    try {
      wallToInstant('2026-03-29T02:30', MADRID);
    } catch (e) {
      expect((e as InvalidLocalTimeError).code).toBe('appointments.invalid_local_time');
    }
  });

  it('the hours around the spring gap still resolve', () => {
    expect(wallToInstant('2026-03-29T01:59', MADRID)).toBe('2026-03-29T00:59:00.000Z');
    expect(wallToInstant('2026-03-29T03:00', MADRID)).toBe('2026-03-29T01:00:00.000Z');
  });

  it('🔴 an AMBIGUOUS wall time resolves to the FIRST pass, and does so deterministically', () => {
    // 2026-10-25 02:30 in Madrid happens twice: at 00:30Z (CEST, +2) and again at 01:30Z (CET,
    // +1). Picking the first pass is what the business decision fixed; what matters as much is
    // that the answer never depends on the device or on which way the search happened to walk.
    expect(wallToInstant('2026-10-25T02:30', MADRID)).toBe('2026-10-25T00:30:00.000Z');
    expect(wallToInstant('2026-10-25T02:30', MADRID)).toBe(wallToInstant('2026-10-25T02:30', MADRID));
  });

  it('refuses a wall time it cannot parse instead of inventing one', () => {
    expect(() => wallToInstant('tomorrow at nine', MADRID)).toThrow(InvalidLocalTimeError);
  });

  it('round-trips against wallClock for every hour of both transition days', () => {
    // The strongest statement available: except inside the spring gap, writing a wall time and
    // reading it back must give the same wall time.
    for (const day of ['2026-03-29', '2026-10-25']) {
      for (let h = 0; h < 24; h++) {
        const wall = `${day}T${String(h).padStart(2, '0')}:15`;
        let instant: string;
        try {
          instant = wallToInstant(wall, MADRID);
        } catch (e) {
          expect(e).toBeInstanceOf(InvalidLocalTimeError);
          expect(wall).toBe('2026-03-29T02:15'); // the ONLY hour of the year that does not exist
          continue;
        }
        expect(wallClock(instant, MADRID), `round-trip of ${wall}`).toBe(wall.slice(11));
      }
    }
  });
});

describe('wallToBusinessIso — the stored text says the SALON wall clock', () => {
  // appointments#76 fixed the availability engine by comparing WALL against WALL in SQL
  // (`queries/availability_slots.sql`, `substr(start_datetime, 1, 19)`): the candidate slots are
  // naive salon wall times, so the row has to carry the salon's wall time too. What #76 could not
  // do — the business zone was not readable yet — is make that wall the SALON's instead of the
  // DEVICE's. On an Auckland tablet the row said `T19:30+12:00`: a perfectly valid instant whose
  // TEXT crossed out a window ten hours away from the one the salon booked.
  it('writes the business wall time with the business offset (summer, +02:00)', () => {
    expect(wallToBusinessIso('2026-08-22T09:30', MADRID)).toBe('2026-08-22T09:30:00+02:00');
  });

  it('writes the winter offset for a winter date (+01:00)', () => {
    expect(wallToBusinessIso('2026-01-15T09:30', MADRID)).toBe('2026-01-15T09:30:00+01:00');
  });

  it('keeps the seconds it was given', () => {
    expect(wallToBusinessIso('2026-08-22T09:30:45', MADRID)).toBe('2026-08-22T09:30:45+02:00');
  });

  it('a negative offset is written with its sign, not silently flipped', () => {
    expect(wallToBusinessIso('2026-07-15T09:30', 'America/New_York')).toBe(
      '2026-07-15T09:30:00-04:00',
    );
  });

  it('names the same instant as wallToInstant — text and instant never disagree', () => {
    const wall = '2026-10-25T02:30';
    expect(new Date(wallToBusinessIso(wall, MADRID)).toISOString()).toBe(
      wallToInstant(wall, MADRID),
    );
  });

  it('refuses a wall time the salon clock never shows', () => {
    expect(() => wallToBusinessIso('2026-03-29T02:30', MADRID)).toThrow(InvalidLocalTimeError);
  });
});

// appointments#86 — the overlap notice compares a slot against the rows it may collide with, and
// those rows come in TWO shapes: the ones this module writes (wall + offset, appointments#76) and
// the naive leftovers of `materialize` from before PR #87. `Date.parse` reads a naive text in the
// DEVICE's zone, which with the device in Auckland is the salon's clock plus twelve hours — an
// overlap warning that fires on the wrong rows and stays quiet on the right ones.
describe('toInstantMs — one instant for both storage shapes, never the device clock', () => {
  it('reads an instant that carries its offset', () => {
    expect(toInstantMs('2026-08-17T11:00:00+02:00', MADRID)).toBe(
      Date.parse('2026-08-17T09:00:00Z'),
    );
  });

  it('reads an instant written in UTC with Z', () => {
    expect(toInstantMs('2026-08-17T09:00:00Z', MADRID)).toBe(Date.parse('2026-08-17T09:00:00Z'));
  });

  it('reads a NAIVE row on the business clock, not on the device one', () => {
    // 11:00 in Madrid is 09:00Z. The device (Auckland, UTC+12) would answer 23:00Z the day before.
    expect(toInstantMs('2026-08-17T11:00:00', MADRID)).toBe(Date.parse('2026-08-17T09:00:00Z'));
  });

  it('answers null for text no clock can read, instead of a plausible number', () => {
    expect(toInstantMs('', MADRID)).toBeNull();
    expect(toInstantMs('not a date', MADRID)).toBeNull();
    // A wall time the salon clock never shows is not an instant either.
    expect(toInstantMs('2026-03-29T02:30:00', MADRID)).toBeNull();
  });
});

describe('deviceZoneDiffers — the receptionist is told, not surprised', () => {
  it('is true when the device is not on the business zone', () => {
    expect(deviceZoneDiffers(MADRID)).toBe(true);
  });

  it('is false when they agree', () => {
    expect(deviceZoneDiffers(DEVICE)).toBe(false);
  });
});
