// appointments#204 — a start PASTED (or typed in one go) as text lands in the date + time fields.
//
// Native `date`/`time` inputs ignore pasted text: the `paste` event reaches the page with the
// clipboard text and the field stays empty. `parseTypedStart` reads that text the way the person
// wrote it — in the day/month order of the active language — and returns the two halves the
// fields take (`YYYY-MM-DD`, `HH:MM`). Anything that is not a real date or time returns null, so
// the field is left as it was instead of being filled with a guess.
import { describe, expect, it } from 'vitest';
import { formatTypedDate, formatTypedTime, parseTypedStart } from './typed-start';

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

  // appointments#239 — the time fields open the phone's numeric keypad (`inputmode="numeric"`),
  // and on an iPhone that keypad has no «:». A time must be typeable with digits alone, or with the
  // dot some people write («14.30»), the way schedules#50 reads an opening time.
  it('reads a time typed on a keypad without a colon', () => {
    expect(parseTypedStart('1430', 'es')).toEqual({ date: '', time: '14:30' });
    expect(parseTypedStart('930', 'es')).toEqual({ date: '', time: '09:30' });
    expect(parseTypedStart('0930', 'es')).toEqual({ date: '', time: '09:30' });
    expect(parseTypedStart('9', 'es')).toEqual({ date: '', time: '09:00' });
    expect(parseTypedStart('14', 'es')).toEqual({ date: '', time: '14:00' });
    expect(parseTypedStart('14.30', 'es')).toEqual({ date: '', time: '14:30' });
    expect(parseTypedStart('9.05', 'es')).toEqual({ date: '', time: '09:05' });
    expect(parseTypedStart('230 pm', 'en-US')).toEqual({ date: '', time: '14:30' });
    expect(parseTypedStart('26/09/2026 1430', 'es')).toEqual({ date: '2026-09-26', time: '14:30' });
  });

  it('a keypad time that is not a real time, or is still half-typed, is not a time', () => {
    expect(parseTypedStart('2400', 'es')).toBeNull();
    expect(parseTypedStart('1460', 'es')).toBeNull();
    expect(parseTypedStart('24', 'es')).toBeNull();
    expect(parseTypedStart('12345', 'es')).toBeNull();
    expect(parseTypedStart('14.', 'es')).toBeNull();
    expect(parseTypedStart('14:', 'es')).toBeNull();
    expect(parseTypedStart('14.3', 'es')).toBeNull();
    expect(parseTypedStart('1300 pm', 'en-US')).toBeNull();
  });

  // appointments#240 — the date fields open the same numeric keypad, with no «/» either. A date
  // typed as eight digits is read in the hub's day/month order, the way schedules#54 reads a day.
  it('reads a date typed on a keypad without a slash, in the hub order', () => {
    expect(parseTypedStart('03042026', 'es')).toEqual({ date: '2026-04-03', time: '' });
    expect(parseTypedStart('03042026', 'en-US')).toEqual({ date: '2026-03-04', time: '' });
    expect(parseTypedStart('18082026 1430', 'es')).toEqual({ date: '2026-08-18', time: '14:30' });
    expect(parseTypedStart('08182026 2:30 pm', 'en-US')).toEqual({ date: '2026-08-18', time: '14:30' });
  });

  it('a keypad date that is half-typed or not a real day is not a date', () => {
    expect(parseTypedStart('0304202', 'es')).toBeNull();
    // Seven digits are always half-typed, even when they could spell a real day (2/11/2202).
    expect(parseTypedStart('2112202', 'es')).toBeNull();
    expect(parseTypedStart('31022026', 'es')).toBeNull();
    expect(parseTypedStart('18132026', 'es')).toBeNull();
    expect(parseTypedStart('18082026', 'en-US')).toBeNull();
    expect(parseTypedStart('180820261', 'es')).toBeNull();
    expect(parseTypedStart('18082026 2500', 'es')).toBeNull();
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

// appointments#205 — the text a date FIELD shows, in the hub's language. The native `date` input
// paints the BROWSER's format (a Spanish hub in an English browser read «09/26/2026»), so the
// module paints the date itself: the same day/month order `parseTypedStart` reads, so what the
// field shows can be typed back unchanged.
describe('formatTypedDate (appointments#205)', () => {
  it('writes the day first in Spanish and the month first in English', () => {
    expect(formatTypedDate('2026-09-26', 'es')).toBe('26/09/2026');
    expect(formatTypedDate('2026-09-06', 'es')).toBe('06/09/2026');
    expect(formatTypedDate('2026-09-26', 'en')).toBe('09/26/2026');
  });

  it('is not moved by the device timezone: a calendar date has none', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu';
    try {
      expect(formatTypedDate('2026-01-01', 'es')).toBe('01/01/2026');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('round-trips through parseTypedStart in both languages', () => {
    for (const locale of ['es', 'en']) {
      expect(parseTypedStart(formatTypedDate('2026-02-03', locale), locale)).toEqual({ date: '2026-02-03', time: '' });
    }
  });

  it('shows nothing for what is not a calendar date', () => {
    expect(formatTypedDate('', 'es')).toBe('');
    expect(formatTypedDate('2026-02-31', 'es')).toBe('');
    expect(formatTypedDate('26/09/2026', 'es')).toBe('');
  });
});

// appointments#214 — the TIME field follows the hub language too: Chromium paints a native `time`
// input with the browser/OS locale, so a Spanish hub on a US-English laptop read «02:30 PM».
describe('formatTypedTime (appointments#214)', () => {
  it('paints the 24-hour clock in Spanish', () => {
    expect(formatTypedTime('14:30', 'es')).toBe('14:30');
    expect(formatTypedTime('09:05', 'es')).toBe('09:05');
    expect(formatTypedTime('00:00', 'es')).toBe('00:00');
  });

  it('paints the clock the hub language uses in English', () => {
    expect(formatTypedTime('14:30', 'en').replace(/\s/g, ' ')).toBe('02:30 PM');
    expect(formatTypedTime('00:15', 'en').replace(/\s/g, ' ')).toBe('12:15 AM');
  });

  it('is not moved by the device timezone: a wall-clock time has none', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu';
    try {
      expect(formatTypedTime('23:45', 'es')).toBe('23:45');
    } finally {
      process.env.TZ = tz;
    }
  });

  it('round-trips through parseTypedStart in both languages', () => {
    for (const locale of ['es', 'en']) {
      for (const time of ['00:00', '09:05', '12:00', '14:30', '23:59']) {
        expect(parseTypedStart(formatTypedTime(time, locale), locale)).toEqual({ date: '', time });
      }
    }
  });

  it('shows nothing for what is not a time', () => {
    expect(formatTypedTime('', 'es')).toBe('');
    expect(formatTypedTime('24:00', 'es')).toBe('');
    expect(formatTypedTime('10:60', 'es')).toBe('');
    expect(formatTypedTime('10', 'es')).toBe('');
  });
});
