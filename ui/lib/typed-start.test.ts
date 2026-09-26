// appointments#204 — a start PASTED (or typed in one go) as text lands in the date + time fields.
//
// Native `date`/`time` inputs ignore pasted text: the `paste` event reaches the page with the
// clipboard text and the field stays empty. `parseTypedStart` reads that text the way the person
// wrote it — in the day/month order of the active language — and returns the two halves the
// fields take (`YYYY-MM-DD`, `HH:MM`). Anything that is not a real date or time returns null, so
// the field is left as it was instead of being filled with a guess.
import { describe, expect, it } from 'vitest';
import { parseTypedStart } from './typed-start';

describe('parseTypedStart (appointments#204)', () => {
  it('reads the Spanish day/month order with a time', () => {
    expect(parseTypedStart('26/09/2026 10:00', 'es')).toEqual({ date: '2026-09-26', time: '10:00' });
    expect(parseTypedStart('26/09/2026, 9:05', 'es')).toEqual({ date: '2026-09-26', time: '09:05' });
    expect(parseTypedStart(' 6-9-2026 ', 'es')).toEqual({ date: '2026-09-06', time: '' });
    expect(parseTypedStart('26.09.2026 18:30', 'es')).toEqual({ date: '2026-09-26', time: '18:30' });
  });

  it('reads the US month/day order when the language says so', () => {
    expect(parseTypedStart('09/26/2026 10:00 PM', 'en-US')).toEqual({ date: '2026-09-26', time: '22:00' });
    expect(parseTypedStart('09/26/2026 12:15 am', 'en-US')).toEqual({ date: '2026-09-26', time: '00:15' });
  });

  it('reads ISO whatever the language', () => {
    expect(parseTypedStart('2026-09-26T10:00', 'es')).toEqual({ date: '2026-09-26', time: '10:00' });
    expect(parseTypedStart('2026-09-26 10:00:00', 'en-US')).toEqual({ date: '2026-09-26', time: '10:00' });
  });

  it('reads a time on its own', () => {
    expect(parseTypedStart('10:30', 'es')).toEqual({ date: '', time: '10:30' });
    expect(parseTypedStart('7:05 pm', 'en-US')).toEqual({ date: '', time: '19:05' });
  });

  it('refuses what is not a real date or time', () => {
    expect(parseTypedStart('31/02/2026 10:00', 'es')).toBeNull();
    expect(parseTypedStart('26/13/2026', 'es')).toBeNull();
    expect(parseTypedStart('26/09/2026 25:00', 'es')).toBeNull();
    expect(parseTypedStart('13:00 pm', 'en-US')).toBeNull();
    expect(parseTypedStart('mañana a las diez', 'es')).toBeNull();
    expect(parseTypedStart('', 'es')).toBeNull();
  });
});
