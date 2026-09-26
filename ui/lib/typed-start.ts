// appointments#204 — native `date`/`time` inputs trap continuous typing (the year segment of a
// `date` field takes up to six digits, so a space typed right after the year never reaches the
// hour) and silently ignore pasted text. This reads a start typed or pasted as one string, in the
// day/month order of the active language, and returns the `date`/`time` halves the two fields take.

/** Result of parsing a typed/pasted start: the `YYYY-MM-DD` and/or `HH:MM` halves that were found.
 *  Either half may be `''` when only the other one was present in the text. */
export interface TypedStart {
  date: string;
  time: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1];
}

/** Builds the `YYYY-MM-DD` string, or `null` if the day/month/year is not a real calendar date. */
function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** Parses a `H:MM`/`HH:MM` time, optional `:SS` ignored, optional `am`/`pm` (with or without
 *  dots, case-insensitive). Returns the zero-padded `HH:MM`, or `null` if it is not a valid time. */
function parseTime(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(a\.?m\.?|p\.?m\.?))?$/i);
  if (!match) return null;
  const [, hourText, minuteText, meridiem] = match;
  const minute = Number(minuteText);
  if (minute < 0 || minute > 59) return null;
  let hour = Number(hourText);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const isPm = meridiem.toLowerCase().startsWith('p');
    hour = isPm ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Whether the active language writes the day before the month (`es` → `DD/MM/YYYY`) or after it
 *  (`en-US` → `MM/DD/YYYY`), read from how `Intl` itself orders a formatted date. Defaults to
 *  day-first when the locale is unknown or `Intl` throws. */
function isDayFirstLocale(locale: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(2026, 8, 26));
    const monthIndex = parts.findIndex((p) => p.type === 'month');
    const dayIndex = parts.findIndex((p) => p.type === 'day');
    if (monthIndex === -1 || dayIndex === -1) return true;
    return dayIndex < monthIndex;
  } catch {
    return true;
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(.+))?$/;
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[\s,T]+(.+))?$/;

/** Reads a start typed or pasted as free text — ISO, a numeric date in the active language's
 *  day/month order, or a bare time — and splits it into the `date`/`time` halves a native
 *  `date` + `time` field pair takes. Returns `null` when the text is not a real date and/or time. */
export function parseTypedStart(text: string, locale: string): TypedStart | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const iso = trimmed.match(ISO_DATE);
  if (iso) {
    const [, yearText, monthText, dayText, rest] = iso;
    const date = toIsoDate(Number(yearText), Number(monthText), Number(dayText));
    if (!date) return null;
    if (rest === undefined) return { date, time: '' };
    const time = parseTime(rest);
    return time === null ? null : { date, time };
  }

  const numeric = trimmed.match(NUMERIC_DATE);
  if (numeric) {
    const [, first, second, yearText, rest] = numeric;
    const dayFirst = isDayFirstLocale(locale);
    const day = Number(dayFirst ? first : second);
    const month = Number(dayFirst ? second : first);
    const date = toIsoDate(Number(yearText), month, day);
    if (!date) return null;
    if (rest === undefined) return { date, time: '' };
    const time = parseTime(rest);
    return time === null ? null : { date, time };
  }

  const time = parseTime(trimmed);
  return time === null ? null : { date: '', time };
}

// appointments#205 — the text a date FIELD shows, in the hub's language. Chromium paints a native
// `date` input in the BROWSER/OS locale (a Spanish hub in an English browser read «09/26/2026»,
// with the placeholder marker «mm/dd/yyyy» on top), and there is no attribute that changes it. The
// field is a text input now, painted by the module itself in the same day/month order
// `parseTypedStart` reads, so what it shows can be typed back unchanged.

/** Formats a `YYYY-MM-DD` calendar date as a numeric date in the given locale's own day/month
 *  order (`es` → `26/09/2026`, `en` → `09/26/2026`), with 2-digit day/month and a 4-digit year.
 *  Built from `Date.UTC` and formatted with `timeZone: 'UTC'`, so the device's own timezone never
 *  moves it (a calendar date has none to move). Returns `''` for anything that is not a real
 *  calendar date — reuses the same validation `parseTypedStart` relies on. */
export function formatTypedDate(iso: string, locale: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!toIsoDate(year, month, day)) return '';
  try {
    const parts = new Intl.DateTimeFormat(locale || undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).formatToParts(new Date(Date.UTC(year, month - 1, day)));
    const ordered = parts.filter((p) => p.type === 'day' || p.type === 'month' || p.type === 'year').map((p) => p.value);
    if (ordered.length === 3) return ordered.join('/');
  } catch {
    // Intl threw on the given locale: fall back to the day-first default below.
  }
  return `${pad2(day)}/${pad2(month)}/${String(year).padStart(4, '0')}`;
}

// appointments#214 — the same for the TIME field: Chromium paints a native `time` input with the
// browser/OS clock (a Spanish hub on a US-English laptop read «02:30 PM»), whatever the hub
// language. The field is a text input painted in the hub's own clock, in a form `parseTypedStart`
// reads back unchanged.

/** Formats an `HH:MM` wall-clock time in the given locale's own clock (`es` → `14:30`, `en` →
 *  `02:30 PM`), 2-digit hour and minute. Built from `Date.UTC` and formatted with `timeZone: 'UTC'`
 *  so the device's timezone never moves it (a wall-clock time has none to move). Returns `''` for
 *  anything that is not a valid 24-hour `HH:MM`. */
export function formatTypedTime(time: string, locale: string): string {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)));
  } catch {
    // Intl threw on the given locale: fall back to the 24-hour default below.
  }
  return `${pad2(hour)}:${pad2(minute)}`;
}
