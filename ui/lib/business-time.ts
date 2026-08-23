/** The clock of `appointments` is the BUSINESS clock (appointments#12).
 *
 * One authority, and it is the core: `erplora.timezone` is the IANA name the runtime resolved with
 * `settings::timezone_of` (hub#731) and published through `/api/hub/context` (hub#1022) — the same
 * one it hands a WASM handler as `context.timezone` and binds into SQL as `:timezone`. This module
 * stores no timezone of its own: a second copy is a second answer waiting to rot.
 *
 * 🔴 The device NEVER rules. This file exists because the previous one (`day-bounds.ts`) had
 * already moved the agenda off UTC days but only as far as the DEVICE's zone, so a tablet set to
 * another country still painted the salon's day shifted. That is the bug Square carried for years
 * and closed by locking the zone to the business.
 *
 * The two natures, kept apart on purpose:
 *   - an **instant** (`start_datetime`, `end_datetime`) is a point in time — it travels as ISO
 *     UTC with `Z`;
 *   - a **wall time** (what the receptionist types, what a schedule declares) is a civil reading
 *     of a clock — `YYYY-MM-DDTHH:MM` plus the business zone, and it is NEVER stored converted.
 *
 * The conversion between the two lives here and only here, and it uses `Intl`: the browser ships
 * the whole IANA database, correct for every zone and every year, at zero bytes of bundle. (The
 * WASM handler pays for its own table, which is why it only converts what it cannot delegate.)
 */

/** A civil time the business clock never shows — the hour skipped by the spring-forward jump.
 *
 * It is a refusal, not a rounding. Every naive implementation quietly returns the hour before or
 * the hour after, and the salon finds an appointment at a time nobody booked. It carries a `code`
 * so the screen paints the translated sentence through the same `domainErrorText` path as a
 * refusal coming back from the handler. */
export class InvalidLocalTimeError extends Error {
  readonly code = 'appointments.invalid_local_time';
  constructor(readonly wall: string, readonly timezone: string) {
    super(`invalid_local_time: ${wall} does not exist in ${timezone}`);
    this.name = 'InvalidLocalTimeError';
  }
}

interface WallParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const DAY_MS = 86_400_000;

/** `YYYY-MM-DDTHH:MM[:SS]` — what `<input type="datetime-local">` produces and what a schedule
 *  declares. A trailing offset or `Z` is NOT accepted: that would be an instant, not a wall time,
 *  and silently taking one for the other is the whole class of bug this file closes. */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** One formatter per zone: `Intl.DateTimeFormat` is expensive to build and the agenda formats
 *  every row of every day. `h23` (not `hour12: false`) because the latter answers «24» for
 *  midnight in several engines, which would put the day boundary on the wrong date. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The civil reading of `instantMs` on the business clock. */
function partsAt(instantMs: number, timezone: string): WallParts {
  const got: Record<string, string> = {};
  for (const p of partsFormatter(timezone).formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') got[p.type] = p.value;
  }
  return {
    y: Number(got.year),
    mo: Number(got.month),
    d: Number(got.day),
    h: Number(got.hour),
    mi: Number(got.minute),
    s: Number(got.second),
  };
}

const asUtcMs = (p: WallParts): number => Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);

/** Minutes the business clock runs ahead of UTC at `instantMs`. Rounded to the minute: a few
 *  pre-1900 zones carry offsets with seconds, and no appointment lives there. */
function offsetMinutesAt(instantMs: number, timezone: string): number {
  return Math.round((asUtcMs(partsAt(instantMs, timezone)) - instantMs) / 60_000);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Every instant whose civil reading in `timezone` is exactly `wall`, earliest first.
 *
 * Sampling the offset a day either side covers both transitions: a normal wall time yields one
 * candidate, an ambiguous one (autumn) yields two, and one inside the spring gap yields none —
 * which is the whole point, because that is how the gap is DETECTED instead of papered over. */
function candidateInstants(wall: WallParts, timezone: string): number[] {
  const wallMs = asUtcMs(wall);
  const offsets = new Set([
    offsetMinutesAt(wallMs - DAY_MS, timezone),
    offsetMinutesAt(wallMs + DAY_MS, timezone),
  ]);
  const matches: number[] = [];
  for (const off of offsets) {
    const candidate = wallMs - off * 60_000;
    if (asUtcMs(partsAt(candidate, timezone)) === wallMs) matches.push(candidate);
  }
  return [...new Set(matches)].sort((a, b) => a - b);
}

function parseWall(wall: string): WallParts | null {
  const m = WALL_TIME.exec(wall.trim());
  if (!m) return null;
  const p = {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: m[6] ? Number(m[6]) : 0,
  };
  // `Date.UTC` happily normalises `2026-02-31` into March. A day the calendar does not have is
  // as invalid as an hour the clock does not have.
  const back = new Date(asUtcMs(p));
  const same =
    back.getUTCFullYear() === p.y &&
    back.getUTCMonth() + 1 === p.mo &&
    back.getUTCDate() === p.d &&
    back.getUTCHours() === p.h &&
    back.getUTCMinutes() === p.mi;
  return same ? p : null;
}

/** The IANA zone of the business, straight from the core. Never the device's.
 *
 * Degrades to `UTC` exactly like the runtime's own `timezone_name()` does: a clock that is wrong
 * by a known, uniform amount beats one that changes with whoever is holding the tablet. */
export function businessTimezone(): string {
  const tz = (globalThis as { erplora?: { timezone?: unknown } }).erplora?.timezone;
  return typeof tz === 'string' && tz.trim() ? tz.trim() : 'UTC';
}

/** Today on the business calendar (`YYYY-MM-DD`). At 00:30 in Madrid this is already the new day
 *  even though UTC is still on the previous one, and at 23:30 it is still the old one even though
 *  a device in Auckland ticked over hours ago. */
export function todayISO(timezone: string = businessTimezone(), now: Date = new Date()): string {
  const p = partsAt(now.getTime(), timezone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** The `[day_start, day_end)` window of the business day `day`, as instants.
 *
 * ⚠️ Never `day_start + 24 h`: on a transition day the business day lasts 23 or 25 hours, and the
 * fixed window either swallows an hour of the next day or drops the last hour of appointments off
 * the agenda — once a year, in silence.
 *
 * The boundary is «the first instant whose business date is `day`», which also answers the zones
 * whose transition happens AT midnight (Santiago, Havana): there, local 00:00 does not exist, and
 * the day starts at the jump instead of being refused — a day always has a beginning. */
export function dayBounds(
  day: string,
  timezone: string = businessTimezone(),
): { day_start: string; day_end: string } {
  const startOf = (isoDay: string): number => {
    const p = parseWall(`${isoDay}T00:00:00`);
    if (!p) throw new InvalidLocalTimeError(isoDay, timezone);
    const candidates = candidateInstants(p, timezone);
    if (candidates.length > 0) return candidates[0];
    // Midnight is inside a gap: the day begins where the clock jumped into it.
    return asUtcMs(p) - offsetMinutesAt(asUtcMs(p) - DAY_MS, timezone) * 60_000;
  };
  const start = startOf(day);
  const next = new Date(start + 36 * 3600_000); // safely inside the next business day
  const nextParts = partsAt(next.getTime(), timezone);
  return {
    day_start: new Date(start).toISOString(),
    day_end: new Date(
      startOf(`${nextParts.y}-${pad(nextParts.mo)}-${pad(nextParts.d)}`),
    ).toISOString(),
  };
}

/** `HH:MM` on the business clock. `ok-scheduler` positions blocks by reading this text literally,
 *  so a UTC or device reading drops the appointment hours away from where it belongs. */
export function wallClock(iso: string, timezone: string = businessTimezone()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '00:00';
  const p = partsAt(t, timezone);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** The appointment's time as the receptionist reads it, in the active language. */
export function formatWallTime(
  iso: string,
  timezone: string = businessTimezone(),
  locale = 'es',
): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleTimeString(locale || 'es', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/** `YYYY-MM-DDTHH:MM` for `<input type="datetime-local">`, on the business clock — so reopening a
 *  10:00 appointment shows 10:00 and not the hour the device happens to be in. */
export function toInputValue(iso: string, timezone: string = businessTimezone()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const p = partsAt(t, timezone);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Business wall time → the instant that gets stored, in ISO UTC with `Z`.
 *
 * The two DST answers, decided by the market (Google Calendar API, Calendly, Fresha, WooCommerce
 * Bookings — see appointments#12):
 *   - **non-existent** wall time (spring jump) → refused with `invalid_local_time`;
 *   - **ambiguous** wall time (autumn fall-back) → the FIRST pass, deterministically.
 *
 * @throws {InvalidLocalTimeError} when the wall time is unreadable or does not exist.
 */
export function wallToInstant(wall: string, timezone: string = businessTimezone()): string {
  const p = parseWall(wall);
  if (!p) throw new InvalidLocalTimeError(wall, timezone);
  const candidates = candidateInstants(p, timezone);
  if (candidates.length === 0) throw new InvalidLocalTimeError(wall, timezone);
  return new Date(candidates[0]).toISOString();
}

/** Business wall time → the ISO text this module STORES: the salon's wall clock plus the salon's
 *  own offset (`2026-08-22T09:30:00+02:00`).
 *
 * Two readings in one string, both true: the INSTANT (offset applied) and the SALON'S WALL CLOCK
 * (the first 19 characters). The availability engine needs the second one — it compares candidate
 * slots, which are naive salon wall times, against `substr(start_datetime, 1, 19)` as text
 * (appointments#76, `queries/availability_slots.sql`). Writing UTC there would cross out a window
 * displaced by the offset; writing the DEVICE's wall — which is what happened until now — crosses
 * out a window displaced by whatever zone the tablet is in.
 *
 * @throws {InvalidLocalTimeError} when the wall time is unreadable or does not exist.
 */
export function wallToBusinessIso(wall: string, timezone: string = businessTimezone()): string {
  const instant = Date.parse(wallToInstant(wall, timezone));
  const p = partsAt(instant, timezone);
  const off = offsetMinutesAt(instant, timezone);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return (
    `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Whether the device is on a different clock than the business right now.
 *
 * Compared by OFFSET, not by name: a Paris tablet in a Madrid salon reads the same clock, and
 * warning about it would be noise nobody keeps reading. */
export function deviceZoneDiffers(timezone: string = businessTimezone()): boolean {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (device === timezone) return false;
  const now = Date.now();
  return offsetMinutesAt(now, timezone) !== -new Date(now).getTimezoneOffset();
}
