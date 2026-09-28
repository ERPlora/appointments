//! Handler WASM (Tier 2) del módulo `appointments` — alta de citas, lotes y
//! materialización de recurrencias. Portado de old_modules/m_appointments
//! (AppointmentService.create/bulk_create/bulk_delete + RecurringAppointment.
//! get_next_occurrence). Lógica pura, sin BD: recibe `{payload, context}` y
//! devuelve **intenciones** (commands SQL del propio módulo) que el host valida
//! y ejecuta en una transacción (WASM-TODO piezas 1, 2, 3 y 6).
//!
//! Host contract (crates/runtime/src/commands.rs): the guest receives `payload` +
//! `context{hub_id, current_user_id, now, new_ids, reads}`. Since ADR-0069 the runtime
//! PRE-LOADS the reads the manifest declares per command into `context.reads["<query>"]`,
//! and those are authoritative:
//!
//! - `appointments.settings.get` — the settings singleton (`allow_overlapping`,
//!   `default_duration`) — appointments#45.
//! - `appointments.appointments.conflicting` — live appointments that may overlap
//!   (appointments#110).
//! - `customers.get` · `services.services.get` · `staff.members.get` ·
//!   `staff.services.eligible_for_service` — the three links of a booking (appointments#11):
//!   `create` freezes name/phone/email, service name/price/duration and the professional from
//!   THESE rows; the payload's own names/prices are ignored and an id that does not resolve is
//!   a domain refusal. Without these reads `create` refuses (never degrades to the payload).
//!
//! Since appointments#54 `bulk_create` and `recurring.materialize` declare THE SAME reads: a
//! batch is one customer booking N slots and a series is ONE template, so their three ids sit at
//! the top level of the payload — the only shape `reads.params` can filter by — and both inherit
//! the whole fail-closed behaviour of `create`. `materialize` additionally loads the template by
//! id (`appointments.recurring.get`) and refuses when the ids sent do not match it. No command
//! writes a name or a price the caller supplied any more; `payload.existing_appointments` remains
//! only as the overlap fallback for the callers whose window a per-day read cannot express.
//!
//! Nº de cita `APT-YYYYMMDD-NNNN`: contador atómico por hub+día (patrón de
//! `sales`): el handler emite `_bump_counter` (UPSERT) y `_insert_appointment`
//! calcula el número leyendo el contador en la MISMA transacción. El guest solo
//! aporta `:day`; nunca lee el contador (sin read-back).
//!
//! Ids: el host pasa `context.new_ids` (autoridad de ids); el guest solo los
//! reparte (`appointment_id`). El id de cada fila de historial lo pone el host
//! (`:new_id` fresco por operación).

use erplora_guest_sdk::money;
use erplora_guest_sdk::{DomainError, Operation, Output};
use serde_json::{json, Map, Value};

#[cfg(feature = "guest")]
use extism_pdk::*;

// ───────────────────────────── entry points (guest) ─────────────────────────────

#[cfg(feature = "guest")]
fn guest_result(out: Result<Output, String>) -> FnResult<Json<Output>> {
    match out {
        Ok(o) => Ok(Json(o)),
        Err(e) => Err(WithReturnCode::new(Error::msg(e), 1)),
    }
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn create_appointment(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(create_appointment_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn day_opening(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(day_opening_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn check_availability(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(check_availability_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn available_slots(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(available_slots_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn bulk_create(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(bulk_create_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn bulk_delete(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(bulk_delete_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn cancel_appointment(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(cancel_appointment_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn materialize_recurring(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(materialize_recurring_pure(input.into_inner().into_value()))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn update_recurring_series(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(update_recurring_series_pure(
        input.into_inner().into_value(),
    ))
}

#[cfg(feature = "guest")]
#[plugin_fn]
pub fn reschedule_appointment(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(reschedule_appointment_pure(input.into_inner().into_value()))
}

// ───────────────────────────── helpers JSON ─────────────────────────────

fn as_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn as_i64(v: &Value, d: i64) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().unwrap_or(d),
        Value::String(s) => s.trim().parse::<i64>().unwrap_or(d),
        Value::Bool(b) => *b as i64,
        _ => d,
    }
}

// El DINERO lo lee `erplora_guest_sdk::money` (ADR-0123): una sola implementación para todo el hub.

fn as_bool(v: &Value) -> bool {
    match v {
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        Value::String(s) => matches!(s.as_str(), "1" | "true" | "True" | "yes"),
        _ => false,
    }
}

fn str_or(p: &Value, k: &str, d: &str) -> String {
    let s = as_str(p.get(k).unwrap_or(&Value::Null));
    if s.is_empty() {
        d.to_string()
    } else {
        s
    }
}

// ───────────────────────────── fecha/hora (sin deps) ─────────────────────────────
// Calendario civil proléptico (algoritmos de Howard Hinnant). El guest no tiene
// reloj: `now` lo aporta el host. Sin zona horaria "real": si la fecha trae
// offset se usa para comparar en UTC; si no, se compara hora de pared.

/// Fecha-hora descompuesta + offset opcional (minutos respecto a UTC).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dt {
    pub y: i64,
    pub mo: i64,
    pub d: i64,
    pub h: i64,
    pub mi: i64,
    pub s: i64,
    pub offset_min: i64,
    pub has_offset: bool,
}

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap(y) {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Días desde 1970-01-01 (puede ser negativo).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Inversa de [`days_from_civil`].
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 {
        y += 1;
    }
    (y, m, d)
}

/// Día de la semana 0=Lunes..6=Domingo (convención del módulo).
fn weekday_mon0(days: i64) -> i64 {
    (days + 3).rem_euclid(7) // 1970-01-01 fue jueves (índice 3 en Lun=0)
}

impl Dt {
    /// Segundos de pared (sin aplicar offset) desde la época.
    fn wall_secs(&self) -> i64 {
        days_from_civil(self.y, self.mo, self.d) * 86_400 + self.h * 3_600 + self.mi * 60 + self.s
    }

    /// Instante UTC en segundos (aplica el offset si lo hay).
    fn epoch_secs(&self) -> i64 {
        self.wall_secs() - self.offset_min * 60
    }

    fn add_minutes(&self, minutes: i64) -> Dt {
        let total = self.wall_secs() + minutes * 60;
        let days = total.div_euclid(86_400);
        let rem = total.rem_euclid(86_400);
        let (y, mo, d) = civil_from_days(days);
        Dt {
            y,
            mo,
            d,
            h: rem / 3_600,
            mi: (rem % 3_600) / 60,
            s: rem % 60,
            offset_min: self.offset_min,
            has_offset: self.has_offset,
        }
    }

    /// ISO 8601 `YYYY-MM-DDTHH:MM:SS[(+|-)HH:MM]` (conserva el offset de origen).
    fn iso(&self) -> String {
        let base = format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
            self.y, self.mo, self.d, self.h, self.mi, self.s
        );
        if self.has_offset {
            let sign = if self.offset_min < 0 { '-' } else { '+' };
            let abs = self.offset_min.abs();
            format!("{base}{sign}{:02}:{:02}", abs / 60, abs % 60)
        } else {
            base
        }
    }

    /// `YYYYMMDD` (día de pared) para el contador de nº de cita.
    fn day_key(&self) -> String {
        format!("{:04}{:02}{:02}", self.y, self.mo, self.d)
    }
}

/// Compara dos instantes: si ambos llevan offset compara en UTC; si alguno es
/// "naive" compara hora de pared (mejor esfuerzo, coherente con cómo guarda la UI).
fn cmp_secs(a: &Dt, b: &Dt) -> i64 {
    if a.has_offset && b.has_offset {
        a.epoch_secs() - b.epoch_secs()
    } else {
        a.wall_secs() - b.wall_secs()
    }
}

// ───────────────────────────── el reloj del NEGOCIO (appointments#12) ─────────────────────────
//
// The core owns the business timezone (`settings::timezone_of`, hub#731) and hands it to every
// command as `context.timezone` (hub#1022). This module CONSUMES it: no column of its own, no
// second copy, no guessing an offset.
//
// What the core hands over is the IANA NAME, not the rules, so the table travels with the guest —
// the same `chrono-tz` the runtime itself uses, so there is one implementation of time zones in
// the hub instead of two that can disagree.

/// The business clock. Degrades to `UTC` exactly like the runtime's `timezone_name()` does: an
/// unreadable name is a wrong clock by a known amount, never a guess.
fn business_tz(input: &Value) -> chrono_tz::Tz {
    input
        .get("context")
        .and_then(|c| c.get("timezone"))
        .map(as_str)
        .and_then(|name| name.parse::<chrono_tz::Tz>().ok())
        .unwrap_or(chrono_tz::UTC)
}

/// The first instant whose local time has reached `naive`, when `naive` itself never happens.
///
/// Byte-for-byte the core's rule (`crates/runtime/src/scheduler.rs::gap_end`), and deliberately
/// so: a `cron` trigger and a recurring series must never disagree about what «02:30 on the day
/// the clock jumps» means. Bisection instead of «add one hour» because the jump is 30 minutes in
/// Lord Howe, and a hard-coded hour is how a rule that «should be fine everywhere» is wrong
/// somewhere.
fn gap_end(naive: &chrono::NaiveDateTime, tz: chrono_tz::Tz) -> chrono::DateTime<chrono::Utc> {
    use chrono::TimeZone;
    // A 60 h window around the wall-clock time brackets any real transition (the largest UTC
    // offset in the tz database is ±14 h).
    let base = *naive - chrono::Duration::hours(30);
    let (mut lo, mut hi) = (0i64, 60 * 60i64);
    while lo < hi {
        let mid = (lo + hi) / 2;
        let candidate = chrono::Utc.from_utc_datetime(&(base + chrono::Duration::minutes(mid)));
        if candidate.with_timezone(&tz).naive_local() >= *naive {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    chrono::Utc.from_utc_datetime(&(base + chrono::Duration::minutes(lo)))
}

/// A business WALL time (`Y-M-D H:M:S` on the salon clock) as the ISO text this module stores:
/// the wall clock plus the offset that zone had at that moment (`2026-08-03T11:00:00+02:00`).
///
/// Two readings in one string, both true — the instant, and the salon's wall clock, which is what
/// the availability engine compares row against row (appointments#76). The three DST answers are
/// the core's, not new ones: normal → itself; ambiguous → the FIRST pass; non-existent → the
/// instant the clock jumped into it.
fn business_wall_iso(
    y: i64,
    mo: i64,
    d: i64,
    h: i64,
    mi: i64,
    sec: i64,
    tz: chrono_tz::Tz,
) -> Option<String> {
    use chrono::TimeZone;
    let naive = chrono::NaiveDate::from_ymd_opt(y as i32, mo as u32, d as u32)?
        .and_hms_opt(h as u32, mi as u32, sec as u32)?;
    let instant = match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => dt.with_timezone(&chrono::Utc),
        chrono::LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&chrono::Utc),
        chrono::LocalResult::None => gap_end(&naive, tz),
    };
    Some(
        instant
            .with_timezone(&tz)
            .format("%Y-%m-%dT%H:%M:%S%:z")
            .to_string(),
    )
}

/// `iso` plus `minutes`, as INSTANTS, rendered back on the business clock.
///
/// Not «add the minutes to the wall clock»: on the day the clock changes, an appointment that
/// starts at 01:30 and lasts an hour ends at 03:30 on the wall, and the room is busy for sixty
/// minutes either way. Adding to the wall would say otherwise.
fn business_iso_plus_minutes(iso: &str, minutes: i64, tz: chrono_tz::Tz) -> Option<String> {
    let parsed = chrono::DateTime::parse_from_rfc3339(iso).ok()?;
    let end = parsed.with_timezone(&tz) + chrono::Duration::minutes(minutes);
    Some(end.format("%Y-%m-%dT%H:%M:%S%:z").to_string())
}

/// `YYYYMMDD` of the BUSINESS day an instant falls on — the key the appointment counter runs on.
///
/// It used to be the wall part of `context.now`, which the host sends in UTC: in Madrid the
/// numbering started a new series at 02:00 in summer, so a late appointment carried tomorrow's
/// stamp and two bookings of the same working day were filed under different days. Every POS in
/// the market cuts its numbering on the business day; it is the same day the cash register closes.
fn business_day_key(instant: &Dt, tz: chrono_tz::Tz) -> String {
    match chrono::DateTime::from_timestamp(instant.epoch_secs(), 0) {
        Some(dt) => dt.with_timezone(&tz).format("%Y%m%d").to_string(),
        // Unreachable for any date a calendar can hold; degrading to the wall day beats panicking
        // inside a guest, where a panic is a command that never answers.
        None => instant.day_key(),
    }
}

/// Parsea ISO 8601 laxo: `YYYY-MM-DD[ T HH:MM[:SS[.fff]]][Z|±HH[:]MM]`.
pub fn parse_dt(input: &str) -> Option<Dt> {
    let t = input.trim();
    if t.len() < 10 || t.as_bytes().get(4) != Some(&b'-') || t.as_bytes().get(7) != Some(&b'-') {
        return None;
    }
    let y: i64 = t.get(0..4)?.parse().ok()?;
    let mo: i64 = t.get(5..7)?.parse().ok()?;
    let d: i64 = t.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&mo) || d < 1 || d > days_in_month(y, mo) {
        return None;
    }
    let rest = &t[10..];
    let mut dt = Dt {
        y,
        mo,
        d,
        h: 0,
        mi: 0,
        s: 0,
        offset_min: 0,
        has_offset: false,
    };
    if rest.is_empty() {
        return Some(dt);
    }
    let sep = rest.chars().next()?;
    if sep != 'T' && sep != 't' && sep != ' ' {
        return None;
    }
    let rest = &rest[1..];

    // Separa hora y offset ('Z' o '±HH[:]MM'; la hora solo contiene dígitos, ':' y '.').
    let off_pos = rest
        .char_indices()
        .find_map(|(i, c)| matches!(c, 'Z' | 'z' | '+' | '-').then_some(i));
    let (time_part, off_part) = match off_pos {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };

    let mut it = time_part.split(':');
    dt.h = it.next()?.trim().parse().ok()?;
    dt.mi = it.next().unwrap_or("0").trim().parse().ok()?;
    let secs = it.next().unwrap_or("0");
    dt.s = secs.split('.').next().unwrap_or("0").trim().parse().ok()?;
    if !(0..24).contains(&dt.h) || !(0..60).contains(&dt.mi) || !(0..60).contains(&dt.s) {
        return None;
    }

    if !off_part.is_empty() {
        dt.has_offset = true;
        if off_part == "Z" || off_part == "z" {
            dt.offset_min = 0;
        } else {
            let sign: i64 = if off_part.starts_with('-') { -1 } else { 1 };
            let digits: String = off_part[1..]
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect();
            let (oh, om) = match digits.len() {
                2 => (digits.parse::<i64>().ok()?, 0),
                4 => (
                    digits[..2].parse::<i64>().ok()?,
                    digits[2..].parse::<i64>().ok()?,
                ),
                _ => return None,
            };
            dt.offset_min = sign * (oh * 60 + om);
        }
    }
    Some(dt)
}

// ───────────────────────────── contexto + lecturas del payload ─────────────────────────────

struct HostCtx {
    now: Dt,
    new_ids: Vec<String>,
    /// The business clock the core resolved (hub#1022). `UTC` when the context has none.
    tz: chrono_tz::Tz,
}

fn host_ctx(input: &Value) -> Result<HostCtx, String> {
    let context = input.get("context").cloned().unwrap_or(Value::Null);
    let now = parse_dt(&as_str(context.get("now").unwrap_or(&Value::Null)))
        .ok_or_else(|| "context.now inválido (lo inyecta el host)".to_string())?;
    let new_ids = context
        .get("new_ids")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().map(as_str).collect())
        .unwrap_or_default();
    Ok(HostCtx {
        now,
        new_ids,
        tz: business_tz(input),
    })
}

/// Cita candidata a solape (lectura aportada por el caller en el payload).
struct Candidate {
    start: Dt,
    end: Dt,
    label: String,
}

/// Extrae las citas vivas candidatas a solape (ignora cancelled/no_show/borradas).
///
/// **Prioriza las reads autoritativas** que precarga el runtime (ADR-0069, appointments#110):
/// `appointments.appointments.conflicting` para los comandos que mueven UNA cita en un día
/// concreto (`create`, `reschedule`) y `appointments.appointments.upcoming_for_staff` para los que
/// abarcan varios (`bulk_create`, `recurring.materialize`), porque `reads.params` no sabe decir
/// «las citas de CADA uno de estos días». Si no llega ninguna (manifest viejo, query caída),
/// degrada a `payload.existing_appointments`. Antes el handler SOLO miraba el payload, así que si
/// el caller omitía esa lectura no detectaba solape.
///
/// `staff_id` y `exclude_id` acotan lo que de verdad choca: una cita de OTRA profesional no es
/// asunto de esta reserva (misma regla que `_appointment_overlap_assert.sql`), y una cita no se
/// solapa consigo misma — sin eso `reschedule`, cuya read del día se la devuelve, sería imposible.
///
/// `None` = no llegó NINGUNA de las dos reads, y eso es un rechazo, no un lote vacío: hasta
/// appointments#10 aquí se degradaba a `payload.existing_appointments` —la lista que armaba el
/// navegador—, así que una read caída dejaba el solape en manos del caller. Las dos son
/// `required` en el manifest; si aun así faltan, se cierra.
fn candidates_from(input: &Value, staff_id: &str, exclude_id: &str) -> Option<Vec<Candidate>> {
    let rows = read_rows(input, "appointments.appointments.conflicting")
        .or_else(|| read_rows(input, "appointments.appointments.upcoming_for_staff"))?;
    Some(
        rows.iter()
            .filter_map(|row| {
                let status = as_str(row.get("status").unwrap_or(&Value::Null));
                if status == "cancelled" || status == "no_show" {
                    return None;
                }
                if row.get("is_deleted").map(as_bool).unwrap_or(false) {
                    return None;
                }
                if !exclude_id.is_empty()
                    && as_str(row.get("id").unwrap_or(&Value::Null)) == exclude_id
                {
                    return None;
                }
                let owner = as_str(row.get("staff_id").unwrap_or(&Value::Null));
                if !owner.is_empty() && !staff_id.is_empty() && owner != staff_id {
                    return None;
                }
                let start = parse_dt(&as_str(row.get("start_datetime")?))?;
                let end = parse_dt(&as_str(row.get("end_datetime")?))?;
                let number = str_or(row, "appointment_number", "(sin número)");
                Some(Candidate {
                    start,
                    end,
                    label: number,
                })
            })
            .collect(),
    )
}

/// The command payload, or `Null` when there is none.
fn payload_of(input: &Value) -> Value {
    input.get("payload").cloned().unwrap_or(Value::Null)
}

/// The refusal for a read that had to be there and was not.
fn availability_unavailable() -> DomainError {
    DomainError::new(
        "appointments.availability_unavailable",
        "The agenda could not be read; the appointment was not booked.",
    )
}

/// The module settings row the handler decides with.
///
/// **Prefers `context.reads["appointments.settings.get"]`** — the authoritative singleton the
/// runtime pre-loads via the manifest `reads` (ADR-0069, appointments#45): it is the very row
/// the Settings tab edits, so a caller cannot claim `allow_overlapping: true` in the payload to
/// slip past the double-booking guard. When the read is present it wins even if empty (a fresh
/// hub without a settings row falls to the DB defaults, never to the payload). Only when the
/// read is absent (command without `reads`, old manifest) does it degrade to `payload.settings`.
fn settings_from(input: &Value) -> Value {
    let read = input
        .get("context")
        .and_then(|c| c.get("reads"))
        .and_then(|r| r.get("appointments.settings.get"))
        .and_then(|v| v.as_array());
    match read {
        Some(rows) => rows.first().cloned().unwrap_or(Value::Null),
        None => input
            .get("payload")
            .and_then(|p| p.get("settings"))
            .cloned()
            .unwrap_or(Value::Null),
    }
}

// ───────────────── the booking policy is READ, never told (appointments#10/#13) ─────────────────

/// The settings row exactly as the runtime pre-loaded it (`reads`, `required: true`). `None` =
/// the read did not ARRIVE.
///
/// For a WRITE that is a refusal, never a fallback to `payload.settings`: a guard that falls back
/// to the caller when its input is missing is a guard that OPENS — the browser would be handing us
/// `allow_overlapping`, and the overlap gate with it. [`settings_from`] keeps the old fallback for
/// the read-only paths that were built on it.
///
/// A read that arrived EMPTY is a different thing and must not be confused with a failure: the
/// query ran, and this hub simply has no settings row yet because nobody opened the Settings tab
/// (the migration creates no row). Refusing there would mean a brand new hub cannot book its first
/// appointment. It falls to the DB defaults — `allow_overlapping = 0`, no lead-time limits — which
/// are the safe ones; what never comes back is the payload.
fn settings_read(input: &Value) -> Option<Value> {
    let rows = read_rows(input, "appointments.settings.get")?;
    Some(rows.first().cloned().unwrap_or_else(|| json!({})))
}

fn allow_overlapping_of(settings: &Value) -> bool {
    settings
        .get("allow_overlapping")
        .map(as_bool)
        .unwrap_or(false)
}

/// Does this hub let a booking it did not type itself skip the manual review
/// (appointments#136)?
///
/// Absent = ON, because that is what the column says (`NOT NULL DEFAULT 1`) and what the Settings
/// screen shows (schema `default: true`). The one read that arrives without the key in production
/// is the EMPTY one: a brand new hub has no settings row until somebody opens the Settings tab and
/// saves, and [`settings_read`] hands `{}` over then — «falls to the DB defaults», its own words.
/// That hub is precisely the salon that just installed the WhatsApp channel; reading the empty
/// row as OFF would make its first bookings wait for a review the screen says is switched off,
/// and nothing would tell anyone. Same rule as [`default_duration_of`] (60) and
/// [`allow_overlapping_of`] (false): the fallback IS the column default, never a third value.
fn auto_confirm_online_of(settings: &Value) -> bool {
    settings
        .get("auto_confirm_online")
        .map(as_bool)
        .unwrap_or(true)
}

/// Is this booking already committed by the person who made it, so that nobody at the salon has
/// to press «Confirm»? (appointments#136)
///
/// Until this existed EVERY appointment was born `pending`, including the ones the customer had
/// just booked herself — so a salon running the unattended WhatsApp channel (whatsapp_inbox#58)
/// still had a person in the middle of every single booking, which is what the channel exists to
/// remove. Fresha, Booksy and Square all accept an online booking automatically and make «review
/// before accepting» the option a business turns ON, so that is the shape: the switch ships on and
/// switching it off restores the old behaviour exactly.
///
/// **One door counts: `booked_online`** — the flag an online booking carries. It is the caller's
/// claim, and it is the same claim the row has always stored; what is new is that the salon's own
/// setting decides what to do with it. (A second door, the `request_id` of an approved WhatsApp
/// request, was retired with that listener in appointments#183.)
///
/// Everything else — what the counter types, the occurrences a recurring series materialises — is
/// the salon's own booking and keeps going through the salon's own review.
fn born_confirmed(item: &Value, settings: &Value) -> bool {
    auto_confirm_online_of(settings) && item.get("booked_online").map(as_bool).unwrap_or(false)
}

fn default_duration_of(settings: &Value) -> i64 {
    settings
        .get("default_duration")
        .map(|v| as_i64(v, 60))
        .filter(|d| *d >= 1)
        .unwrap_or(60)
}

/// Lead time: how soon, and how far out, this hub accepts a booking.
///
/// `min_booking_notice` (minutes) and `max_advance_booking` (days) are both DURATIONS measured
/// from `now`, so they compare two UTC instants and need **no timezone** — unlike the wall-clock
/// rules next door, which had to wait for `context.timezone` (hub#1022) and now live in
/// [`schedule_refusal`]. `0` disables a limit: a hub that wants no minimum notice says so with a zero, and a
/// zero must never mean "nothing can be booked".
///
/// The boundary is inclusive: with a 60 minute notice, booking exactly 60 minutes ahead is valid.
///
/// `waive_min_notice` is the counter's declaration (appointments#157): the minimum notice is the
/// customer's window, so it steps aside; the maximum advance does not.
fn lead_time_refusal(
    settings: &Value,
    start: &Dt,
    now: &Dt,
    waive_min_notice: bool,
) -> Option<DomainError> {
    let ahead = cmp_secs(start, now);

    let notice_min = settings
        .get("min_booking_notice")
        .map(|v| as_i64(v, 0))
        .unwrap_or(0);
    if !waive_min_notice && notice_min > 0 && ahead < notice_min * 60 {
        return Some(DomainError::new(
            "appointments.too_soon",
            &format!("This appointment must be booked at least {notice_min} minutes in advance."),
        ));
    }

    let max_days = settings
        .get("max_advance_booking")
        .map(|v| as_i64(v, 0))
        .unwrap_or(0);
    if max_days > 0 && ahead > max_days * 86_400 {
        return Some(DomainError::new(
            "appointments.too_far",
            &format!("This appointment cannot be booked more than {max_days} days in advance."),
        ));
    }

    None
}

/// Blocked time: holidays, closures, a professional's training slot.
///
/// Reads this module's OWN table (`required: true`), so a missing read is a runtime fault and
/// refuses — it does not wave the booking through. The rows carry ISO-8601 instants, not wall
/// clock, so this needs no timezone either.
///
/// Two queries feed it, and either will do: `appointments.blocked_times.overlapping` (the blocks
/// touching ONE day) for `create` and `reschedule`, and `appointments.blocked_times.upcoming` (all
/// the blocks still ahead) for `bulk_create` and `recurring.materialize`, which span several days
/// and cannot express «the blocks of each of THESE days» with `reads.params`.
///
/// A block with no `staff_id` closes the agenda for everybody; a block on someone else is none of
/// this booking's business. Touching edges do not overlap: a block ending at 11:00 leaves 11:00
/// free — the same `[start, end)` convention as the overlap gate.
fn blocked_refusal(input: &Value, staff_id: &str, start: &Dt, end: &Dt) -> Option<DomainError> {
    let Some(rows) = read_rows(input, "appointments.blocked_times.overlapping")
        .or_else(|| read_rows(input, "appointments.blocked_times.upcoming"))
    else {
        return Some(DomainError::new(
            "appointments.availability_unavailable",
            "The agenda's blocked periods could not be read; the appointment was not booked.",
        ));
    };

    let hit = rows.iter().find(|row| {
        if row.get("is_deleted").map(as_bool).unwrap_or(false) {
            return false;
        }
        let owner = as_str(row.get("staff_id").unwrap_or(&Value::Null));
        if !owner.is_empty() && owner != staff_id {
            return false;
        }
        let (Some(b_start), Some(b_end)) = (
            parse_dt(&as_str(row.get("start_datetime").unwrap_or(&Value::Null))),
            parse_dt(&as_str(row.get("end_datetime").unwrap_or(&Value::Null))),
        ) else {
            return false;
        };
        cmp_secs(&b_start, end) < 0 && cmp_secs(&b_end, start) > 0
    })?;

    let title = str_or(hit, "title", "blocked");
    Some(DomainError::new(
        "appointments.blocked",
        &format!("That slot is blocked in the agenda ({title})."),
    ))
}

/// An instant read on the BUSINESS wall clock: the date, its weekday and the minute of the day.
///
/// `dow` is 0 = Monday … 6 = Sunday, the module's convention everywhere (docs/concepts.md), the one
/// stored in `appointments_schedule_timeslot.day_of_week` and the one `schedules.business_hours`
/// publishes.
///
/// This is the crossing the opening-hours rule needed and could not do before: the hours are wall
/// clock (`HH:MM` on a weekday), an appointment is an instant, and only the business timezone
/// relates the two. `chrono_tz` applies the real IANA rules, so the answer stays right on the two
/// days a year when the offset moves — which is the whole reason this was not done by guessing.
struct WallStamp {
    /// `YYYY-MM-DD` of the business, which is what a special day or an override is keyed by.
    date: String,
    dow: i64,
    minute: i64,
}

fn business_wall_stamp(instant: &Dt, tz: chrono_tz::Tz) -> Option<WallStamp> {
    use chrono::{Datelike, Timelike};
    let local = chrono::DateTime::from_timestamp(instant.epoch_secs(), 0)?.with_timezone(&tz);
    Some(WallStamp {
        date: local.format("%Y-%m-%d").to_string(),
        dow: local.weekday().num_days_from_monday() as i64,
        minute: local.hour() as i64 * 60 + local.minute() as i64,
    })
}

/// `HH:MM[:SS]` → minutes since midnight.
fn wall_minutes(text: &str) -> Option<i64> {
    let mut parts = text.trim().split(':');
    let h: i64 = parts.next()?.parse().ok()?;
    let m: i64 = parts.next()?.parse().ok()?;
    if !(0..=24).contains(&h) || !(0..60).contains(&m) {
        return None;
    }
    Some(h * 60 + m)
}

/// The four published lists of `schedules`, the AUTHORITY for the business opening hours
/// (appointments#102, ADR-0392). They arrive pre-loaded by the runtime (`reads`, ADR-0069) and
/// never from the payload: a schedule the caller supplies is a schedule the caller can forge.
const SCHEDULES_HOURS_READ: &str = "schedules.business_hours.list";
const SCHEDULES_SPECIAL_DAYS_READ: &str = "schedules.special_days.list";
const SCHEDULES_OVERRIDES_READ: &str = "schedules.overrides.list";
const SCHEDULES_EXCEPTION_INTERVALS_READ: &str = "schedules.exception_intervals.list";

/// An open stretch of one date, in minutes from ITS midnight. `end` runs past 1440 when the
/// stretch crosses midnight, and `start` goes negative for the tail of the previous night, so a
/// booking window can be compared against it with plain arithmetic.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Span {
    start: i64,
    end: i64,
}

/// What `schedules` says about ONE date.
enum DayOpening {
    /// The authority shuts the date: a closed special day, a closed override, a weekday marked
    /// closed, or a weekday it simply does not open.
    Closed,
    /// The stretches the business is open, breaks already carved out.
    Open(Vec<Span>),
}

fn opt_str(row: &Value, key: &str) -> Option<String> {
    let text = as_str(row.get(key)?);
    (!text.is_empty()).then_some(text)
}

fn bool_or(row: &Value, key: &str, default: bool) -> bool {
    match row.get(key) {
        None | Some(Value::Null) => default,
        Some(value) => as_bool(value),
    }
}

/// `HH:MM` pair → a span. `00:00–00:00` is «open 24 hours» and `close <= open` crosses midnight,
/// the two conventions `schedules` writes (schedules#8, the shape Google Business Profile uses).
fn span_of(open: &str, close: &str) -> Option<Span> {
    let (from, to) = (wall_minutes(open)?, wall_minutes(close)?);
    if from == 0 && to == 0 {
        return Some(Span {
            start: 0,
            end: 1440,
        });
    }
    Some(Span {
        start: from,
        end: if to <= from { to + 1440 } else { to },
    })
}

/// A break is CLOSED time inside an open stretch, so it splits it in two. Carving it out here —
/// instead of testing «is this instant on a break?» as `schedules.is_open` does for a point in
/// time — is what makes a booking that merely RUNS INTO the break not fit either.
fn without_break(span: Span, break_start: Option<i64>, break_end: Option<i64>) -> Vec<Span> {
    let (Some(from), Some(to)) = (break_start, break_end) else {
        return vec![span];
    };
    if to <= from {
        return vec![span];
    }
    let mut out = Vec::new();
    if from > span.start {
        out.push(Span {
            start: span.start,
            end: from.min(span.end),
        });
    }
    if to < span.end {
        out.push(Span {
            start: to.max(span.start),
            end: span.end,
        });
    }
    out
}

/// The stretches of one exception (a special day or an override), in `position` order
/// (schedules#23). Several rows for the same exception are a split shift.
fn exception_spans(intervals: &[Value], kind: &str, id: &Value) -> Vec<Span> {
    let owner = as_str(id);
    let mut rows: Vec<&Value> = intervals
        .iter()
        .filter(|r| {
            str_or(r, "exception_kind", "") == kind && str_or(r, "exception_id", "") == owner
        })
        .collect();
    rows.sort_by_key(|r| as_i64(r.get("position").unwrap_or(&Value::Null), 0));
    rows.iter()
        .filter_map(|r| {
            span_of(
                &str_or(r, "open_time", "00:00"),
                &str_or(r, "close_time", "00:00"),
            )
        })
        .collect()
}

/// One exception row → what it does to its date. `closed_by_default` is the difference `schedules`
/// makes between the two kinds: a special day with no flag is a CLOSURE (a bank holiday), an
/// override with no flag is a change of hours.
fn exception_opening(
    row: &Value,
    kind: &str,
    intervals: &[Value],
    closed_by_default: bool,
) -> DayOpening {
    if bool_or(row, "is_closed", closed_by_default) {
        return DayOpening::Closed;
    }
    let spans = exception_spans(intervals, kind, row.get("id").unwrap_or(&Value::Null));
    if !spans.is_empty() {
        return DayOpening::Open(spans);
    }
    // No interval rows: the legacy pair on the exception's own row still decides, and an exception
    // that opens without saying any hours is open all day.
    match (opt_str(row, "open_time"), opt_str(row, "close_time")) {
        (Some(open), Some(close)) => match span_of(&open, &close) {
            Some(span) => DayOpening::Open(vec![span]),
            None => DayOpening::Closed,
        },
        _ => DayOpening::Open(vec![Span {
            start: 0,
            end: 1440,
        }]),
    }
}

/// What the AUTHORITY says about the date of this booking, or `Ok(None)` when it says nothing at
/// all — no exception covers the date and the hub has not written a single weekly interval — and
/// the module's own timeslots still answer (see [`schedule_refusal`]).
///
/// The precedence is ADR-0392's, in its order: exact special day > yearly special day > override
/// range > weekly hours. `schedules.is_open` resolves the same chain for an INSTANT; a booking
/// needs the stretches themselves, because it has to fit whole inside one of them.
fn schedules_opening(input: &Value, at: &WallStamp) -> Result<Option<DayOpening>, DomainError> {
    let (Some(hours), Some(special_days), Some(overrides), Some(intervals)) = (
        read_rows(input, SCHEDULES_HOURS_READ),
        read_rows(input, SCHEDULES_SPECIAL_DAYS_READ),
        read_rows(input, SCHEDULES_OVERRIDES_READ),
        read_rows(input, SCHEDULES_EXCEPTION_INTERVALS_READ),
    ) else {
        return Err(DomainError::new(
            "appointments.availability_unavailable",
            "The business opening hours could not be read; the appointment was not booked.",
        ));
    };

    // 1) A special day: the exact date beats a yearly one (ADR-0392), which matches on MM-DD.
    let exact = special_days
        .iter()
        .find(|r| str_or(r, "date", "") == at.date);
    let yearly = special_days.iter().find(|r| {
        let date = str_or(r, "date", "");
        bool_or(r, "recurring_yearly", false) && date.len() == 10 && date[5..] == at.date[5..]
    });
    if let Some(day) = exact.or(yearly) {
        return Ok(Some(exception_opening(day, "special_day", intervals, true)));
    }

    // 2) An override range covering the date.
    if let Some(override_row) = overrides.iter().find(|r| {
        let from = str_or(r, "start_date", "");
        let to = str_or(r, "end_date", "");
        !from.is_empty()
            && !to.is_empty()
            && from.as_str() <= at.date.as_str()
            && at.date.as_str() <= to.as_str()
    }) {
        return Ok(Some(exception_opening(
            override_row,
            "override",
            intervals,
            false,
        )));
    }

    // 3) The weekly hours. With not one row the hub has not set them here at all, and the answer
    //    belongs to the fallback, not to this function.
    if hours.is_empty() {
        return Ok(None);
    }

    let of_day = |day: i64| -> Vec<&Value> {
        hours
            .iter()
            .filter(|r| as_i64(r.get("day_of_week").unwrap_or(&Value::Null), -1) == day)
            .collect()
    };
    // Last night's overnight shift (a bar open 20:00–02:00) reaches into this morning, so it is a
    // stretch of TODAY measured from today's midnight — hence the negative start.
    let mut spans: Vec<Span> = of_day((at.dow + 6) % 7)
        .into_iter()
        .filter(|r| !bool_or(r, "is_closed", false))
        .filter_map(|r| {
            span_of(
                &str_or(r, "open_time", "00:00"),
                &str_or(r, "close_time", "00:00"),
            )
        })
        .filter(|span| span.end > 1440)
        .map(|span| Span {
            start: span.start - 1440,
            end: span.end - 1440,
        })
        .collect();

    let today = of_day(at.dow);
    // A row marked closed shuts the day — but last night's tail, if any, still holds.
    if !today.iter().any(|r| bool_or(r, "is_closed", false)) {
        for row in &today {
            let Some(span) = span_of(
                &str_or(row, "open_time", "00:00"),
                &str_or(row, "close_time", "00:00"),
            ) else {
                continue;
            };
            let break_start = opt_str(row, "break_start").and_then(|t| wall_minutes(&t));
            let break_end = opt_str(row, "break_end").and_then(|t| wall_minutes(&t));
            spans.extend(without_break(span, break_start, break_end));
        }
    }

    Ok(Some(if spans.is_empty() {
        DayOpening::Closed
    } else {
        DayOpening::Open(spans)
    }))
}

/// The business's opening hours, enforced (appointments#89) and read from their OWNER
/// (appointments#102).
///
/// `queries/availability_check.sql` has computed `outside_schedule` since the beginning, but a
/// query only INFORMS the screen. Every other door — the assistant, a flow, `whatsapp_inbox`, the
/// public API — could book at three in the morning. This is the same rule, where the decision is
/// actually taken, as an AUTHORITATIVE read (ADR-0069) and never from the payload.
///
/// **Who owns the hours.** `appointments` owns the appointment and the agenda block; the business
/// opening hours belong to `schedules`, which ADR-0392 made the single answer of the product to
/// «are we open?». appointments#89 shipped the door reading our OWN tables because the ownership
/// matrix was read as «no such module»; it exists, published, and its `special_days` — the bank
/// holidays — were invisible here. So the chain is now `schedules`': exact special day > yearly
/// special day > override range > weekly hours, resolved for the booking's own date.
///
/// **One answer, and only one.** `schedules` is the ONLY place the hours are read from
/// (appointments#118). This module kept its own copy of the timetable as a transitional fallback
/// for a hub configured before appointments#102; appointments#117 left it with no screen to write
/// it and schedules#36 seeds a whole week on install, so what those rows still held was a leftover
/// nobody could see refusing bookings nobody could explain. The tables, their read and the branch
/// that consulted them are gone.
///
/// The rest of the semantics are unchanged:
///
///   * the hours are the hub's, not the professional's. Whether a given professional works that
///     hour is a different rule, read from `staff` by [`staff_hours_refusal`] (appointments#98);
///   * a hub with NO rule anywhere has not configured its opening hours, and then every calendar
///     hour is bookable. Refusing there would turn «I have not set my hours yet» into «I cannot
///     take bookings», which is an outage, not a guard — and it is what the market does: nobody
///     lets the back office be locked out (Setmore ships an explicit off-hours toggle, Acuity and
///     Square let the counter book anyway), they make «no hours» unreachable by seeding them
///     instead. Note this is NOT a different answer from ADR-0392: `schedules.is_open` still says
///     `no_hours` (not open), and decision 4 keeps that verdict for itself while leaving the
///     consumer free to treat the code as «nothing configured» rather than «shut». Seeding a
///     default week so the state stops being reachable is schedules#36;
///   * the appointment must fit WHOLE inside one open stretch — `[start, end]`, both ends
///     included, so a booking that runs past closing, or into the lunch break, is out.
///
/// Missing read = refusal, never an open door: the manifest declares them `required`, and a guard
/// that shrugs when its input is absent is a guard that opens (appointments#10).
fn schedule_refusal(input: &Value, tz: chrono_tz::Tz, start: &Dt, end: &Dt) -> Option<DomainError> {
    let (Some(from), Some(to)) = (business_wall_stamp(start, tz), business_wall_stamp(end, tz))
    else {
        return Some(DomainError::new(
            "appointments.availability_unavailable",
            "The appointment's time could not be read on the business clock.",
        ));
    };

    let opening = match schedules_opening(input, &from) {
        Ok(opening) => opening,
        Err(refusal) => return Some(refusal),
    };
    // Nothing configured ANYWHERE: every hour of the calendar is bookable. Refusing here would
    // turn «I have not set my hours yet» into «I cannot take bookings», an outage and not a guard
    // — and it is what the market does (Setmore ships an off-hours toggle, Acuity and Square let
    // the counter book anyway). Since schedules#36 the authority seeds a whole week on install, so
    // this is only reached by a hub that deliberately cleared it.
    let Some(opening) = opening else {
        return None;
    };

    // The booking measured from midnight of its OWN date: an appointment that runs into the next
    // day keeps counting past 1440, which is what lets an overnight shift hold it. Longer than a
    // calendar day never fits any stretch.
    let Some(window_end) = day_offset(&from.date, &to.date).and_then(|days| match days {
        0 => Some(to.minute),
        1 => Some(to.minute + 1440),
        _ => None,
    }) else {
        return Some(outside_schedule());
    };

    let fits = match &opening {
        DayOpening::Closed => false,
        DayOpening::Open(spans) => spans
            .iter()
            .any(|span| span.start <= from.minute && window_end <= span.end),
    };
    if fits {
        None
    } else {
        Some(outside_schedule())
    }
}

/// The professional's business day at the booking's instant, from its OWNER (appointments#98):
/// `staff.availability.day_at` keyed by `payload.staff_id` + `payload.start_datetime`.
const STAFF_DAY_READ: &str = "staff.availability.day_at";
const OUTSIDE_STAFF_HOURS: &str = "appointments.outside_staff_hours";
const STAFF_HOURS_UNAVAILABLE: &str = "appointments.staff_hours_unavailable";

/// Which booking doors enforce the professional's hours. `create` does; the batch and the series
/// book across several days and `staff.availability.day_at` answers ONE day, so they cannot yet —
/// declared, not forgotten: appointments#229 (with `reschedule`, whose payload has no staff).
#[derive(Clone, Copy, PartialEq)]
enum StaffHoursGate {
    Enforce,
    NotDeclared,
}

/// The PROFESSIONAL's working hours, enforced (appointments#98) and read from their owner.
///
/// The business being open (#89, [`schedule_refusal`]) says nothing about whether this person
/// works that hour. `staff.availability.day_at` answers the business day the booking's instant
/// falls on: its governing template (`day` row), the working pieces (`shift`) and the approved
/// absences (`off`). The handler owns the booking's END, so the fit is decided here:
///
///   * an approved absence overlapping the booking refuses — full day, or `[s, e)` crossing it;
///   * on a day a template governs, the booking must fit WHOLE inside one piece, both ends
///     included — the same `[start, end]` rule as the business hours;
///   * a day NO template governs is a professional who has not configured her hours: nothing to
///     refuse on (only an absence can). Refusing there would switch off booking for every hub that
///     never set shifts up — the #89 degradation, for the same reason.
///
/// Missing read, no `day` row, or a restricting answer about ANOTHER day = refusal
/// (`staff_hours_unavailable`), never an open door and never a verdict about the wrong day.
fn staff_hours_refusal(input: &Value, tz: chrono_tz::Tz, start: &Dt, end: &Dt) -> Option<DomainError> {
    let unavailable = || {
        DomainError::new(
            STAFF_HOURS_UNAVAILABLE,
            "The professional's working hours could not be read; nothing was booked.",
        )
    };
    let kind = |row: &Value| row.get("kind").map(as_str).unwrap_or_default();
    let Some(rows) = read_rows(input, STAFF_DAY_READ) else {
        return Some(unavailable());
    };
    let Some(day) = rows.iter().find(|r| kind(r) == "day") else {
        return Some(unavailable());
    };
    let governed = !day.get("schedule_id").map(as_str).unwrap_or_default().is_empty();
    let absences: Vec<&Value> = rows.iter().filter(|r| kind(r) == "off").collect();
    if !governed && absences.is_empty() {
        return None;
    }

    let (Some(from), Some(to)) = (business_wall_stamp(start, tz), business_wall_stamp(end, tz))
    else {
        return Some(unavailable());
    };
    if day.get("day").map(as_str).unwrap_or_default() != from.date {
        return Some(unavailable());
    }
    // Measured from midnight of the booking's own date, like `schedule_refusal`.
    let window_end = match day_offset(&from.date, &to.date) {
        Some(0) => to.minute,
        Some(1) => to.minute + 1440,
        _ => return Some(outside_staff_hours()),
    };

    let minutes = |row: &Value, col: &str| {
        row.get(col)
            .map(as_str)
            .and_then(|text| wall_minutes(&text))
    };
    for absence in absences {
        if as_bool(absence.get("is_full_day").unwrap_or(&Value::Null)) {
            return Some(outside_staff_hours());
        }
        let (Some(s), Some(e)) = (minutes(absence, "start_time"), minutes(absence, "end_time")) else {
            return Some(unavailable());
        };
        if s < window_end && e > from.minute {
            return Some(outside_staff_hours());
        }
    }

    if governed {
        let fits = rows.iter().filter(|r| kind(r) == "shift").any(|piece| {
            match (minutes(piece, "start_time"), minutes(piece, "end_time")) {
                (Some(s), Some(e)) => s <= from.minute && window_end <= e,
                _ => false,
            }
        });
        if !fits {
            return Some(outside_staff_hours());
        }
    }
    None
}

fn outside_staff_hours() -> DomainError {
    DomainError::new(
        OUTSIDE_STAFF_HOURS,
        "That professional does not work at that time.",
    )
}

fn outside_schedule() -> DomainError {
    DomainError::new(
        "appointments.outside_schedule",
        "That time is outside the business opening hours.",
    )
}

/// Whole days from `from` to `to`, both `YYYY-MM-DD`. `None` when either is unreadable.
fn day_offset(from: &str, to: &str) -> Option<i64> {
    let civil = |date: &str| -> Option<i64> {
        let mut parts = date.split('-');
        let y: i64 = parts.next()?.parse().ok()?;
        let m: i64 = parts.next()?.parse().ok()?;
        let d: i64 = parts.next()?.parse().ok()?;
        Some(days_from_civil(y, m, d))
    };
    Some(civil(to)? - civil(from)?)
}

/// A `YYYY-MM-DD` of the business calendar, at its own midnight. The screen asks about a DATE and
/// not about an instant, so there is no clock to cross here: the date already IS the business's
/// own, which is exactly the key a special day or an override is written under.
fn wall_stamp_of_date(date: &str) -> Option<WallStamp> {
    use chrono::Datelike;
    let day = chrono::NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d").ok()?;
    Some(WallStamp {
        // Re-formatted, never echoed: `2026-7-27` parses and would then match no rule at all.
        date: day.format("%Y-%m-%d").to_string(),
        dow: day.weekday().num_days_from_monday() as i64,
        minute: 0,
    })
}

/// The open stretches of ONE date, AS THE DOOR SEES THEM (appointments#105).
///
/// **Why a command and not a query.** `queries/availability_slots.sql` has filtered by the
/// module's OWN `appointments_schedule_timeslot` since the beginning, and after appointments#102
/// the door stopped asking those tables whenever `schedules` carries a rule. SQL cannot follow:
/// a query of this module may only name this module's tables, so it cannot read `schedules_*` —
/// and for the normal hub after #102 (hours in `schedules`, our timeslots empty) its filter
/// matches nothing at all. The list offered 08:00 to a salon that opens at 10:00 and `create`
/// refused it one click later with `appointments.outside_schedule`: the screen contradicting the
/// door, which is the defect appointments#105 names.
///
/// **Why it does not resolve anything itself.** It runs [`schedules_opening`] — the very function
/// the gate runs — for the date the screen is showing. There is no second implementation of
/// ADR-0392's precedence to drift: whatever the door will accept is what comes back, and
/// `day_opening_accepts_exactly_what_the_door_accepts` pins them together for good.
///
/// The answer says WHO answered, because the two cases need opposite things from the caller:
///
///   * `source: "schedules"` — the authority resolved the date. `spans` are the open stretches in
///     minutes from the date's OWN midnight (past 1440 when a stretch crosses it, negative for
///     the tail of the previous night), breaks already carved out, and an EMPTY list means the
///     business is shut that day. The caller filters by them, and only by them;
///   * `source: "unset"` — the authority carries no rule reaching the date, so the gate refuses
///     nothing and every calendar hour is bookable. `spans` is empty and the caller must NOT
///     filter by it, or a hub with no hours would see its whole day disappear from a screen the
///     door would have accepted. It was called `own` until appointments#118, when the module's
///     own timetable — the thing that used to answer here — was retired; nothing answers now, and
///     the name says so.
///
/// Read-only: it returns a `result` and never an operation. Missing read = refusal, never an open
/// door — a screen that quietly stops filtering because a read went missing is the optimistic
/// list all over again.
pub fn day_opening_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let Some(at) = wall_stamp_of_date(&str_or(&payload, "date", "")) else {
        return Ok(Output::new().with_error(DomainError::new(
            "appointments.invalid_start",
            "That date could not be read; the expected shape is YYYY-MM-DD.",
        )));
    };

    let opening = match schedules_opening(&input, &at) {
        Ok(opening) => opening,
        Err(refusal) => return Ok(Output::new().with_error(refusal)),
    };

    let (source, spans) = match opening {
        None => ("unset", Vec::new()),
        Some(DayOpening::Closed) => ("schedules", Vec::new()),
        Some(DayOpening::Open(spans)) => (
            "schedules",
            spans
                .iter()
                .map(|s| json!({ "start_minute": s.start, "end_minute": s.end }))
                .collect(),
        ),
    };
    Ok(Output::new().with_result(json!({ "source": source, "spans": spans })))
}

/// The engine's own rules, answered by `queries/availability_check.sql` (appointments#122).
const OWN_RULES_READ: &str = "appointments.availability.own_rules";

/// The refusals the gate ranks BELOW the opening hours, in `prepare_appointment`'s order:
/// lead time → **hours** → blocked → overlap. A slot the SQL refuses for one of these and
/// that is ALSO shut comes back `outside_schedule`, because that is the word the door would answer.
///
/// Stated as the list BELOW and not the list above on purpose. A reason this list has never heard
/// of keeps its own word, so a verdict added to the SQL tomorrow can only ever be reported as
/// itself — never silently overwritten by the hours. The list is pinned against the SQL's own
/// `CASE ... END AS reason` by `tests/availability_rules.contract.test.py`, so «never heard of» is
/// a red test and not a quiet drift.
const RANKED_BELOW_THE_HOURS: [&str; 2] = ["blocked", "overlap"];

/// Is this slot free? — the engine, answering the SAME hours the door enforces (appointments#122).
///
/// **What was wrong.** «Is Tuesday at 8 free?» came back FREE from a salon that opens at nine, and
/// the caller only found out at `create`, one click later. `queries/availability_check.sql`
/// computed `outside_schedule` from this module's OWN timetable until appointments#117/#118
/// retired it; with the hours in `schedules` (ADR-0392) that verdict simply stopped being emitted,
/// and a query of this module may only name this module's tables — so no amount of SQL can bring
/// it back. The screen papered over it by asking [`day_opening_pure`] separately and filtering
/// itself (appointments#105); the assistant, a flow, an integration and the public API read
/// `available` and believed it.
///
/// **Why it answers here.** This is the only place that can see both halves. The SQL keeps every
/// verdict built on tables this module owns — the booking notice, the blocked periods, the
/// appointments already on the books — and arrives as an
/// authoritative read; the hours come from `schedules` through [`schedule_refusal`], the very
/// function `create` and `reschedule` run. There is no second implementation of ADR-0392's
/// precedence to drift, which is what
/// `check_and_the_door_agree_on_the_hours_hour_by_hour` pins for good.
///
/// **The order is the door's.** A slot that is both too soon and shut is `too_soon`, because
/// `lead_time_refusal` runs before `schedule_refusal`; a slot that is both blocked and shut is
/// `outside_schedule`, because the hours run before the blocked time. The engine ranking the same
/// refusals differently from the door is the screen contradicting the door all over again.
///
/// Read-only: it returns a `result` and never an operation. A read that did not arrive is a
/// refusal and never an open door — the manifest declares them `required`, and an engine that
/// shrugs when its input is missing is the optimistic answer this issue is about.
pub fn check_availability_pure(input: Value) -> Result<Output, String> {
    let payload = payload_of(&input);

    let Some(row) = read_rows(&input, OWN_RULES_READ).and_then(|rows| rows.first()) else {
        return Ok(Output::new().with_error(availability_unavailable()));
    };
    let available = row.get("available").map(|v| as_i64(v, 0)).unwrap_or(0);
    let reason = row.get("reason").map(as_str).unwrap_or_default();

    // Refused for something the door decides BEFORE it looks at the clock on the wall: that word
    // stands, and the hours are not even asked.
    if available == 0 && !RANKED_BELOW_THE_HOURS.contains(&reason.as_str()) {
        return Ok(verdict(0, &reason));
    }

    let Some(settings) = settings_read(&input) else {
        return Ok(Output::new().with_error(availability_unavailable()));
    };
    let duration = payload
        .get("duration_minutes")
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1)
        .unwrap_or_else(|| default_duration_of(&settings));
    let Some(start) = parse_dt(&str_or(&payload, "start_datetime", "")) else {
        // The instant could not be read here, so the hours cannot be judged at all. Answering the
        // SQL's verdict would be answering «free» about an hour nobody checked.
        return Ok(Output::new().with_error(DomainError::new(
            "appointments.availability_unavailable",
            "That time could not be read on the business clock.",
        )));
    };
    let end = start.add_minutes(duration);

    match schedule_refusal(&input, business_tz(&input), &start, &end) {
        Some(refusal) if refusal.code == "appointments.outside_schedule" => {
            return Ok(verdict(0, "outside_schedule"));
        }
        // The hours themselves could not be resolved (a `schedules` read missing, an unreadable
        // instant). That is a failure, not a free slot.
        Some(refusal) => return Ok(Output::new().with_error(refusal)),
        None => {}
    }

    // appointments#98: the professional's hours, in the rank the door gives them. Asked about the
    // whole agenda (no professional), there is nobody's day to judge.
    if !str_or(&payload, "staff_id", "").trim().is_empty() {
        match staff_hours_refusal(&input, business_tz(&input), &start, &end) {
            Some(refusal) if refusal.code == OUTSIDE_STAFF_HOURS => {
                return Ok(verdict(0, "outside_staff_hours"));
            }
            Some(refusal) => return Ok(Output::new().with_error(refusal)),
            None => {}
        }
    }
    Ok(verdict(available, &reason))
}

/// The engine's answer, in the shape the caller reads: `available` 0/1 and the first `reason` that
/// failed — the very pair `queries/availability_check.sql` has always returned.
fn verdict(available: i64, reason: &str) -> Output {
    Output::new().with_result(json!({ "available": available, "reason": reason }))
}

/// The day's free slots as `queries/availability_slots.sql` answers them — the half this module
/// owns (appointments#127).
const OWN_SLOTS_READ: &str = "appointments.availability.own_slots";

/// Does the whole slot fit inside ONE open stretch? `None` when the row cannot be read at all.
///
/// Whole, not overlapping: a booking that starts before closing and runs past it is refused by the
/// door, so offering it would be the same contradiction on the other edge. The units are the ones
/// [`schedules_opening`] answers in — minutes from the date's own midnight — and the row carries
/// them as the `HH:MM` pair the caller reads, which is what keeps this comparison free of any
/// second reading of the clock.
fn slot_inside(row: &Value, spans: &[Span]) -> Option<bool> {
    let start = wall_minutes(&as_str(row.get("start_time")?))?;
    let end = wall_minutes(&as_str(row.get("end_time")?))?;
    Some(spans.iter().any(|s| s.start <= start && end <= s.end))
}

/// The list's answer, in the very envelope the caller already reads (appointments#127).
///
/// `slots` was a Tier-0 query until this issue, and the runtime hands an unpaginated query back as
/// `{rows, total, limit, offset}` (`crates/runtime/src/queries.rs::QueryPage`). Answering the same
/// shape from the handler is what makes this a fix and not a migration: nobody who calls it has to
/// learn a new envelope to stop being lied to. `total` counts what the caller ACTUALLY gets, so a
/// pager built on it cannot promise hours the business is shut for.
fn slot_page(rows: Vec<Value>) -> Output {
    let total = rows.len();
    Output::new().with_result(json!({
        "rows": rows,
        "total": total,
        "limit": total,
        "offset": 0,
    }))
}

/// What slots are free that day? — the list, answering the SAME hours the door enforces
/// (appointments#127).
///
/// **What was wrong.** «What have I got on Sunday?» came back with the whole calendar day of a
/// salon that does not open on Sundays; so did the hour before opening and the lunch break. This
/// is the question of appointments#122 asked in bulk, and it is the one that gets asked most:
/// `queries/availability_slots.sql` generates the candidates of the settings' calendar window and
/// discounts the booking notice, the blocked time and the appointments — every verdict
/// built on tables THIS module owns — and knows nothing about the opening hours. It cannot: they
/// belong to `schedules` (ADR-0392) and a query of a module may only name its own module's
/// tables. The booking screen papered over it by asking [`day_opening_pure`] separately and
/// filtering itself (appointments#105), which is the screen's patch and not the engine's answer —
/// the assistant, a flow, an integration and the public API read the list and believed it.
///
/// **Why it answers here.** Same reason as [`check_availability_pure`], and through the same
/// door: the SQL half arrives as an authoritative read and the hours come from
/// [`schedules_opening`], the very function `create` and `reschedule` run. There is no second
/// implementation of ADR-0392's precedence to drift, which is what
/// `slots_offers_exactly_what_the_door_accepts` pins for good.
///
/// **Silence is not a shut day.** `source: unset` — the authority carrying no rule that reaches
/// the date — means the gate refuses nothing there, so the list is handed back WHOLE. Filtering by
/// an empty answer would erase a day the door would have accepted, which is the optimistic list in
/// reverse: a hub that has not configured its hours yet losing its agenda without being told why.
///
/// Read-only: it returns a `result` and never an operation. A read that did not arrive is a
/// refusal and never an open door.
pub fn available_slots_pure(input: Value) -> Result<Output, String> {
    let payload = payload_of(&input);
    let Some(at) = wall_stamp_of_date(&str_or(&payload, "date", "")) else {
        return Ok(Output::new().with_error(DomainError::new(
            "appointments.invalid_start",
            "That date could not be read; the expected shape is YYYY-MM-DD.",
        )));
    };
    let Some(rows) = read_rows(&input, OWN_SLOTS_READ) else {
        return Ok(Output::new().with_error(availability_unavailable()));
    };

    let opening = match schedules_opening(&input, &at) {
        Ok(opening) => opening,
        Err(refusal) => return Ok(Output::new().with_error(refusal)),
    };
    let spans = match opening {
        // The authority is silent about the date: nothing to filter by, and filtering by nothing
        // would empty a day the door books.
        None => return Ok(slot_page(rows.clone())),
        Some(DayOpening::Closed) => Vec::new(),
        Some(DayOpening::Open(spans)) => spans,
    };

    let mut kept = Vec::with_capacity(rows.len());
    for row in rows {
        // A row OUR OWN SQL returned in a shape nobody can judge is a fault, not a slot to drop
        // quietly: a shorter list would hide a broken read behind an answer that looks fine.
        let Some(inside) = slot_inside(row, &spans) else {
            return Ok(Output::new().with_error(availability_unavailable()));
        };
        if inside {
            kept.push(row.clone());
        }
    }
    Ok(slot_page(kept))
}


/// Double booking: the professional already has an appointment across this slot.
///
/// appointments#70 — this is the most frequent refusal of the whole module and, until that issue,
/// the ONLY one without a stable code: it left `create` as `Err("overlap: …")`, which made every
/// consumer sniff the prefix to name it (the WhatsApp listener of appointments#38 did exactly
/// that) and made a rewrite of this `format!` silently change the error the inbox displays.
///
/// The authoritative gate does NOT move: it stays in the SQL of the command's own transaction
/// (`_appointment_overlap_assert`, appointments#20), because a handler decides from a read and the
/// race only closes server-side. This is the pre-check in front of it — and a pre-check that
/// refuses is a refusal like any other, not a fault.
fn overlap_refusal(c: &Candidate) -> DomainError {
    DomainError::new(
        "appointments.overlapping_appointment",
        &format!(
            "That professional already has an appointment in that slot: {} ({} – {}).",
            c.label,
            c.start.iso(),
            c.end.iso()
        ),
    )
}

// ───────────────────────────── the resolved booking (appointments#11) ─────────────────────────────

/// The three links of a booking, RESOLVED against the hub's own records — the snapshot that is
/// frozen into the appointment row. Built by [`resolve_booking`] from the reads the runtime
/// pre-loads for `create` (ADR-0069): `customers.get`, `services.services.get`,
/// `staff.members.get` and `staff.services.eligible_for_service`. Nothing in here comes from
/// the payload except the ids that selected the rows.
#[derive(Debug, Clone, PartialEq)]
struct ResolvedBooking {
    customer_id: String,
    customer_name: String,
    customer_phone: String,
    customer_email: String,
    service_id: String,
    service_name: String,
    /// Cents (ADR-0007). The per-professional `custom_price` wins over the catalogue price.
    service_price: i64,
    /// Minutes, when the catalogue (or the professional's override) declares one.
    service_duration: Option<i64>,
    staff_id: String,
    staff_name: String,
}

/// One pre-loaded read as rows. `None` = the runtime did NOT deliver it (key absent), which for
/// the catalogue reads is a refusal, never a fallback (sales#68 named that hole).
fn read_rows<'a>(input: &'a Value, query: &str) -> Option<&'a Vec<Value>> {
    input
        .get("context")
        .and_then(|c| c.get("reads"))
        .and_then(|r| r.get(query))
        .and_then(|v| v.as_array())
}

/// Resolves the customer, the service and the professional of `item` against the authoritative
/// reads. `Ok(Err(refusal))` is a domain refusal (the runtime writes nothing and the UI
/// translates the code); `Err(_)` is a caller/host bug.
///
/// Rules (market: Fresha / Square Appointments / Vagaro, staff#9):
/// - the three ids must resolve **in this hub** (the reads are hub-scoped) → `*_not_found`;
/// - the service must be active and bookable → `service_not_bookable`;
/// - the professional must be `active` and `is_bookable` → `staff_not_bookable`;
/// - when the service HAS declared competencies, the professional must be one of them
///   (`staff_not_eligible`); when it has none, the hub has not narrowed it (every team member
///   performs every service until told otherwise) and any bookable member is accepted;
/// - price/duration: the professional's override, else the catalogue.
fn resolve_booking(
    input: &Value,
    item: &Value,
) -> Result<Result<ResolvedBooking, DomainError>, String> {
    let (Some(customers), Some(services), Some(members), Some(eligible)) = (
        read_rows(input, "customers.get"),
        read_rows(input, "services.services.get"),
        read_rows(input, "staff.members.get"),
        read_rows(input, "staff.services.eligible_for_service"),
    ) else {
        return Ok(Err(DomainError::new(
            "appointments.catalog_unavailable",
            "The customer, service or staff catalogue could not be read; the appointment was not booked.",
        )));
    };

    let customer_id = str_or(item, "customer_id", "");
    let service_id = str_or(item, "service_id", "");
    let staff_id = str_or(item, "staff_id", "");
    if customer_id.is_empty() || service_id.is_empty() || staff_id.is_empty() {
        return Err(
            "invalid_payload: customer_id, service_id and staff_id are required".to_string(),
        );
    }

    let same_id =
        |row: &&Value, key: &str, id: &str| as_str(row.get(key).unwrap_or(&Value::Null)) == id;

    let Some(customer) = customers.iter().find(|r| same_id(r, "id", &customer_id)) else {
        return Ok(Err(DomainError::new(
            "appointments.customer_not_found",
            "That customer does not exist in this business.",
        )));
    };
    let Some(service) = services.iter().find(|r| same_id(r, "id", &service_id)) else {
        return Ok(Err(DomainError::new(
            "appointments.service_not_found",
            "That service does not exist in this business.",
        )));
    };
    let service_active = service.get("is_active").map(as_bool).unwrap_or(true);
    let service_bookable = service.get("is_bookable").map(as_bool).unwrap_or(true);
    if !service_active || !service_bookable {
        return Ok(Err(DomainError::new(
            "appointments.service_not_bookable",
            "That service cannot be booked: it is inactive or not bookable.",
        )));
    }
    let Some(member) = members.iter().find(|r| same_id(r, "id", &staff_id)) else {
        return Ok(Err(DomainError::new(
            "appointments.staff_not_found",
            "That professional does not exist in this business.",
        )));
    };
    let member_active = str_or(member, "status", "active") == "active";
    let member_bookable = member.get("is_bookable").map(as_bool).unwrap_or(true);
    if !member_active || !member_bookable {
        return Ok(Err(DomainError::new(
            "appointments.staff_not_bookable",
            "That professional cannot take appointments: inactive or not bookable.",
        )));
    }
    let competency = eligible.iter().find(|r| same_id(r, "staff_id", &staff_id));
    if !eligible.is_empty() && competency.is_none() {
        return Ok(Err(DomainError::new(
            "appointments.staff_not_eligible",
            "That professional does not perform this service.",
        )));
    }

    let override_price = competency
        .and_then(|c| c.get("custom_price"))
        .filter(|v| !v.is_null())
        .map(|v| money::from_json(v, 0));
    let override_duration = competency
        .and_then(|c| c.get("custom_duration"))
        .filter(|v| !v.is_null())
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1);
    let service_duration = service
        .get("duration_minutes")
        .filter(|v| !v.is_null())
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1);
    let staff_name = {
        let full = str_or(member, "full_name", "");
        if full.is_empty() {
            format!(
                "{} {}",
                str_or(member, "first_name", ""),
                str_or(member, "last_name", "")
            )
            .trim()
            .to_string()
        } else {
            full
        }
    };

    Ok(Ok(ResolvedBooking {
        customer_id,
        customer_name: str_or(customer, "name", ""),
        customer_phone: str_or(customer, "phone", ""),
        customer_email: str_or(customer, "email", ""),
        service_id,
        service_name: str_or(service, "name", ""),
        service_price: override_price
            .unwrap_or_else(|| money::from_json(service.get("price").unwrap_or(&Value::Null), 0)),
        service_duration: override_duration.or(service_duration),
        staff_id,
        staff_name,
    }))
}

// ───────────────────────────── núcleo: una cita → intenciones ─────────────────────────────

/// Why one appointment could not be prepared.
///
/// The two are not the same answer and never were: a **domain refusal** is the hub saying no (that
/// slot is blocked, it is too soon) and travels to the UI as a stable code it translates, while an
/// **invalid** item is a caller/data problem the batch reports by index. Splitting them is what
/// lets `create` refuse, `bulk_create` refuse the whole batch and `recurring.materialize` skip the
/// occurrence — from ONE implementation of the rules instead of three.
enum PrepareError {
    Domain(DomainError),
    Invalid(String),
}

/// Which series an appointment belongs to, and which of its occurrences it is (appointments#15).
///
/// `occurrence_date` is the WALL date the template generated (`YYYY-MM-DD`), not the instant: it is
/// the natural key of the occurrence, and the one that makes a retry idempotent — the same day of
/// the same series can only be on the books once (partial unique index, migration 005).
struct SeriesStamp {
    recurring_id: String,
    occurrence_date: String,
}

impl From<PrepareError> for String {
    fn from(e: PrepareError) -> String {
        match e {
            PrepareError::Domain(d) => format!("{}: {}", d.code, d.message),
            PrepareError::Invalid(s) => s,
        }
    }
}

/// What the COUNTER screen declares about the booking it sends — and only it can: every other
/// door (an approval from the inbox, a batch, a series occurrence, the customer channel of
/// `reschedule`) passes [`CounterDeclaration::NONE`].
#[derive(Clone, Copy)]
struct CounterDeclaration {
    /// appointments#155: the start has already begun (the walk-in in the chair).
    past: bool,
    /// appointments#157: book inside `min_booking_notice`, which is the customer's window.
    short_notice: bool,
}

impl CounterDeclaration {
    const NONE: Self = Self {
        past: false,
        short_notice: false,
    };

    /// What the payload declares, if a PERSON of the team is calling (appointments#177). A flow,
    /// an integration behind an API key, a scheduled task or a listener run by the outbox relay
    /// has nobody in front of the agenda who saw the warning, so it keeps both walls whatever its
    /// payload says.
    fn from_request(input: &Value, payload: &Value) -> Self {
        if !Self::a_person_is_calling(input.get("context").unwrap_or(&Value::Null)) {
            return Self::NONE;
        }
        Self {
            past: as_bool(payload.get("allow_past").unwrap_or(&Value::Null)),
            short_notice: as_bool(payload.get("allow_short_notice").unwrap_or(&Value::Null)),
        }
    }

    /// appointments#180: the hub TELLS who is calling in `context.principal` (hub#2113), and it is
    /// an allow-list — only `human` is a person, so a kind of caller the hub grows tomorrow is out
    /// by default. A hub older than that field sends none: then, and only then, the shape of
    /// `current_user_id` decides, as it did in #177.
    fn a_person_is_calling(context: &Value) -> bool {
        match context.get("principal") {
            Some(Value::Null) | None => {
                let caller = as_str(context.get("current_user_id").unwrap_or(&Value::Null));
                !AUTOMATION_CALLERS.iter().any(|p| caller.starts_with(p))
            }
            Some(principal) => principal.as_str() == Some("human"),
        }
    }
}

/// The `current_user_id` prefixes an older hub (without `context.principal`) gives a caller that
/// is not a person: a flow run (ADR-0283) and a hub API key.
const AUTOMATION_CALLERS: [&str; 2] = ["flow:", "apikey:"];

/// Valida un ítem de cita y devuelve sus 3 intenciones (`_bump_counter` +
/// `_insert_appointment` + `_insert_history`). Añade la cita aceptada a
/// `candidates` para que el solape también se valide dentro del lote.
///
/// `resolved` (appointments#11) is the booking resolved against the hub's records: the
/// customer/service/staff snapshot, the price and the default duration come from it and whatever
/// names or prices the item carries are ignored. Since appointments#54 there is no unresolved
/// path: `create`, `bulk_create` and `recurring.materialize` all arrive here with the same
/// authoritative snapshot, so the caller cannot name a customer, a service or a price anywhere.
///
/// Since appointments#10 the AVAILABILITY rules live here too — minimum notice, maximum advance
/// and blocked agenda, all decided from `settings` and the blocked-times read BEFORE anything is
/// written. They used to sit in `create` alone, so a batch or a series could book on a holiday
/// that `create` refused one call earlier.
#[allow(clippy::too_many_arguments)]
fn prepare_appointment(
    input: &Value,
    item: &Value,
    resolved: &ResolvedBooking,
    settings: &Value,
    candidates: &mut Vec<Candidate>,
    now: &Dt,
    appointment_id: &str,
    history_description: &str,
    series: Option<&SeriesStamp>,
    counter: CounterDeclaration,
    staff_hours: StaffHoursGate,
) -> Result<Vec<Operation>, PrepareError> {
    let customer_name = resolved.customer_name.clone();
    if customer_name.is_empty() {
        return Err(PrepareError::Invalid(
            "invalid_payload: customer_name es obligatorio".to_string(),
        ));
    }

    // appointments#79: a `Domain` error, not an `Invalid` one. `Invalid` is re-raised as a raw
    // `Err` by `create`, which the host turns into «error de handler
    // WASM: …» — the plumbing on screen instead of a code. The two callers that report per item
    // keep behaving as they should: `bulk_create` stops the batch, exactly as it already does for
    // `blocked` / `too_soon`, and `materialize` skips the occurrence and carries on with the
    // series.
    let raw_start = as_str(item.get("start_datetime").unwrap_or(&Value::Null));
    let Some(start) = parse_dt(&raw_start) else {
        return Err(PrepareError::Domain(DomainError::new(
            "appointments.invalid_start",
            "That start date and time is not a valid instant.",
        )));
    };
    // appointments#155: the past is a DECLARATION, not a wall. A salon writes down the walk-in
    // who is already in the chair, and the start the receptionist picked is a minute old by the
    // time the form is filled — the most ordinary booking of the counter was the one refused.
    // Mindbody/Booker ships the switch by name («Allow Appointments in the Past»); Acuity lets an
    // admin pick a slot outside availability with a WARNING that «doesn't prevent you from
    // scheduling the appointment». Where it stays blocked (Calendly, GoHighLevel) it is the
    // standing complaint. So `allow_past` opens it — and ONLY for the caller that sets it, which
    // is the counter screen, the one place with a person who saw the warning. Every other door
    // (an approval from the inbox, a batch, a series occurrence) reaches here with `false`.
    let starts_in_past = cmp_secs(&start, now) < 0;
    if starts_in_past && !counter.past {
        return Err(PrepareError::Domain(DomainError::new(
            "appointments.invalid_start",
            "An appointment cannot start in the past.",
        )));
    }

    // Duration: the caller's explicit choice (the receptionist may shorten/lengthen a booking),
    // else the professional's override / the service's catalogue duration, else the module default.
    let catalogue_dur = resolved
        .service_duration
        .unwrap_or_else(|| default_duration_of(settings));
    let duration = item
        .get("duration_minutes")
        .map(|v| as_i64(v, catalogue_dur))
        .filter(|d| *d >= 1)
        .unwrap_or(catalogue_dur);
    let end = start.add_minutes(duration);

    // The booking window is measured from `now` FORWARD, so it has nothing to say about a start
    // that already happened: `min_booking_notice` defaults to 60 in the schema, and applying it
    // here would answer `too_soon` to every backdated walk-in — the same shut door under a
    // different code (appointments#155). A start still to come is judged as always, declared or
    // not by `allow_past`: that declaration excuses the past, never the window.
    //
    // appointments#157: the window itself is the CUSTOMER's. The notice keeps an online booking
    // from landing at 10:58 for 11:00 with nobody looking; the receptionist booking «half an hour
    // from now» IS the person looking. Fresha and Booksy file the minimum lead time under online
    // booking, Square and Mindbody scope it to the client channel, Acuity's admin booking skips
    // it. So the counter's own `allow_short_notice` excuses the MINIMUM notice — only that: the
    // maximum advance, the hours, the blocked time and the overlap still judge its booking.
    if !starts_in_past {
        if let Some(refusal) = lead_time_refusal(settings, &start, now, counter.short_notice) {
            return Err(PrepareError::Domain(refusal));
        }
    }
    // appointments#89: opening hours before blocked time, the same order `availability_check.sql`
    // reports its `reason` in — the screen and the door must not rank the same refusals differently.
    if let Some(refusal) = schedule_refusal(input, business_tz(input), &start, &end) {
        return Err(PrepareError::Domain(refusal));
    }
    // appointments#98: the professional's hours, right below the business's — the same rank
    // `availability.check` gives them.
    if staff_hours == StaffHoursGate::Enforce {
        if let Some(refusal) = staff_hours_refusal(input, business_tz(input), &start, &end) {
            return Err(PrepareError::Domain(refusal));
        }
    }

    if let Some(refusal) = blocked_refusal(input, &resolved.staff_id, &start, &end) {
        return Err(PrepareError::Domain(refusal));
    }

    if !allow_overlapping_of(settings) {
        if let Some(c) = candidates
            .iter()
            .find(|c| cmp_secs(&c.start, &end) < 0 && cmp_secs(&c.end, &start) > 0)
        {
            return Err(PrepareError::Domain(overlap_refusal(c)));
        }
    }

    // Service snapshot (appointments#11): the catalogue row decides name and price — in CENTS
    // (ADR-0007) — and anything the item says about them is ignored.
    let (service_name, service_price) = (resolved.service_name.clone(), resolved.service_price);

    // appointments#12: the counter's day is the SALON's day (`context.timezone`, hub#1022), not
    // UTC's. Read from `input` and not passed down as an argument on purpose — every caller of
    // this function already hands over the whole guest input, and one more parameter that four
    // call sites must remember to forward is one more place to forget it.
    let day = business_day_key(now, business_tz(input));
    // appointments#136: the status the row is BORN with. Everything below writes THIS and not the
    // literal `pending` that used to be spelled out twice — the row and its history line have to
    // agree, and two literals is how they stop agreeing.
    let status = if born_confirmed(item, settings) {
        "confirmed"
    } else {
        "pending"
    };
    let mut ops: Vec<Operation> = Vec::with_capacity(4);

    let mut bump = Map::new();
    bump.insert("day".into(), json!(day));
    ops.push(Operation::sql("appointments._bump_counter", bump));

    let mut p = Map::new();
    p.insert("appointment_id".into(), json!(appointment_id));
    p.insert("day".into(), json!(day));
    p.insert("customer_id".into(), json!(resolved.customer_id));
    p.insert("customer_name".into(), json!(customer_name.clone()));
    p.insert("customer_phone".into(), json!(resolved.customer_phone));
    p.insert("customer_email".into(), json!(resolved.customer_email));
    p.insert("staff_id".into(), json!(resolved.staff_id));
    p.insert("staff_name".into(), json!(resolved.staff_name));
    p.insert("service_id".into(), json!(resolved.service_id));
    // appointments#15: an occurrence knows which series it belongs to and WHICH occurrence it is.
    // Both are NULL for a booking that is not part of a series; the unique index is partial, so
    // the nulls cost nothing.
    p.insert(
        "recurring_id".into(),
        series.map(|s| json!(s.recurring_id)).unwrap_or(Value::Null),
    );
    p.insert(
        "occurrence_date".into(),
        series
            .map(|s| json!(s.occurrence_date))
            .unwrap_or(Value::Null),
    );
    p.insert("service_name".into(), json!(service_name.clone()));
    p.insert("service_price".into(), json!(service_price));
    p.insert("start_datetime".into(), json!(start.iso()));
    p.insert("end_datetime".into(), json!(end.iso()));
    p.insert("duration_minutes".into(), json!(duration));
    p.insert("status".into(), json!(status));
    p.insert("notes".into(), json!(str_or(item, "notes", "")));
    p.insert(
        "internal_notes".into(),
        json!(str_or(item, "internal_notes", "")),
    );
    p.insert(
        "booked_online".into(),
        json!(item.get("booked_online").map(as_bool).unwrap_or(false) as i64),
    );
    ops.push(Operation::sql("appointments._insert_appointment", p));

    let new_value = json!({
        "customer_name": customer_name,
        "service_name": service_name,
        "start_datetime": start.iso(),
        "end_datetime": end.iso(),
        "duration_minutes": duration,
        "status": status,
    })
    .to_string();
    let mut h = Map::new();
    h.insert("appointment_id".into(), json!(appointment_id));
    h.insert("action".into(), json!("created"));
    h.insert("description".into(), json!(history_description));
    h.insert("old_value".into(), Value::Null);
    h.insert("new_value".into(), json!(new_value));
    ops.push(Operation::sql("appointments._insert_history", h));

    // appointments#136: a booking born confirmed leaves the SAME trail as one somebody confirmed
    // by hand, so the audit trail does not give away where the appointment came from. `old_value`
    // is NULL and not `{"status":"pending"}` — the row was never pending, and `_history_confirm.sql`
    // (which does say that, correctly, because it runs behind an UPDATE off `pending`) would be
    // inventing a transition that did not happen.
    if status == "confirmed" {
        let mut c = Map::new();
        c.insert("appointment_id".into(), json!(appointment_id));
        c.insert("action".into(), json!("confirmed"));
        c.insert(
            "description".into(),
            json!("Appointment confirmed automatically when it was booked"),
        );
        c.insert("old_value".into(), Value::Null);
        c.insert(
            "new_value".into(),
            json!(json!({ "status": "confirmed" }).to_string()),
        );
        ops.push(Operation::sql("appointments._insert_history", c));
    }

    candidates.push(Candidate {
        start,
        end,
        label: format!("(nueva {})", start.iso()),
    });
    Ok(ops)
}

/// `appointments.appointment.created`, built from the row the booking is about to write
/// (appointments#174).
///
/// Every door that books — one by one, a batch, a recurring series — announces the appointment
/// with THIS payload, read off its own `_insert_appointment` operation, so the event can never
/// say something the row does not. The id travels as `appointment_id` like in every other event
/// of the module, and also as `new_id`, the name the one-by-one booking carried while it was
/// emitted declaratively, so an automation built on it keeps working. Contact details and internal notes stay out of the outbox on purpose — a listener that
/// needs them reads the appointment.
fn appointment_created(ops: &[Operation]) -> Option<erplora_guest_sdk::Event> {
    let row = &ops
        .iter()
        .find(|op| op.command == "appointments._insert_appointment")?
        .params;
    let field = |k: &str| row.get(k).cloned().unwrap_or(Value::Null);
    Some(erplora_guest_sdk::Event::new(
        "appointments.appointment.created",
        json!({
            "appointment_id": field("appointment_id"),
            "new_id": field("appointment_id"),
            "customer_id": field("customer_id"),
            "customer_name": field("customer_name"),
            "service_id": field("service_id"),
            "service_name": field("service_name"),
            "service_price": field("service_price"),
            "staff_id": field("staff_id"),
            "staff_name": field("staff_name"),
            "start_datetime": field("start_datetime"),
            "end_datetime": field("end_datetime"),
            "duration_minutes": field("duration_minutes"),
            "status": field("status"),
            "notes": field("notes"),
            "booked_online": json!(row.get("booked_online").map(as_bool).unwrap_or(false)),
            "recurring_id": field("recurring_id"),
        }),
    ))
}

// ───────────────────────────── funciones puras por command ─────────────────────────────

/// Who is asking (appointments#6 for `cancel`, appointments#142 for `reschedule`). `staff` =
/// someone operating the hub (the default: the agenda screen never sends a channel); `customer`
/// = the client herself through an external channel (online booking, a flow acting on her
/// behalf).
#[derive(Clone, Copy, PartialEq, Debug)]
enum CallerChannel {
    Staff,
    Customer,
}

impl CallerChannel {
    /// The value the history lines store as `channel` (`staff` | `customer`).
    fn label(self) -> &'static str {
        match self {
            CallerChannel::Staff => "staff",
            CallerChannel::Customer => "customer",
        }
    }
}

/// The refusal an operation gets when the appointment does not belong to the customer asking for
/// it (appointments#140 for `cancel`, appointments#142 for `reschedule`).
const CUSTOMER_MISMATCH: &str = "appointments.customer_mismatch";

fn caller_channel(payload: &Value) -> Result<CallerChannel, String> {
    match payload.get("channel").map(as_str).as_deref() {
        None | Some("") | Some("staff") => Ok(CallerChannel::Staff),
        Some("customer") => Ok(CallerChannel::Customer),
        Some(other) => Err(format!(
            "invalid_payload: channel `{other}` is not one of staff|customer"
        )),
    }
}

/// WHOSE appointment is it? The gate `cancel` grew in appointments#140 and `reschedule` reuses
/// unchanged in appointments#142 — one rule, one code, one place: two copies of «is this yours»
/// is how one of them ends up drifting open again.
///
/// `Ok(None)` = the caller may go on; `Ok(Some(refusal))` = the appointment is somebody else's;
/// `Err` = the payload itself is broken. It is asked BEFORE the state and the business policy, so
/// a caller holding an id that is not theirs always gets the same answer — «not yours» — instead
/// of a refusal that tells them whether that id exists, what state it is in and when it starts.
fn customer_identity_refusal(
    channel: CallerChannel,
    payload: &Value,
    row: &Value,
) -> Result<Option<Output>, String> {
    // Only the customer channel is bound: the staff channel is the receptionist, who owns the
    // whole agenda and never acts on anyone else's behalf. A `customer_id` she happens to send is
    // not an identity claim — reading it as one would let a mistyped id refuse her own work.
    if channel != CallerChannel::Customer {
        return Ok(None);
    }
    let asking = str_or(payload, "customer_id", "");
    if asking.is_empty() {
        // A payload contract bug, not a business refusal — the same treatment as a missing
        // `appointment_id`. A `channel: customer` that names nobody proves nothing, so it fails
        // closed and LOUDLY: an external channel wired without the customer must be fixed, not
        // answered with a sentence the customer is told to act on.
        return Err(
            "invalid_payload: customer_id is required when channel is `customer`".to_string(),
        );
    }
    // `row.customer_id` is the appointment's own link, from the authoritative read — never from
    // the payload. Empty (a walk-in the counter typed with no customer attached) matches nobody:
    // `asking` is non-empty by the check above.
    if as_str(row.get("customer_id").unwrap_or(&Value::Null)) != asking {
        return Ok(Some(refuse(
            CUSTOMER_MISMATCH,
            "This appointment belongs to a different customer, so it cannot be managed on their behalf.",
        )));
    }
    Ok(None)
}

/// The appointment row the runtime pre-loaded via `reads` (`appointments.appointments.get`,
/// filtered by `payload.appointment_id`). `None` when the read is missing or empty.
fn appointment_row(input: &Value) -> Option<Value> {
    input
        .get("context")
        .and_then(|c| c.get("reads"))
        .and_then(|r| r.get("appointments.appointments.get"))
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first().cloned())
}

fn refuse(code: &str, message: &str) -> Output {
    Output::new().with_error(DomainError::new(code, message))
}

/// `appointments.appointments.cancel` (appointments#6) — the cancellation policy, decided by
/// the market (Fresha / Vagaro / Square Appointments): **staff can always cancel**, whatever the
/// notice; the **customer channel** is bound by `allow_customer_cancellation` and
/// `cancellation_notice_hours` of the settings row. No-show is a separate explicit staff action
/// (`appointments.appointments.no_show`), never an outcome of this command.
///
/// Both reads are authoritative (`required` in the manifest): the appointment row (state guard
/// + start) and the settings singleton (policy). Rejections are domain errors (hub#139) — the
/// runtime persists nothing and the UI translates the code.
pub fn cancel_appointment_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let channel = caller_channel(&payload)?;
    let appointment_id = str_or(&payload, "appointment_id", "");
    if appointment_id.is_empty() {
        return Err("invalid_payload: appointment_id is required".to_string());
    }

    // State guard (was `expect_rows` on the declarative command): terminal states stay put.
    let Some(row) = appointment_row(&input) else {
        return Ok(refuse(
            "appointments.cannot_cancel",
            "This appointment can no longer be cancelled in its current state.",
        ));
    };
    // appointments#140: WHOSE appointment is it? Decided BEFORE the state and the policy.
    if let Some(refusal) = customer_identity_refusal(channel, &payload, &row)? {
        return Ok(refusal);
    }

    let status = as_str(row.get("status").unwrap_or(&Value::Null));
    if status == "cancelled" || status == "completed" {
        return Ok(refuse(
            "appointments.cannot_cancel",
            "This appointment can no longer be cancelled in its current state.",
        ));
    }

    if channel == CallerChannel::Customer {
        let settings = settings_from(&input);
        let allowed = settings
            .get("allow_customer_cancellation")
            .map(as_bool)
            .unwrap_or(true);
        if !allowed {
            return Ok(refuse(
                "appointments.customer_cancellation_disabled",
                "Online cancellation is not available; please contact the business.",
            ));
        }
        let notice_hours = settings
            .get("cancellation_notice_hours")
            .map(|v| as_i64(v, 24))
            .filter(|h| *h >= 0)
            .unwrap_or(24);
        let raw_start = as_str(row.get("start_datetime").unwrap_or(&Value::Null));
        let start = parse_dt(&raw_start).ok_or_else(|| {
            format!("invalid_state: appointment start `{raw_start}` is not ISO 8601")
        })?;
        if cmp_secs(&start, &ctx.now) < notice_hours * 3_600 {
            return Ok(refuse(
                "appointments.cancellation_notice_required",
                &format!(
                    "This appointment can only be cancelled online at least {notice_hours} hours in advance."
                ),
            ));
        }
    }

    // The history line runs as a later statement of THIS SAME command (appointments#196):
    // the runtime binds `:now` once per command, and `_history_cancel.sql` finds the row this
    // run just wrote by `a.updated_at = :now` — a separate operation would never match it.
    let mut cancel = Map::new();
    cancel.insert("appointment_id".into(), json!(appointment_id));
    cancel.insert("reason".into(), json!(str_or(&payload, "reason", "")));
    cancel.insert("channel".into(), json!(channel.label()));
    Ok(Output {
        operations: vec![Operation::sql("appointments._cancel_row", cancel)],
        events: vec![],
        ..Default::default()
    })
}

/// `appointments.appointments.reschedule` — moving an appointment to another slot.
///
/// appointments#10 point 3. It was the last Tier 0 command of the booking family, and the only
/// thing the server checked was the status in the UPDATE's `WHERE` plus the overlap gate: the
/// browser sent `start_datetime`, `end_datetime` AND `duration_minutes`, so a receptionist — or
/// anything posting to `/api/command` — could move an appointment onto a holiday, inside the
/// minimum notice, or leave an `end_datetime` that did not match its own duration.
///
/// Now the same rules as `create` apply, decided from the reads BEFORE the row moves:
/// - the appointment itself is READ (`appointments.appointments.get`) — its state, its
///   professional and its current duration come from the row, not from the caller. That is also
///   why it declares `blocked_times.upcoming` and not the by-day, by-professional read `create`
///   uses: there is no `staff_id` in this payload to filter by, and asking the browser for one
///   would hand back the identity appointments#11 took away. The handler does the fine cut;
/// - the end of the slot is arithmetic (`start + duration`), never an opinion;
/// - minimum notice / maximum advance and the blocked agenda refuse with the same domain codes;
/// - overlap keeps its SERVER-SIDE gate in the same transaction (appointments#20): the handler
///   decides with a read and the row moves afterwards, so only the gate closes the race.
///
/// What is NOT here: changing the professional — it needs the staff catalogue reads, and is its
/// own piece of work. `outside_schedule` IS here now (appointments#89): `context.timezone`
/// (hub#1022) landed, so the opening hours are checked at this door and not only by the screen.
pub fn reschedule_appointment_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let channel = caller_channel(&payload)?;
    let appointment_id = str_or(&payload, "appointment_id", "");
    if appointment_id.is_empty() {
        return Err("invalid_payload: appointment_id is required".to_string());
    }

    // State guard — was the UPDATE's `WHERE status IN (...)`, which answered a silent OK when it
    // matched nothing, plus `_reschedule_state_assert.sql`. It is a refusal the UI can show.
    let Some(row) = appointment_row(&input) else {
        return Ok(refuse(
            "appointments.cannot_reschedule",
            "This appointment can no longer be moved in its current state.",
        ));
    };
    // appointments#142: the other half of the door appointments#140 closed for `cancel`. Same
    // gate, same code, asked in the same place — before the state, the notice and the agenda —
    // so a stranger who guesses an id cannot move a chair that is not hers, nor use the refusals
    // to find out anything about it.
    if let Some(refusal) = customer_identity_refusal(channel, &payload, &row)? {
        return Ok(refusal);
    }

    let status = as_str(row.get("status").unwrap_or(&Value::Null));
    if !matches!(status.as_str(), "pending" | "confirmed") {
        return Ok(refuse(
            "appointments.cannot_reschedule",
            "This appointment can no longer be moved in its current state.",
        ));
    }

    let Some(settings) = settings_read(&input) else {
        return Ok(refuse(
            "appointments.settings_unavailable",
            "The booking settings could not be read; the appointment was not moved.",
        ));
    };

    // appointments#79: both of these used to be a raw `Err`, which the host re-wraps as
    // «error de handler WASM: wasm call to `reschedule_appointment` failed: …» — the runtime's
    // plumbing on the caller's screen, in one hard-coded language, with no code to key on. They
    // are ordinary domain rejections and now say so. Aborting the transaction is unchanged: an
    // `Output` carrying an error rolls the whole command back (hub#139).
    let raw_start = as_str(payload.get("start_datetime").unwrap_or(&Value::Null));
    let Some(start) = parse_dt(&raw_start) else {
        return Ok(refuse(
            "appointments.invalid_start",
            "That start date and time is not a valid instant.",
        ));
    };
    // appointments#165 / #156: the move panel IS the counter, so it carries the same two
    // declarations `create` does (#155, #157) — the client seen at 11:30 instead of 11:00, the
    // one who arrived early and fits in half an hour. The customer channel (appointments#142)
    // cannot borrow them: its window is exactly what the minimum notice protects. Nor can a flow
    // or an API key on the staff channel (appointments#177): nobody there saw the warning.
    let counter = match channel {
        CallerChannel::Staff => CounterDeclaration::from_request(&input, &payload),
        CallerChannel::Customer => CounterDeclaration::NONE,
    };
    let starts_in_past = cmp_secs(&start, &ctx.now) < 0;
    if starts_in_past && !counter.past {
        return Ok(refuse(
            "appointments.invalid_start",
            "An appointment cannot start in the past.",
        ));
    }

    // The length of the appointment is its own unless the caller deliberately changes it.
    let current = row
        .get("duration_minutes")
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1)
        .unwrap_or_else(|| default_duration_of(&settings));
    let duration = payload
        .get("duration_minutes")
        .map(|v| as_i64(v, current))
        .filter(|d| *d >= 1)
        .unwrap_or(current);
    let end = start.add_minutes(duration);

    // Same rule as `prepare_appointment`: the window is measured from `now` forward, so a start
    // that already happened has nothing to say about it; `allow_short_notice` excuses only the
    // minimum — the maximum advance, the hours, blocked time and overlap still judge the move.
    if !starts_in_past {
        if let Some(refusal) = lead_time_refusal(&settings, &start, &ctx.now, counter.short_notice)
        {
            return Ok(Output::new().with_error(refusal));
        }
    }
    // The professional is the appointment's own, read from the row: this command moves the hour,
    // it does not hand the caller back the identity appointments#11 took away from `create`.
    let staff_id = str_or(&row, "staff_id", "");
    if let Some(refusal) = schedule_refusal(&input, ctx.tz, &start, &end) {
        return Ok(Output::new().with_error(refusal));
    }

    if let Some(refusal) = blocked_refusal(&input, &staff_id, &start, &end) {
        return Ok(Output::new().with_error(refusal));
    }

    if !allow_overlapping_of(&settings) {
        let Some(candidates) = candidates_from(&input, &staff_id, &appointment_id) else {
            return Ok(Output::new().with_error(availability_unavailable()));
        };
        if let Some(c) = candidates
            .iter()
            .find(|c| cmp_secs(&c.start, &end) < 0 && cmp_secs(&c.end, &start) > 0)
        {
            return Ok(Output::new().with_error(overlap_refusal(c)));
        }
    }

    // appointments#145: the trail says who asked for the move, like the cancel line does.
    let mut p = Map::new();
    p.insert("appointment_id".into(), json!(appointment_id));
    p.insert("start_datetime".into(), json!(start.iso()));
    p.insert("end_datetime".into(), json!(end.iso()));
    p.insert("duration_minutes".into(), json!(duration));
    p.insert("channel".into(), json!(channel.label()));

    let only_id = |_: ()| {
        let mut m = Map::new();
        m.insert("appointment_id".into(), json!(appointment_id));
        m
    };

    // The handler decided with a read; between that read and this UPDATE the state could have
    // changed. Both gates stay SERVER-SIDE, inside the command's own transaction, because that is
    // the only place the race actually closes (appointments#20). The overlap gate and the history
    // line now run as later statements of `_reschedule_row`'s own `sql[]`, together with the row
    // UPDATE itself: the runtime binds `:now` once per command, so `_appointment_overlap_assert.sql`
    // and `_history_reschedule.sql` can only find "the row this run just wrote" (`a.updated_at =
    // :now`) when they share that command with the UPDATE — a separate operation would never match
    // the pin (appointments#196).
    Ok(Output {
        operations: vec![
            Operation::sql("appointments._reschedule_state_assert", only_id(())),
            Operation::sql("appointments._reschedule_row", p),
            // Last link: the state assert above and the overlap assert folded into
            // `_reschedule_row` both wrote a passing row into `appointments__gate`, and a row that
            // passes survives the commit. Draining here — and only here, once every assert is
            // through — keeps the gate table scratch space instead of a log that grows two rows
            // per reschedule for ever (appointments#116, the `verifactu` pattern).
            Operation::sql("appointments._gate_clear", only_id(())),
        ],
        events: vec![],
        ..Default::default()
    })
}

/// `appointments.appointments.create` — WASM-TODO pieza 1.
///
/// appointments#11: the customer, the service and the professional are resolved against the
/// hub's records (the reads the manifest declares) BEFORE anything else; an id that does not
/// resolve is a domain refusal and nothing is written.
pub fn create_appointment_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let appointment_id = ctx
        .new_ids
        .first()
        .cloned()
        .ok_or_else(|| "context.new_ids vacío (lo inyecta el host)".to_string())?;

    let resolved = match resolve_booking(&input, &payload)? {
        Ok(r) => r,
        Err(refusal) => return Ok(Output::new().with_error(refusal)),
    };

    // The booking policy comes from the DB, or the booking does not happen (appointments#10).
    let Some(settings) = settings_read(&input) else {
        return Ok(Output::new().with_error(DomainError::new(
            "appointments.settings_unavailable",
            "The booking settings could not be read; the appointment was not booked.",
        )));
    };
    // Availability (lead time, blocked agenda) and overlap are decided from the authoritative
    // reads inside `prepare_appointment`, BEFORE anything is written (appointments#13/#10).
    let Some(mut candidates) = candidates_from(&input, &resolved.staff_id, "") else {
        return Ok(Output::new().with_error(availability_unavailable()));
    };
    let ops = match prepare_appointment(
        &input,
        &payload,
        &resolved,
        &settings,
        &mut candidates,
        &ctx.now,
        &appointment_id,
        "Cita creada",
        None,
        // appointments#155/#157: the counter screen declares a start it knows has already begun,
        // or one inside the minimum notice, and only it can. A booking marked `booked_online` is not the counter either: it is the
        // customer's, and the notice is her window (whatsapp_inbox#159 — the WhatsApp card pins
        // `booked_online: true`, so its AI step cannot declare its way inside the notice).
        // Nor is any other automation, marked online or not: a flow or an API key never declares
        // (appointments#177, see `CounterDeclaration::from_request`).
        if as_bool(payload.get("booked_online").unwrap_or(&Value::Null)) {
            CounterDeclaration::NONE
        } else {
            CounterDeclaration::from_request(&input, &payload)
        },
        StaffHoursGate::Enforce,
    ) {
        Ok(ops) => ops,
        Err(PrepareError::Domain(refusal)) => return Ok(Output::new().with_error(refusal)),
        Err(PrepareError::Invalid(detail)) => return Err(detail),
    };
    // appointments#174: `created` comes from here, not from a declarative `emit`, so it has the
    // same payload as the batch and the recurring series. Both names are declared in `events.emits`,
    // which is what the runtime checks before queueing them (hub#240).
    let mut events: Vec<erplora_guest_sdk::Event> =
        appointment_created(&ops).into_iter().collect();
    // appointments#136: born confirmed ANNOUNCES it. Whatever reacts to a confirmation — a
    // reminder, an automation telling the customer «you are booked» — must not go blind to half
    // the diary just because the confirmation happened at creation instead of a second later.
    if born_confirmed(&payload, &settings) {
        events.push(erplora_guest_sdk::Event::new(
            "appointments.appointment.confirmed",
            json!({ "appointment_id": appointment_id }),
        ));
    }
    // `..Default::default()` para que el literal compile contra LAS DOS formas de `Output`: la de
    // antes de hub#139 y la que ganó `error` (rechazo de dominio). Sin esto el handler deja de
    // compilar en cuanto el checkout del hub avanza, y nadie puede regenerar el wasm (pm#81).
    Ok(Output {
        operations: ops,
        events,
        ..Default::default()
    })
}

/// `appointments.appointments.bulk_create` — WASM-TODO pieza 2 (máx. 50 ítems).
/// Acumula errores por índice sin abortar el lote; el contador avanza dentro del
/// lote (un `_bump_counter` por cita, ejecutados en orden en la misma tx). Si
/// NINGÚN ítem es válido, falla con el detalle de todos los errores.
///
/// appointments#54: a batch is «the SAME customer books N slots» — a course, a five-session pass.
/// The three ids live at the TOP level of the payload, which is the only place `reads.params` can
/// look (`payload.<field>`), so the batch declares the same reads as `create` and inherits its
/// whole fail-closed behaviour: one resolution against the hub's records serves every slot, and
/// an id that does not resolve refuses the batch instead of writing rows with invented names.
/// A batch with a different customer per row no longer exists as a command: those are N `create`,
/// which have been authoritative since appointments#11.
pub fn bulk_create_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let empty: Vec<Value> = Vec::new();
    let items = payload
        .get("appointments")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    if items.is_empty() {
        return Err("invalid_payload: `appointments` vacío".to_string());
    }
    if items.len() > 50 {
        return Err(format!(
            "invalid_payload: máximo 50 citas por lote (recibidas {})",
            items.len()
        ));
    }

    let resolved = match resolve_booking(&input, &payload)? {
        Ok(r) => r,
        Err(refusal) => return Ok(Output::new().with_error(refusal)),
    };

    // The booking policy comes from the DB, or the batch does not happen (appointments#10).
    let Some(settings) = settings_read(&input) else {
        return Ok(Output::new().with_error(DomainError::new(
            "appointments.settings_unavailable",
            "The booking settings could not be read; the appointments were not booked.",
        )));
    };
    let Some(mut candidates) = candidates_from(&input, &resolved.staff_id, "") else {
        return Ok(Output::new().with_error(availability_unavailable()));
    };
    let mut ops: Vec<Operation> = Vec::new();
    let mut events: Vec<erplora_guest_sdk::Event> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut created = 0usize;

    for (i, item) in items.iter().enumerate() {
        let Some(id) = ctx.new_ids.get(created) else {
            errors.push(format!("[{i}] sin id disponible (new_ids agotados)"));
            continue;
        };
        match prepare_appointment(
            &input,
            item,
            &resolved,
            &settings,
            &mut candidates,
            &ctx.now,
            id,
            "Cita creada (lote)",
            None,
            CounterDeclaration::NONE,
            // Several days, one-day read: appointments#229.
            StaffHoursGate::NotDeclared,
        ) {
            Ok(item_ops) => {
                // appointments#138: every booked slot is announced like a one-by-one booking —
                // one `created` per appointment, because what listens (a flow confirming to the
                // customer, a reminder) reacts to an appointment, not to a batch. The declarative
                // `emit` of the command cannot do this: it fires once per call, not per row.
                // appointments#174: and with the same payload, built from the same row.
                events.extend(appointment_created(&item_ops));
                ops.extend(item_ops);
                // appointments#136: a slot born confirmed announces that too, decided by the same
                // `born_confirmed` that set the row's status — the event and the row cannot differ.
                if born_confirmed(item, &settings) {
                    events.push(erplora_guest_sdk::Event::new(
                        "appointments.appointment.confirmed",
                        json!({ "appointment_id": id }),
                    ));
                }
                created += 1;
            }
            // A DOMAIN refusal is the hub saying no to a slot — the whole batch stops with the
            // code the UI translates, because a five-session pass that silently books four is a
            // worse answer than «that day is a holiday, pick another». Anything else keeps the
            // per-index reporting the batch already had.
            Err(PrepareError::Domain(refusal)) => {
                return Ok(Output::new().with_error(refusal));
            }
            Err(PrepareError::Invalid(detail)) => errors.push(format!("[{i}] {detail}")),
        }
    }

    if created == 0 {
        return Err(format!(
            "bulk_create: 0 citas válidas — {}",
            errors.join("; ")
        ));
    }
    Ok(Output {
        operations: ops,
        events,
        ..Default::default()
    })
}

/// `appointments.appointments.bulk_delete` — WASM-TODO pieza 3 (máx. 50 ids).
/// Reusa el command SQL `appointments.appointments.delete` (soft-delete con
/// guarda de estado en el WHERE) una vez por id, en una sola transacción.
pub fn bulk_delete_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    host_ctx(&input)?; // valida que el contexto del host esté presente
    let empty: Vec<Value> = Vec::new();
    let ids: Vec<String> = payload
        .get("ids")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .map(as_str)
        .filter(|s| !s.is_empty())
        .collect();
    if ids.is_empty() {
        return Err("invalid_payload: `ids` vacío".to_string());
    }
    if ids.len() > 50 {
        return Err(format!(
            "invalid_payload: máximo 50 ids por lote (recibidos {})",
            ids.len()
        ));
    }

    let ops = ids
        .iter()
        .map(|id| {
            let mut p = Map::new();
            p.insert("appointment_id".into(), json!(id));
            Operation::sql("appointments.appointments.delete", p)
        })
        .collect();
    Ok(Output {
        operations: ops,
        events: vec![],
        ..Default::default()
    })
}

/// `appointments.recurring.update` — edit a series with scope «this and all following»
/// (appointments#15).
///
/// The market decided this shape (15 references + 5 forums, recorded in the issue): **two**
/// scopes, not three. «Only this appointment» is the `reschedule` that already exists, over ONE
/// row. «All events» is deliberately **absent** — it means rewriting the past, and here the past
/// is charged, invoiced and chained into VeriFactu. No product in the salon vertical offers it;
/// Apple does not; Odoo blocks it the moment you touch the time and Google hides it.
///
/// «This and following» is a **split**, the canonical model of RFC 5545 (`RANGE=THISANDFUTURE`)
/// and what Google (`UNTIL` + insert), Microsoft and Odoo (`_stop_at()`) all do: the original
/// template is closed the day before the cut and a NEW one starts at the cut. Versioning the same
/// template instead would break the partial unique index `(hub_id, recurring_id, occurrence_date)`
/// — one series would hold two truths for the same wall day. Two ids do not.
///
/// What it refuses to touch, and why:
/// - **anything before today** — the cut is pulled forward to the business day if the caller
///   points at the past. RFC 5545 deprecated `THISANDPRIOR` outright.
/// - **a cancelled occurrence** — it is the EXCEPTION of the series («not that week»), and an
///   edit that resurrects it is the one that makes the receptionist stop trusting the screen.
/// - **an occurrence already turned into a sale** — it carries a fiscal record (ADR-0331).
///
/// The occurrences that DO move are rewritten in place: same row, same appointment number, same
/// audit trail, new slot on the business clock. That is better than deleting and re-materializing,
/// which is what loses the history the salon needs at the chair.
pub fn update_recurring_series_pure(input: Value) -> Result<Output, String> {
    let payload = payload_of(&input);
    let ctx = host_ctx(&input)?;

    let recurring_id = str_or(&payload, "recurring_id", "");
    if recurring_id.is_empty() {
        return Err("invalid_payload: recurring_id is required".to_string());
    }
    // A CLOSED enum, checked here as well as in the JSON schema: an unknown scope must fail, never
    // fall into a silent default. «all» arriving as a typo and rewriting the past is precisely
    // what must not be possible.
    let scope = str_or(&payload, "scope", "");
    if scope != "this_and_following" {
        return Err(format!(
            "invalid_payload: scope `{scope}` no soportado (solo `this_and_following`)"
        ));
    }
    let from = parse_dt(&str_or(&payload, "from_occurrence_date", ""))
        .ok_or_else(|| "invalid_payload: from_occurrence_date inválida (YYYY-MM-DD)".to_string())?;

    let new_time = payload.get("time").map(as_str).filter(|s| !s.is_empty());
    if let Some(t) = &new_time {
        parse_hhmm(t).ok_or_else(|| format!("invalid_payload: time inválido `{t}` (HH:MM)"))?;
    }
    let new_duration = payload
        .get("duration_minutes")
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1);

    // appointments#90 — LA PAUTA. `frequency` es una enum CERRADA aquí además de en el schema, por
    // el mismo motivo que el alcance: un valor desconocido tiene que fallar, nunca caer en un
    // defecto silencioso que convertiría la serie de una clienta en otra cosa.
    let new_frequency = match payload.get("frequency") {
        None => None,
        Some(v) => {
            let f = as_str(v);
            if !matches!(f.as_str(), "daily" | "weekly" | "biweekly" | "monthly") {
                return Err(format!(
                    "invalid_payload: frequency `{f}` no soportada (daily|weekly|biweekly|monthly)"
                ));
            }
            Some(f)
        }
    };
    // Un `null` EXPLÍCITO no es lo mismo que la clave ausente: ausente conserva el día de la
    // plantilla, `null` lo borra y la serie vuelve a alinearse con su fecha de inicio.
    let new_day_of_week: Option<Option<i64>> = match payload.get("day_of_week") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => {
            let d = as_i64(v, -1);
            if !(0..=6).contains(&d) {
                return Err(format!(
                    "invalid_payload: day_of_week `{d}` fuera de rango (0=lunes … 6=domingo)"
                ));
            }
            Some(Some(d))
        }
    };

    if new_time.is_none()
        && new_duration.is_none()
        && new_frequency.is_none()
        && new_day_of_week.is_none()
    {
        return Err(
            "invalid_payload: nada que cambiar (se espera `time`, `duration_minutes`, `frequency` o `day_of_week`)"
                .to_string(),
        );
    }

    let Some(rows) = read_rows(&input, "appointments.recurring.get") else {
        return Ok(refuse(
            "appointments.recurring_unavailable",
            "The recurring template could not be read; nothing was changed.",
        ));
    };
    let Some(tmpl) = rows.first().cloned() else {
        return Ok(refuse(
            "appointments.recurring_not_found",
            "That recurring appointment does not exist in this business.",
        ));
    };

    // Fail closed: without knowing what is already on the books, moving «the following ones» is
    // moving an unknown set — which is how a series quietly loses half its appointments.
    let Some(occurrences) = read_rows(&input, "appointments.recurring.occurrences") else {
        return Ok(refuse(
            "appointments.recurring_unavailable",
            "The occurrences already booked for this recurring appointment could not be read; nothing was changed.",
        ));
    };

    // THE PAST IS FROZEN: the cut can never land before the business day that is running.
    let today = business_day_of(&ctx.now, ctx.tz);
    let cut_days = days_from_civil(from.y, from.mo, from.d).max(today);
    let (cy, cmo, cd) = civil_from_days(cut_days);
    let cut = format!("{cy:04}-{cmo:02}-{cd:02}");

    let time = new_time.unwrap_or_else(|| str_or(&tmpl, "time", ""));
    let (th, tm) = parse_hhmm(&time)
        .ok_or_else(|| format!("invalid_payload: la plantilla tiene un time inválido `{time}`"))?;
    let duration = new_duration
        .unwrap_or_else(|| as_i64(tmpl.get("duration_minutes").unwrap_or(&Value::Null), 30));

    let start_days = parse_dt(&str_or(&tmpl, "start_date", ""))
        .map(|d| days_from_civil(d.y, d.mo, d.d))
        .ok_or_else(|| "invalid_payload: la plantilla tiene un start_date inválido".to_string())?;

    // La pauta que queda tras el cambio, y si de verdad cambió: lo que no se pide se hereda.
    let tmpl_frequency = str_or(&tmpl, "frequency", "weekly");
    let tmpl_day_of_week = tmpl
        .get("day_of_week")
        .map(|v| as_i64(v, -1))
        .filter(|d| (0..=6).contains(d));
    let frequency = new_frequency.unwrap_or_else(|| tmpl_frequency.clone());
    let day_of_week = new_day_of_week.unwrap_or(tmpl_day_of_week);
    let pattern_changed = frequency != tmpl_frequency || day_of_week != tmpl_day_of_week;
    // La pauta se ancla donde arranca la serie que va a mandar: el corte si hay split, y la fecha
    // de inicio de la plantilla si se edita en sitio.
    let anchor_days = if cut_days > start_days {
        cut_days
    } else {
        start_days
    };

    let mut ops: Vec<Operation> = Vec::new();
    // The series the moved occurrences will belong to: the new half, or the template itself when
    // the cut is at (or before) its very first occurrence and there is nothing to split.
    let target_series = if cut_days <= start_days {
        // «This and following» from the first occurrence IS «all events», and splitting would
        // leave a closed husk with `end_date < start_date`: a row that generates nothing and that
        // every list screen would still paint.
        let mut p = Map::new();
        p.insert("recurring_id".into(), json!(recurring_id));
        p.insert("time".into(), json!(time));
        p.insert("duration_minutes".into(), json!(duration));
        // appointments#90: la pauta viaja también en la edición en sitio. Sin esto la plantilla se
        // quedaría con la hora nueva y la frecuencia vieja, que es una serie que nadie pidió.
        p.insert("frequency".into(), json!(frequency));
        p.insert(
            "day_of_week".into(),
            day_of_week.map(Value::from).unwrap_or(Value::Null),
        );
        ops.push(Operation::sql("appointments._recurring_edit", p));
        recurring_id.clone()
    } else {
        let (py, pmo, pd) = civil_from_days(cut_days - 1);
        let mut close = Map::new();
        close.insert("recurring_id".into(), json!(recurring_id));
        close.insert(
            "end_date".into(),
            json!(format!("{py:04}-{pmo:02}-{pd:02}")),
        );
        ops.push(Operation::sql("appointments._recurring_close", close));

        let Some(new_series_id) = ctx.new_ids.first().cloned() else {
            return Err("context.new_ids vacío (lo inyecta el host)".to_string());
        };
        let mut split = Map::new();
        split.insert("new_id".into(), json!(new_series_id));
        split.insert("split_from_id".into(), json!(recurring_id));
        for key in [
            "customer_id",
            "customer_name",
            "service_id",
            "service_name",
            "staff_id",
            "staff_name",
        ] {
            split.insert(key.into(), json!(str_or(&tmpl, key, "")));
        }
        // appointments#90: la mitad nueva nace con la PAUTA nueva (heredada si no se pidió otra).
        split.insert("frequency".into(), json!(frequency));
        split.insert(
            "day_of_week".into(),
            day_of_week.map(Value::from).unwrap_or(Value::Null),
        );
        split.insert("time".into(), json!(time));
        split.insert("duration_minutes".into(), json!(duration));
        split.insert("start_date".into(), json!(cut));
        split.insert(
            "end_date".into(),
            tmpl.get("end_date").cloned().unwrap_or(Value::Null),
        );
        // A series limited by COUNT keeps its count: the new half only gets what the old one had
        // not spent. Carrying it over untouched doubles the series; dropping it makes a bounded
        // series unbounded.
        split.insert(
            "max_occurrences".into(),
            match tmpl
                .get("max_occurrences")
                .map(|v| as_i64(v, 0))
                .filter(|n| *n > 0)
            {
                Some(max) => json!((max - occurrences_before(&tmpl, start_days, cut_days)).max(0)),
                None => Value::Null,
            },
        );
        ops.push(Operation::sql("appointments._recurring_split", split));
        new_series_id
    };

    // The occurrences that move: from the cut onwards, still movable, not an exception, not
    // invoiced. Everything that does not move is COUNTED and reported — silence about what did
    // not happen is the failure every forum reports about this feature.
    let mut moved = 0i64;
    let mut locked_invoiced = 0i64;
    let mut kept_cancelled = 0i64;
    let mut cancelled_pattern_change = 0i64;
    for row in occurrences.iter() {
        let date = as_str(row.get("occurrence_date").unwrap_or(&Value::Null));
        let Some(d) = parse_dt(&date) else { continue };
        if days_from_civil(d.y, d.mo, d.d) < cut_days {
            continue; // the past, and everything the old half keeps
        }
        let status = as_str(row.get("status").unwrap_or(&Value::Null));
        if status == "cancelled" || status == "no_show" {
            kept_cancelled += 1;
            continue;
        }
        if !matches!(status.as_str(), "pending" | "confirmed") {
            continue; // started or completed: it is history, not a plan
        }
        let sale = as_str(row.get("converted_sale_id").unwrap_or(&Value::Null));
        if !sale.is_empty() {
            locked_invoiced += 1;
            continue;
        }
        let appointment_id = as_str(row.get("id").unwrap_or(&Value::Null));
        if appointment_id.is_empty() {
            continue;
        }
        if moved + cancelled_pattern_change >= 50 {
            break; // same per-invocation ceiling as `materialize` and `bulk_create`
        }
        // appointments#90 — PATTERN CHANGE. If the date no longer falls on the new pattern there is
        // no slot to move it to: it gets CANCELLED, which is what the receptionist would do by hand
        // and the only thing Fresha, Vagaro, Square and Booksy offer (they force a cancel and a new
        // booking). It is NOT deleted: deleting throws away the appointment number, the history and
        // the customer's record of it.
        //
        // What is cancelled stays hanging off the OLD half of the series, so neither the new half's
        // occurrence read sees it nor does the 005 partial unique index collide with it.
        if pattern_changed
            && !pattern_contains(
                &frequency,
                day_of_week,
                anchor_days,
                days_from_civil(d.y, d.mo, d.d),
            )
        {
            let mut cancel = Map::new();
            cancel.insert("appointment_id".into(), json!(appointment_id));
            // Stable key, not prose: the screen translates it (`en` + `es`, ADR-0055/0199).
            cancel.insert("reason".into(), json!("series_pattern_changed"));
            cancel.insert("channel".into(), json!("staff"));
            // The history line now rides `_recurring_cancel_occurrence`'s own `sql[]` as a later
            // statement of this SAME command (appointments#196): the runtime binds `:now` once per
            // command, and `_history_cancel.sql` finds the row this run just wrote by
            // `a.updated_at = :now` — a separate operation would never match it.
            ops.push(Operation::sql(
                "appointments._recurring_cancel_occurrence",
                cancel,
            ));
            cancelled_pattern_change += 1;
            continue;
        }
        // On the BUSINESS clock (appointments#12): the series keeps its wall time across a DST
        // change, so an occurrence either side of it lands at the same hour of the salon.
        let Some(start_iso) = business_wall_iso(d.y, d.mo, d.d, th, tm, 0, ctx.tz) else {
            continue;
        };
        let Some(end_iso) = business_iso_plus_minutes(&start_iso, duration, ctx.tz) else {
            continue;
        };
        let mut mv = Map::new();
        mv.insert("appointment_id".into(), json!(appointment_id));
        mv.insert("recurring_id".into(), json!(target_series));
        mv.insert("start_datetime".into(), json!(start_iso));
        mv.insert("end_datetime".into(), json!(end_iso));
        mv.insert("duration_minutes".into(), json!(duration));
        mv.insert("channel".into(), json!("staff"));
        // Every move leaves an audit row, like every other transition of this module: the audit
        // row now rides `_recurring_move_occurrence`'s own `sql[]` as a later statement of this
        // SAME command (appointments#196), because the runtime binds `:now` once per command and
        // `_history_reschedule.sql` finds the row this run just wrote by `a.updated_at = :now`.
        ops.push(Operation::sql(
            "appointments._recurring_move_occurrence",
            mv,
        ));
        moved += 1;
    }

    let mut out = Output::new();
    for op in ops {
        out = out.with_operation(op);
    }
    Ok(out.with_result(json!({
        "recurring_id": target_series,
        "split": target_series != recurring_id,
        "from_occurrence_date": cut,
        "pattern_changed": pattern_changed,
        "moved": moved,
        "cancelled_pattern_change": cancelled_pattern_change,
        "locked_invoiced": locked_invoiced,
        "kept_cancelled": kept_cancelled
    })))
}

/// ¿La fecha `day` (días desde epoch) sigue cayendo en la pauta `frequency`/`day_of_week` anclada
/// en `anchor_days`?
///
/// Es la MISMA regla de expansión que aplica `materialize_recurring` —alineación al día de la
/// semana en `weekly`/`biweekly`, mismo día del mes con clamp en `monthly`— preguntada como
/// PERTENENCIA en vez de como enumeración. Que sean la misma regla no es cosmético: si se
/// separaran, `update` cancelaría una cita que `materialize` volvería a crear en cuanto alguien
/// avanzara la ventana, y la serie oscilaría sola.
fn pattern_contains(
    frequency: &str,
    day_of_week: Option<i64>,
    anchor_days: i64,
    day: i64,
) -> bool {
    if day < anchor_days {
        return false;
    }
    match frequency {
        "daily" => true,
        "weekly" | "biweekly" => {
            let step = if frequency == "weekly" { 7 } else { 14 };
            let first = match day_of_week {
                Some(dow) => anchor_days + (dow - weekday_mon0(anchor_days)).rem_euclid(7),
                None => anchor_days,
            };
            day >= first && (day - first) % step == 0
        }
        _ => {
            // monthly: el mismo día del mes que el ancla, con clamp al último día del mes corto.
            let (_, _, dom) = civil_from_days(anchor_days);
            let (y, mo, d) = civil_from_days(day);
            d == dom.min(days_in_month(y, mo))
        }
    }
}

/// How many occurrences of `tmpl` fall strictly BEFORE `cut_days`, counting from its `start_date`.
///
/// Only needed to split a `max_occurrences` budget, and computed from the template's own rule
/// rather than from what happens to be booked: an occurrence that was never materialized still
/// spent its slot in the count.
fn occurrences_before(tmpl: &Value, start_days: i64, cut_days: i64) -> i64 {
    let frequency = str_or(tmpl, "frequency", "");
    match frequency.as_str() {
        "daily" | "weekly" | "biweekly" => {
            let step = match frequency.as_str() {
                "daily" => 1,
                "weekly" => 7,
                _ => 14,
            };
            let first = match tmpl
                .get("day_of_week")
                .map(|v| as_i64(v, -1))
                .filter(|v| (0..=6).contains(v))
            {
                Some(dow) if step > 1 => {
                    start_days + (dow - weekday_mon0(start_days)).rem_euclid(7)
                }
                _ => start_days,
            };
            if cut_days <= first {
                0
            } else {
                (cut_days - first + step - 1) / step
            }
        }
        _ => {
            // monthly: count the month boundaries crossed, clamped like the expansion does.
            let (sy, smo, _) = civil_from_days(start_days);
            let (cy, cmo, _) = civil_from_days(cut_days);
            let months = (cy - sy) * 12 + (cmo - smo);
            let start_dom = civil_from_days(start_days).2;
            let cut_dom = civil_from_days(cut_days).2;
            (months + if cut_dom > start_dom { 1 } else { 0 }).max(0)
        }
    }
}

/// Days-since-epoch of the BUSINESS day an instant falls on.
fn business_day_of(instant: &Dt, tz: chrono_tz::Tz) -> i64 {
    let key = business_day_key(instant, tz);
    let y: i64 = key[0..4].parse().unwrap_or(1970);
    let mo: i64 = key[4..6].parse().unwrap_or(1);
    let d: i64 = key[6..8].parse().unwrap_or(1);
    days_from_civil(y, mo, d)
}

/// `appointments.recurring.materialize` — WASM-TODO pieza 6.
///
/// The caller names the series (`recurring_id`) and its three links, and optionally the window
/// `from`/`to` (YYYY-MM-DD). Generates the occurrences (daily/weekly/biweekly/monthly) honouring
/// `end_date`/`max_occurrences`, skips the past ones and materializes at most 50 per invocation.
///
/// appointments#54: the TEMPLATE is loaded by id through `appointments.recurring.get` — it used to
/// arrive whole in the payload, `customer_name`, `service_name` and `staff_name` included, so the
/// browser wrote the names and the price of every occurrence of a series. The three ids still
/// travel in the payload because that is the only thing `reads.params` can filter by
/// (`payload.<field>`), but they are a SELECTOR: they must match the template the runtime loaded,
/// or the reads resolved somebody else's records and nothing is written.
pub fn materialize_recurring_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;

    let recurring_id = str_or(&payload, "recurring_id", "");
    if recurring_id.is_empty() {
        return Err("invalid_payload: recurring_id is required".to_string());
    }
    let Some(rows) = read_rows(&input, "appointments.recurring.get") else {
        return Ok(refuse(
            "appointments.recurring_unavailable",
            "The recurring template could not be read; nothing was booked.",
        ));
    };
    let Some(r) = rows.first().cloned() else {
        return Ok(refuse(
            "appointments.recurring_not_found",
            "That recurring appointment does not exist in this business.",
        ));
    };

    if !r.get("is_active").map(as_bool).unwrap_or(true) {
        return Ok(refuse(
            "appointments.recurring_inactive",
            "That recurring appointment is switched off; reactivate it to book its occurrences.",
        ));
    }

    // The ids are a selector, not a source of truth: if they point somewhere else, the catalogue
    // reads resolved another customer/service/professional and the series must not be written.
    for (field, key) in [
        ("customer_id", "customer_id"),
        ("service_id", "service_id"),
        ("staff_id", "staff_id"),
    ] {
        if str_or(&payload, field, "") != str_or(&r, key, "") {
            return Ok(refuse(
                "appointments.recurring_mismatch",
                "The recurring appointment does not match the customer, service or professional sent; nothing was booked.",
            ));
        }
    }

    let resolved = match resolve_booking(&input, &payload)? {
        Ok(res) => res,
        Err(refusal) => return Ok(Output::new().with_error(refusal)),
    };

    // The booking policy comes from the DB, or the series is not materialized (appointments#10).
    let Some(settings) = settings_read(&input) else {
        return Ok(refuse(
            "appointments.settings_unavailable",
            "The booking settings could not be read; nothing was booked.",
        ));
    };

    let frequency = str_or(&r, "frequency", "");
    if !matches!(
        frequency.as_str(),
        "daily" | "weekly" | "biweekly" | "monthly"
    ) {
        return Err(format!("invalid_payload: frequency inválida `{frequency}`"));
    }
    let time = str_or(&r, "time", "");
    let (th, tm) = parse_hhmm(&time)
        .ok_or_else(|| format!("invalid_payload: time inválido `{time}` (esperado HH:MM)"))?;
    let start_date = parse_dt(&str_or(&r, "start_date", ""))
        .ok_or_else(|| "invalid_payload: start_date inválida (YYYY-MM-DD)".to_string())?;
    let end_date_days = r
        .get("end_date")
        .map(as_str)
        .filter(|s| !s.is_empty())
        .and_then(|s| parse_dt(&s))
        .map(|d| days_from_civil(d.y, d.mo, d.d));
    let max_occurrences = r
        .get("max_occurrences")
        .map(|v| as_i64(v, 0))
        .filter(|n| *n > 0);
    let duration = r
        .get("duration_minutes")
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1)
        .or(resolved.service_duration)
        .unwrap_or_else(|| default_duration_of(&settings));

    // Ventana de materialización: [from, to] en días civiles.
    let today_days = days_from_civil(ctx.now.y, ctx.now.mo, ctx.now.d);
    let start_days = days_from_civil(start_date.y, start_date.mo, start_date.d);
    let from_days = payload
        .get("from")
        .map(as_str)
        .filter(|s| !s.is_empty())
        .and_then(|s| parse_dt(&s))
        .map(|d| days_from_civil(d.y, d.mo, d.d))
        .unwrap_or(today_days)
        .max(today_days);
    // How far ahead the hub materializes when the caller does not close the window: its own
    // `max_advance_booking`, read from the settings row (never from the payload).
    let advance_days = settings
        .get("max_advance_booking")
        .map(|v| as_i64(v, 90))
        .filter(|n| *n > 0)
        .unwrap_or(90);
    let to_days = payload
        .get("to")
        .map(as_str)
        .filter(|s| !s.is_empty())
        .and_then(|s| parse_dt(&s))
        .map(|d| days_from_civil(d.y, d.mo, d.d))
        .unwrap_or(from_days + advance_days);

    // Enumeración de ocurrencias desde start_date (n cuenta TODAS las ocurrencias,
    // también las anteriores a la ventana, para respetar max_occurrences).
    let mut occurrence_days: Vec<i64> = Vec::new();
    let mut n: i64 = 0;
    let mut guard = 0usize;
    match frequency.as_str() {
        "daily" | "weekly" | "biweekly" => {
            let step = match frequency.as_str() {
                "daily" => 1,
                "weekly" => 7,
                _ => 14,
            };
            let mut d = if step == 1 {
                start_days
            } else {
                // Alinear al day_of_week de la plantilla (0=Lun..6=Dom); si es NULL,
                // se mantiene el día de la semana de start_date.
                match r
                    .get("day_of_week")
                    .map(|v| as_i64(v, -1))
                    .filter(|v| (0..=6).contains(v))
                {
                    Some(dow) => start_days + (dow - weekday_mon0(start_days)).rem_euclid(7),
                    None => start_days,
                }
            };
            loop {
                guard += 1;
                if guard > 10_000 {
                    break;
                }
                n += 1;
                if let Some(max) = max_occurrences {
                    if n > max {
                        break;
                    }
                }
                if let Some(end) = end_date_days {
                    if d > end {
                        break;
                    }
                }
                if d > to_days {
                    break;
                }
                if d >= from_days {
                    occurrence_days.push(d);
                }
                d += step;
            }
        }
        _ => {
            // monthly: mismo día del mes que start_date, con clamp al fin de mes.
            let dom = start_date.d;
            let (mut y, mut m) = (start_date.y, start_date.mo);
            loop {
                guard += 1;
                if guard > 10_000 {
                    break;
                }
                n += 1;
                if let Some(max) = max_occurrences {
                    if n > max {
                        break;
                    }
                }
                let d = days_from_civil(y, m, dom.min(days_in_month(y, m)));
                if let Some(end) = end_date_days {
                    if d > end {
                        break;
                    }
                }
                if d > to_days {
                    break;
                }
                if d >= from_days {
                    occurrence_days.push(d);
                }
                m += 1;
                if m > 12 {
                    m = 1;
                    y += 1; // rollover de año en diciembre
                }
            }
        }
    }

    if occurrence_days.is_empty() {
        return Err("no_occurrences: la plantilla no genera ocurrencias en la ventana".to_string());
    }

    let Some(mut candidates) = candidates_from(&input, &resolved.staff_id, "") else {
        return Ok(Output::new().with_error(availability_unavailable()));
    };
    let mut ops: Vec<Operation> = Vec::new();
    let mut events: Vec<erplora_guest_sdk::Event> = Vec::new();
    let mut created = 0usize;

    // Ocurrencias de ESTA serie que ya están en la agenda (appointments#15). Sin esto, reejecutar
    // `materialize` DUPLICABA las citas — y materializar es justo lo que se reintenta, porque la
    // ventana avanza cada semana. Una cancelada cuenta como ya materializada a propósito: es la
    // EXCEPCIÓN de la serie, y el reintento no puede resucitarla.
    let Some(rows) = read_rows(&input, "appointments.recurring.occurrences") else {
        return Ok(refuse(
            "appointments.recurring_unavailable",
            "The occurrences already booked for this recurring appointment could not be read; nothing was booked.",
        ));
    };
    let booked: Vec<String> = rows
        .iter()
        .map(|row| as_str(row.get("occurrence_date").unwrap_or(&Value::Null)))
        .filter(|d| !d.is_empty())
        .collect();

    // Each occurrence is just a SLOT: who, what and for how much is the resolved booking, shared
    // by the whole series (appointments#54) — the template's denormalized copy is only what the
    // list screen shows, and it can be stale.
    let mut skipped_as_booked = 0usize;
    for days in occurrence_days {
        if created >= 50 {
            break; // tope por invocación (mismo límite que bulk_create)
        }
        let (y, mo, d) = civil_from_days(days);
        let occurrence_date = format!("{y:04}-{mo:02}-{d:02}");
        if booked.iter().any(|b| *b == occurrence_date) {
            skipped_as_booked += 1;
            continue;
        }
        // appointments#12 — THE SERIES KEEPS ITS WALL TIME across a DST change. The template
        // stores `HH:MM` on the salon clock; expanding it by adding days to an instant would drag
        // the whole series an hour off twice a year (an 11:00 client arriving at 10:00, with no
        // explanation on the screen). It is the rule Google Calendar states outright for recurring
        // events, and the reason its API refuses to expand a series without a declared zone.
        //
        // Until hub#1022 this line wrote a NAIVE text with no offset at all: a time nobody could
        // place on a clock, and one the database cannot order against the rows that do carry one.
        let Some(start_iso) = business_wall_iso(y, mo, d, th, tm, 0, ctx.tz) else {
            continue; // a date the calendar does not have; the rest of the series still books
        };
        let item = json!({
            "start_datetime": start_iso,
            "duration_minutes": duration,
            "booked_online": false,
        });
        let Some(id) = ctx.new_ids.get(created) else {
            break;
        };
        let desc = format!("Cita materializada de la plantilla recurrente {recurring_id}");
        let stamp = SeriesStamp {
            recurring_id: recurring_id.clone(),
            occurrence_date,
        };
        match prepare_appointment(
            &input,
            &item,
            &resolved,
            &settings,
            &mut candidates,
            &ctx.now,
            id,
            &desc,
            Some(&stamp),
            CounterDeclaration::NONE,
            // A series spans many days, one-day read: appointments#229.
            StaffHoursGate::NotDeclared,
        ) {
            Ok(item_ops) => {
                // appointments#172: every booked occurrence is announced like the other doors (#138,
                // #174) — one `created` per appointment, built from the row it writes. Occurrences
                // are born pending (`booked_online: false`), so there is never a `confirmed` to add.
                events.extend(appointment_created(&item_ops));
                ops.extend(item_ops);
                created += 1;
            }
            // Ocurrencias pasadas (hoy ya empezadas), solapadas o en un día bloqueado: se saltan,
            // no abortan — una serie de un año no se cae porque una de sus fechas sea festivo.
            Err(_) => continue,
        }
    }

    // Nada que hacer NO es un error cuando todo lo de la ventana ya está reservado: una operación
    // idempotente que grita en el segundo intento es una que nadie se atreve a reintentar.
    if created == 0 && skipped_as_booked == 0 {
        return Err(
            "no_occurrences: todas las ocurrencias de la ventana están en el pasado o solapadas"
                .to_string(),
        );
    }
    Ok(Output {
        operations: ops,
        events,
        ..Default::default()
    })
}

/// Parsea `HH:MM` (o `HH:MM:SS`) → (hora, minuto).
fn parse_hhmm(s: &str) -> Option<(i64, i64)> {
    let mut it = s.trim().split(':');
    let h: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    ((0..24).contains(&h) && (0..60).contains(&m)).then_some((h, m))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds the guest input. `reads` (when given) are MERGED over the trusted catalogues of
    /// [`catalog_reads`], so every create test books against real records unless it removes
    /// them on purpose (appointments#11: the catalogue is not optional any more).
    fn input(payload: Value, reads: Option<Value>) -> Value {
        // appointments#12: the runtime puts the business IANA in every command context
        // (hub#1022, `commands.rs:889`). The tests carry it because production does — a handler
        // that only ever sees `UTC` in its tests is one that ships the UTC bug.
        let mut ctx = json!({
            "now": "2026-07-31T10:00:00Z",
            "new_ids": ["apt-1"],
            "timezone": "Europe/Madrid"
        });
        let mut merged = catalog_reads();
        if let Some(Value::Object(extra)) = reads {
            for (k, v) in extra {
                merged[k] = v;
            }
        }
        ctx["reads"] = merged;
        json!({ "payload": payload, "context": ctx })
    }

    /// The four AUTHORITATIVE reads the runtime pre-loads for `create` (appointments#11): the
    /// customer row, the service row, the staff member row and the professionals eligible for
    /// the service (staff#9). Ids match [`item`]: customer `c1`, service `s-corte`, staff `s1`.
    fn catalog_reads() -> Value {
        json!({
            // appointments#102: the four lists of `schedules`, the AUTHORITY, which the runtime
            // pre-loads for all four booking commands — so the shared fixture carries them for the
            // same reason it carries the catalogue: a test that never sees a read production
            // always sends is a test of a different handler. All empty = a hub that has not
            // configured its hours, which is the state most of these cases are really about, and
            // then every calendar hour is bookable; the ones that DO care plant their own.
            "schedules.business_hours.list": [],
            "schedules.special_days.list": [],
            "schedules.overrides.list": [],
            "schedules.exception_intervals.list": [],
            "customers.get": [
                { "id": "c1", "name": "Ada Lovelace", "phone": "+34600000001",
                  "email": "ada@example.com", "is_active": 1 }
            ],
            "services.services.get": [
                { "id": "s-corte", "name": "Corte", "price": 2000, "duration_minutes": 30,
                  "is_bookable": 1, "is_active": 1 }
            ],
            "staff.members.get": [
                { "id": "s1", "full_name": "Bea Pro", "status": "active", "is_bookable": 1 }
            ],
            "staff.services.eligible_for_service": [
                { "staff_id": "s1", "full_name": "Bea Pro", "custom_duration": null,
                  "custom_price": null, "is_primary": 1 }
            ],
            // appointments#10/#13: both are `required: true` in the manifest, so they are always
            // there in production. Lead time is switched OFF (0 = no limit) and the agenda is
            // clear, so the tests that are about something else keep testing that something else.
            "appointments.settings.get": [
                { "allow_overlapping": 0, "default_duration": 60,
                  "min_booking_notice": 0, "max_advance_booking": 0 }
            ],
            "appointments.blocked_times.overlapping": [],
            // appointments#10: `conflicting` is `required` too now — the payload fallback that
            // used to cover its absence was the browser deciding what this booking collides with.
            "appointments.appointments.conflicting": [],
            // appointments#98: `required` for `create` too. A day NO template governs = Bea has
            // not configured her hours, so they refuse nothing; the cases that care plant theirs.
            "staff.availability.day_at": [
                { "kind": "day", "day": "2026-07-31", "schedule_id": null,
                  "start_time": null, "end_time": null, "is_full_day": 0 }
            ]
        })
    }

    fn item(start: &str, dur: i64, staff: &str) -> Value {
        json!({
            "customer_id": "c1",
            "customer_name": "Ada",
            "service_id": "s-corte",
            "start_datetime": start,
            "duration_minutes": dur,
            "staff_id": staff,
            "service_name": " Corte",
            "service_price": 2000
        })
    }

    fn insert_op(out: &Output) -> &Operation {
        out.operations
            .iter()
            .find(|op| op.command.ends_with("_insert_appointment"))
            .expect("insert operation")
    }

    fn domain_code(out: &Output) -> Option<String> {
        out.error.as_ref().map(|e| e.code.clone())
    }

    // ── appointments#11 · the customer, the service and the professional are RESOLVED, not told ──
    //
    // The browser used to decide who the customer was, what service at what price, and which
    // professional: `create` copied `customer_name` / `service_name` / `service_price` /
    // `staff_name` from the payload (or from a `service` object the caller also provided). Since
    // sales#68 fixed the same hole for the sale price, the rule is one: the runtime pre-loads the
    // catalogue rows (`reads`, ADR-0069) and the SNAPSHOT is taken from the row. The payload's
    // names and prices are, at most, a hint that is ignored.

    #[test]
    fn create_takes_the_service_snapshot_from_the_catalogue_read_not_the_payload() {
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload["service_name"] = json!("Manipulated service");
        payload["service_price"] = json!(1);
        payload["service"] = json!({ "name": "Also manipulated", "price": 2 });
        let out = create_appointment_pure(input(payload, None)).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let insert = insert_op(&out);
        assert_eq!(insert.params.get("service_id"), Some(&json!("s-corte")));
        assert_eq!(insert.params.get("service_name"), Some(&json!("Corte")));
        assert_eq!(insert.params.get("service_price"), Some(&json!(2000)));
    }

    #[test]
    fn create_takes_the_customer_snapshot_from_the_read_not_the_payload() {
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload["customer_name"] = json!("Somebody else");
        payload["customer_phone"] = json!("+34999999999");
        payload["customer_email"] = json!("x@y.z");
        let out = create_appointment_pure(input(payload, None)).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let insert = insert_op(&out);
        assert_eq!(insert.params.get("customer_id"), Some(&json!("c1")));
        assert_eq!(
            insert.params.get("customer_name"),
            Some(&json!("Ada Lovelace"))
        );
        assert_eq!(
            insert.params.get("customer_phone"),
            Some(&json!("+34600000001"))
        );
        assert_eq!(
            insert.params.get("customer_email"),
            Some(&json!("ada@example.com"))
        );
    }

    #[test]
    fn create_takes_the_staff_name_from_the_read_not_the_payload() {
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload["staff_name"] = json!("Invented employee");
        let out = create_appointment_pure(input(payload, None)).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            insert_op(&out).params.get("staff_name"),
            Some(&json!("Bea Pro"))
        );
    }

    /// The service duration comes from the catalogue when the caller does not choose one; the
    /// caller may still shorten/lengthen a booking (Fresha/Square let the receptionist edit the
    /// duration per booking), so an explicit `duration_minutes` is honoured.
    #[test]
    fn create_takes_the_duration_from_the_service_when_the_payload_omits_it() {
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload.as_object_mut().unwrap().remove("duration_minutes");
        let out = create_appointment_pure(input(payload, None)).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            insert_op(&out).params.get("duration_minutes"),
            Some(&json!(30))
        );
        let end = insert_op(&out)
            .params
            .get("end_datetime")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(
            end.starts_with("2026-07-31T11:30:00"),
            "end_datetime = {end}"
        );
    }

    // ── appointments#75 · a schema `default` overrides the handler's resolution chain ──
    //
    // The runtime does not hand the handler what the caller sent: after validating, it fills
    // every ABSENT top-level property with its schema `default` (`registry.rs::apply_defaults`,
    // ADR-0073) — for every tier, WASM included. `duration_minutes` is a "compute it when
    // absent" field (payload → professional's override → catalogue → module default): with a
    // `default` in the schema the key NEVER arrives absent, so the chain below it is dead code
    // and every API / assistant / WhatsApp booking silently lasts the schema's default. The
    // tests above call the handler directly, so they cannot see this seam: these ones apply
    // the binder first, against the REAL schema file shipped with the module.

    const CREATE_SCHEMA: &str = include_str!("../../schemas/appointment_create.json");
    const BULK_CREATE_SCHEMA: &str = include_str!("../../schemas/appointment_bulk_create.json");

    /// The binder's exact behaviour (`registry.rs::apply_defaults`): first-level properties
    /// only, ABSENT keys only, never overwriting a value the caller provided.
    fn binder_applied_defaults(schema_json: &str, payload: &mut Value) {
        let schema: Value = serde_json::from_str(schema_json).expect("schema parses");
        let Some(props) = schema.get("properties").and_then(|p| p.as_object()) else {
            return;
        };
        let Some(obj) = payload.as_object_mut() else {
            return;
        };
        for (key, prop) in props {
            if !obj.contains_key(key) {
                if let Some(default) = prop.get("default") {
                    obj.insert(key.clone(), default.clone());
                }
            }
        }
    }

    /// The issue's exact scenario: a 90-minute service booked through the public API without
    /// `duration_minutes`. The binder runs BEFORE the handler, so the booking only lasts 90
    /// minutes if the schema does not default the key away.
    #[test]
    fn create_resolves_the_catalogue_duration_after_the_binder_applies_schema_defaults() {
        let reads = json!({ "services.services.get": [
            { "id": "s-corte", "name": "Tinte", "price": 2000, "duration_minutes": 90,
              "is_bookable": 1, "is_active": 1 }
        ]});
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload.as_object_mut().unwrap().remove("duration_minutes");
        binder_applied_defaults(CREATE_SCHEMA, &mut payload);
        let out = create_appointment_pure(input(payload, Some(reads))).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            insert_op(&out).params.get("duration_minutes"),
            Some(&json!(90))
        );
        let end = insert_op(&out)
            .params
            .get("end_datetime")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(
            end.starts_with("2026-07-31T12:30:00"),
            "end_datetime = {end}"
        );
    }

    /// The exception the receptionist types still wins: an explicit `duration_minutes` is
    /// PRESENT, so the binder must not touch it and the handler must honour it.
    #[test]
    fn an_explicit_duration_survives_the_binder() {
        let mut payload = item("2026-07-31T11:00:00Z", 45, "s1");
        binder_applied_defaults(CREATE_SCHEMA, &mut payload);
        assert_eq!(
            payload.get("duration_minutes"),
            Some(&json!(45)),
            "the binder overwrote a value the caller provided"
        );
        let out = create_appointment_pure(input(payload, None)).unwrap();
        assert_eq!(
            insert_op(&out).params.get("duration_minutes"),
            Some(&json!(45))
        );
    }

    /// The professional's override (`custom_duration`, staff#9) beats the catalogue even when
    /// neither caller nor schema says a duration.
    #[test]
    fn the_professionals_override_survives_the_binder() {
        let reads = json!({
            "services.services.get": [
                { "id": "s-corte", "name": "Tinte", "price": 2000, "duration_minutes": 90,
                  "is_bookable": 1, "is_active": 1 }
            ],
            "staff.services.eligible_for_service": [
                { "staff_id": "s1", "full_name": "Bea Pro", "custom_duration": 120,
                  "custom_price": null, "is_primary": 1 }
            ]
        });
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload.as_object_mut().unwrap().remove("duration_minutes");
        binder_applied_defaults(CREATE_SCHEMA, &mut payload);
        let out = create_appointment_pure(input(payload, Some(reads))).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            insert_op(&out).params.get("duration_minutes"),
            Some(&json!(120))
        );
    }

    /// Parity with `bulk_create` — the issue's isolated proof that the module KNOWS how to
    /// resolve the duration: same input through both commands, each after its own schema's
    /// binder pass, must book the same duration.
    #[test]
    fn create_and_bulk_create_book_the_same_duration_after_their_binders() {
        let reads = json!({ "services.services.get": [
            { "id": "s-corte", "name": "Tinte", "price": 2000, "duration_minutes": 90,
              "is_bookable": 1, "is_active": 1 }
        ]});

        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload.as_object_mut().unwrap().remove("duration_minutes");
        binder_applied_defaults(CREATE_SCHEMA, &mut payload);
        let create = create_appointment_pure(input(payload, Some(reads.clone()))).unwrap();
        assert_eq!(
            insert_op(&create).params.get("duration_minutes"),
            Some(&json!(90))
        );

        let mut batch = json!({
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "appointments": [{ "start_datetime": "2026-07-31T11:00:00Z" }]
        });
        binder_applied_defaults(BULK_CREATE_SCHEMA, &mut batch);
        let mut bulk_input = input(batch, Some(reads));
        bulk_input["context"]["new_ids"] = json!(["apt-1"]);
        let bulk = bulk_create_pure(bulk_input).unwrap();
        assert!(bulk.error.is_none(), "{:?}", bulk.error);
        assert_eq!(
            insert_op(&bulk).params.get("duration_minutes"),
            insert_op(&create).params.get("duration_minutes"),
            "create and bulk_create must resolve the duration the same way"
        );
    }

    /// staff#9: the per-professional overrides (`custom_price` / `custom_duration`) are part of
    /// the authoritative snapshot when the competency declares them.
    #[test]
    fn create_applies_the_per_professional_overrides_from_the_eligibility_read() {
        let mut payload = item("2026-07-31T11:00:00Z", 30, "s1");
        payload.as_object_mut().unwrap().remove("duration_minutes");
        let reads = json!({ "staff.services.eligible_for_service": [
            { "staff_id": "s1", "full_name": "Bea Pro", "custom_duration": 45,
              "custom_price": 2500, "is_primary": 1 }
        ]});
        let out = create_appointment_pure(input(payload, Some(reads))).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            insert_op(&out).params.get("service_price"),
            Some(&json!(2500))
        );
        assert_eq!(
            insert_op(&out).params.get("duration_minutes"),
            Some(&json!(45))
        );
    }

    /// An id the read does not resolve (unknown, another hub, deleted) is a domain refusal, and
    /// nothing is written — a `service_id=missing-service` row is exactly what the E2E found.
    #[test]
    fn create_refuses_a_service_the_hub_does_not_have() {
        let out = create_appointment_pure(input(
            item("2026-07-31T11:00:00Z", 30, "s1"),
            Some(json!({ "services.services.get": [] })),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.service_not_found")
        );
        assert!(out.operations.is_empty());
    }

    #[test]
    fn create_refuses_a_service_that_is_not_bookable_or_not_active() {
        for (bookable, active) in [(0, 1), (1, 0)] {
            let reads = json!({ "services.services.get": [
                { "id": "s-corte", "name": "Corte", "price": 2000, "duration_minutes": 30,
                  "is_bookable": bookable, "is_active": active }
            ]});
            let out =
                create_appointment_pure(input(item("2026-07-31T11:00:00Z", 30, "s1"), Some(reads)))
                    .unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.service_not_bookable"),
                "bookable={bookable} active={active}"
            );
            assert!(out.operations.is_empty());
        }
    }

    #[test]
    fn create_refuses_a_customer_the_hub_does_not_have() {
        let out = create_appointment_pure(input(
            item("2026-07-31T11:00:00Z", 30, "s1"),
            Some(json!({ "customers.get": [] })),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.customer_not_found")
        );
        assert!(out.operations.is_empty());
    }

    #[test]
    fn create_refuses_a_professional_the_hub_does_not_have() {
        let out = create_appointment_pure(input(
            item("2026-07-31T11:00:00Z", 30, "s1"),
            Some(json!({ "staff.members.get": [] })),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.staff_not_found")
        );
        assert!(out.operations.is_empty());
    }

    #[test]
    fn create_refuses_a_professional_who_is_inactive_or_not_bookable() {
        for (status, bookable) in [("terminated", 1), ("active", 0)] {
            let reads = json!({ "staff.members.get": [
                { "id": "s1", "full_name": "Bea Pro", "status": status, "is_bookable": bookable }
            ]});
            let out =
                create_appointment_pure(input(item("2026-07-31T11:00:00Z", 30, "s1"), Some(reads)))
                    .unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.staff_not_bookable"),
                "status={status} bookable={bookable}"
            );
            assert!(out.operations.is_empty());
        }
    }

    /// staff#9: when the service HAS declared competencies, only those professionals may take
    /// it. When it has none, the hub has not narrowed it (Fresha/Square default: every team member
    /// performs every service until told otherwise) and any bookable member is accepted.
    #[test]
    fn create_refuses_a_professional_not_eligible_for_a_service_with_competencies() {
        let reads = json!({ "staff.services.eligible_for_service": [
            { "staff_id": "s2", "full_name": "Other Pro", "custom_duration": null,
              "custom_price": null, "is_primary": 1 }
        ]});
        let out =
            create_appointment_pure(input(item("2026-07-31T11:00:00Z", 30, "s1"), Some(reads)))
                .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.staff_not_eligible")
        );
        assert!(out.operations.is_empty());
    }

    #[test]
    fn create_accepts_any_bookable_professional_when_the_service_has_no_competencies() {
        let out = create_appointment_pure(input(
            item("2026-07-31T11:00:00Z", 30, "s1"),
            Some(json!({ "staff.services.eligible_for_service": [] })),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            insert_op(&out).params.get("staff_name"),
            Some(&json!("Bea Pro"))
        );
    }

    /// The hole sales#68 named: when the runtime does not deliver the catalogue, `create` must
    /// NOT degrade to the payload — that is the very path this fixes. The manifest marks the reads
    /// `required` (the runtime aborts before the handler runs); this is the belt to those braces.
    #[test]
    fn create_without_the_catalogue_reads_is_refused_never_degraded_to_the_payload() {
        for missing in [
            "customers.get",
            "services.services.get",
            "staff.members.get",
            "staff.services.eligible_for_service",
        ] {
            let mut inp = input(item("2026-07-31T11:00:00Z", 30, "s1"), None);
            inp["context"]["reads"]
                .as_object_mut()
                .unwrap()
                .remove(missing);
            let out = create_appointment_pure(inp).unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.catalog_unavailable"),
                "missing read {missing}"
            );
            assert!(out.operations.is_empty(), "missing read {missing}");
        }
    }

    /// appointments#110: la read autoritativa (context.reads) debe detectar el solape incluso
    /// cuando el caller NO aporta `existing_appointments`. Antes no había read y el solape pasaba.
    ///
    /// appointments#70: y el rechazo sale como los demás — un `DomainError` con código estable —
    /// no como un `Err(String)` cuyo prefijo haya que olfatear.
    #[test]
    fn create_rejects_overlap_from_context_reads() {
        // Cita existente 10:00–10:30 (la trae la read autoritativa del runtime).
        let reads = json!({ "appointments.appointments.conflicting": [
            { "id": "apt-x", "appointment_number": "APT-1", "staff_id": "s1",
              "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T10:30:00Z",
              "status": "confirmed" }
        ]});
        // Misma franja 10:15–10:45, mismo staff → debe solapar y rechazar.
        let inp = input(item("2026-07-31T10:15:00Z", 30, "s1"), Some(reads));
        let out =
            create_appointment_pure(inp).expect("an overlap is a refusal, not a command fault");
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.overlapping_appointment")
        );
        assert!(out.operations.is_empty(), "a refusal writes nothing");
    }

    /// appointments#70 — the point of the issue, from the consumer's side.
    ///
    /// The overlap is the most frequent refusal of all, and it was the only one WITHOUT a stable
    /// code: it left `create` as `Err("overlap: …")`, so every caller had to sniff the prefix to
    /// name it. This pins the two halves of the contract that made the sniffing
    /// unnecessary: the refusal is carried, not thrown, and the message names the clashing
    /// appointment so a screen can say WHICH one.
    #[test]
    fn the_overlap_refusal_names_the_appointment_it_clashes_with() {
        let reads = json!({ "appointments.appointments.conflicting": [
            { "id": "apt-x", "appointment_number": "APT-1", "staff_id": "s1",
              "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T10:30:00Z",
              "status": "confirmed" }
        ]});
        let inp = input(item("2026-07-31T10:15:00Z", 30, "s1"), Some(reads));
        let out = create_appointment_pure(inp).unwrap();
        let refusal = out.error.expect("a domain refusal");
        assert_eq!(refusal.code, "appointments.overlapping_appointment");
        assert!(
            refusal.message.contains("APT-1"),
            "the sentence has to name the clash: {}",
            refusal.message
        );
        assert!(
            !refusal.message.starts_with("overlap:"),
            "the code replaced the prefix, it does not travel inside the sentence: {}",
            refusal.message
        );
    }

    /// appointments#110: sin solape en la read autoritativa → se crea sin error.
    #[test]
    fn create_ok_when_no_overlap_in_context_reads() {
        let reads = json!({ "appointments.appointments.conflicting": [
            { "id": "apt-x", "appointment_number": "APT-1", "staff_id": "s1",
              "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T10:30:00Z",
              "status": "confirmed" }
        ]});
        // Franja distinta 11:00–11:30 → sin solape.
        let inp = input(item("2026-07-31T11:00:00Z", 30, "s1"), Some(reads));
        assert!(create_appointment_pure(inp).is_ok());
    }

    /// appointments#10: without the `conflicting` read the booking is REFUSED. Until then it fell
    /// back to `payload.existing_appointments` — a list the browser assembled — so a read that
    /// failed handed the double-booking guard back to the caller, which is the same hole
    /// appointments#110 had opened this whole line of work to close. The read is `required` in the
    /// manifest; this is what happens if it goes missing anyway.
    #[test]
    fn create_refuses_when_the_conflicting_read_is_missing() {
        let mut payload = item("2026-07-31T10:15:00Z", 30, "s1");
        payload["existing_appointments"] = json!([
            { "appointment_number": "APT-1", "staff_id": "s1",
              "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T10:30:00Z",
              "status": "confirmed" }
        ]);
        let mut inp = input(payload, None);
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.appointments.conflicting");
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );
    }

    fn overlapping_reads(allow_overlapping: Value) -> Value {
        json!({
            "appointments.appointments.conflicting": [
                { "id": "apt-x", "appointment_number": "APT-1", "staff_id": "s1",
                  "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T10:30:00Z",
                  "status": "confirmed" }
            ],
            "appointments.settings.get": [
                { "id": "st-1", "allow_overlapping": allow_overlapping, "default_duration": 45 }
            ]
        })
    }

    /// appointments#45: `allow_overlapping` comes from the AUTHORITATIVE read
    /// `context.reads["appointments.settings.get"]` (the row the Settings tab edits), not from
    /// `payload.settings`. A caller claiming `allow_overlapping: true` in the payload while the
    /// table says 0 must still be rejected on overlap.
    #[test]
    fn create_ignores_payload_settings_when_settings_read_is_present() {
        let mut payload = item("2026-07-31T10:15:00Z", 30, "s1");
        payload["settings"] = json!({ "allow_overlapping": true });
        let inp = input(payload, Some(overlapping_reads(json!(0))));
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.overlapping_appointment"),
            "payload.settings overrode the table"
        );
    }

    /// appointments#45: the table (INTEGER 1) allows overlapping → the same booking is accepted.
    #[test]
    fn create_allows_overlap_when_settings_read_says_so() {
        let inp = input(
            item("2026-07-31T10:15:00Z", 30, "s1"),
            Some(overlapping_reads(json!(1))),
        );
        assert!(create_appointment_pure(inp).is_ok());
    }

    /// appointments#45: `default_duration` also comes from the settings read (45 here, not the
    /// hardcoded 60) when neither the item nor the catalogue declares a duration. Since
    /// appointments#11 the service's own `duration_minutes` sits between the two, so the service
    /// here declares none.
    #[test]
    fn create_takes_default_duration_from_settings_read() {
        let mut it = item("2026-07-31T11:00:00Z", 30, "s1");
        it.as_object_mut().unwrap().remove("duration_minutes");
        let mut reads = overlapping_reads(json!(0));
        reads["services.services.get"] = json!([
            { "id": "s-corte", "name": "Corte", "price": 2000, "duration_minutes": null,
              "is_bookable": 1, "is_active": 1 }
        ]);
        let out = create_appointment_pure(input(it, Some(reads))).unwrap();
        let insert = out
            .operations
            .iter()
            .find(|op| op.command.ends_with("_insert_appointment"))
            .expect("insert operation");
        assert_eq!(insert.params.get("duration_minutes"), Some(&json!(45)));
        let end = insert
            .params
            .get("end_datetime")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(
            end.starts_with("2026-07-31T11:45:00"),
            "end_datetime = {end}"
        );
    }

    // ── appointments#6: cancellation policy (`now` in the fixture is 2026-07-31T10:00Z) ──────

    /// The customer the fixture's appointment belongs to (appointments#140).
    const APT_CUSTOMER: &str = "cus-ada";

    /// The cancellation as a caller composes it: `channel`, and — when the channel is the
    /// customer's — WHO is asking (appointments#140), against an appointment that belongs to
    /// `row_customer`. `asking_customer: None` is a payload that says nothing about whose
    /// appointment it is, which is what every caller sent before the identity check existed.
    fn cancel_input_asked_by(
        channel: Option<&str>,
        asking_customer: Option<&str>,
        row_customer: &str,
        start: &str,
        status: &str,
        settings: Value,
    ) -> Value {
        let mut payload = json!({ "appointment_id": "apt-1", "reason": "sick" });
        if let Some(c) = channel {
            payload["channel"] = json!(c);
        }
        if let Some(customer_id) = asking_customer {
            payload["customer_id"] = json!(customer_id);
        }
        let reads = json!({
            "appointments.appointments.get": [
                { "id": "apt-1", "appointment_number": "APT-1", "status": status,
                  "customer_id": row_customer,
                  "start_datetime": start, "end_datetime": start }
            ],
            "appointments.settings.get": settings,
        });
        input(payload, Some(reads))
    }

    /// The happy shape of the policy tests: the customer channel cancelling HER OWN appointment
    /// (the staff channel never says whose it is — the agenda screen sends only the id and the
    /// reason).
    fn cancel_input(channel: Option<&str>, start: &str, status: &str, settings: Value) -> Value {
        let asking = match channel {
            Some("customer") => Some(APT_CUSTOMER),
            _ => None,
        };
        cancel_input_asked_by(channel, asking, APT_CUSTOMER, start, status, settings)
    }

    fn policy(allow_customer: i64, notice_hours: i64) -> Value {
        json!([{ "id": "st-1", "allow_customer_cancellation": allow_customer,
                 "cancellation_notice_hours": notice_hours }])
    }

    fn op_commands(out: &Output) -> Vec<String> {
        out.operations.iter().map(|op| op.command.clone()).collect()
    }

    /// Staff cancel INSIDE the notice window (3 h before, policy 24 h): always allowed — the
    /// receptionist owns the agenda. Two intentions: the row update + its history line.
    #[test]
    fn cancel_by_staff_inside_notice_window_is_allowed() {
        let out = cancel_appointment_pure(cancel_input(
            None,
            "2026-07-31T13:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        assert!(
            out.error.is_none(),
            "staff must always be able to cancel: {:?}",
            out.error
        );
        assert_eq!(
            op_commands(&out),
            vec!["appointments._cancel_row"]
        );
        let row = &out.operations[0].params;
        assert_eq!(row.get("appointment_id"), Some(&json!("apt-1")));
        assert_eq!(row.get("reason"), Some(&json!("sick")));
        // appointments#196: the history line is a statement of `_cancel_row` itself, so the
        // channel it stamps rides the row operation.
        assert_eq!(
            out.operations[0].params.get("channel"),
            Some(&json!("staff"))
        );
    }

    /// Customer channel INSIDE the window: rejected with the domain code the UI translates,
    /// and NO intention (nothing may be written).
    #[test]
    fn cancel_by_customer_inside_notice_window_is_rejected() {
        let out = cancel_appointment_pure(cancel_input(
            Some("customer"),
            "2026-07-31T13:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        let err = out.error.expect("domain error expected");
        assert_eq!(err.code, "appointments.cancellation_notice_required");
        assert!(out.operations.is_empty());
    }

    /// Customer channel OUTSIDE the window (48 h before, policy 24 h): allowed, and the history
    /// line records the channel.
    #[test]
    fn cancel_by_customer_outside_notice_window_is_allowed() {
        let out = cancel_appointment_pure(cancel_input(
            Some("customer"),
            "2026-08-02T10:00:00Z",
            "pending",
            policy(1, 24),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            out.operations[0].params.get("channel"),
            Some(&json!("customer"))
        );
    }

    /// Exactly at the boundary (24 h before, policy 24 h) the customer is still in time.
    #[test]
    fn cancel_by_customer_exactly_at_notice_boundary_is_allowed() {
        let out = cancel_appointment_pure(cancel_input(
            Some("customer"),
            "2026-08-01T10:00:00Z",
            "pending",
            policy(1, 24),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    /// `allow_customer_cancellation = 0`: the customer channel cannot cancel at all, however far
    /// ahead — a distinct code, because the fix is not "call earlier" but "call the salon".
    #[test]
    fn cancel_by_customer_when_disabled_is_rejected() {
        let out = cancel_appointment_pure(cancel_input(
            Some("customer"),
            "2026-08-10T10:00:00Z",
            "pending",
            policy(0, 24),
        ))
        .unwrap();
        assert_eq!(
            out.error.map(|e| e.code),
            Some("appointments.customer_cancellation_disabled".to_string())
        );
    }

    /// The state guard the SQL used to carry via `expect_rows` lives in the handler now: a
    /// completed or already-cancelled appointment cannot be cancelled (same code as before).
    #[test]
    fn cancel_in_terminal_state_is_rejected_with_cannot_cancel() {
        for status in ["completed", "cancelled"] {
            let out = cancel_appointment_pure(cancel_input(
                None,
                "2026-08-10T10:00:00Z",
                status,
                policy(1, 24),
            ))
            .unwrap();
            assert_eq!(
                out.error.as_ref().map(|e| e.code.as_str()),
                Some("appointments.cannot_cancel"),
                "status {status}"
            );
            assert!(out.operations.is_empty());
        }
    }

    /// Unknown appointment (the read returns no row) → `cannot_cancel`, nothing written.
    #[test]
    fn cancel_unknown_appointment_is_rejected() {
        let payload = json!({ "appointment_id": "ghost" });
        let reads = json!({ "appointments.appointments.get": [], "appointments.settings.get": [] });
        let out = cancel_appointment_pure(input(payload, Some(reads))).unwrap();
        assert_eq!(
            out.error.map(|e| e.code),
            Some("appointments.cannot_cancel".to_string())
        );
    }

    /// A hub that never saved its settings (empty read) runs on the schema defaults:
    /// customer cancellation allowed with 24 h notice.
    #[test]
    fn cancel_by_customer_uses_default_policy_when_settings_row_is_missing() {
        let inside = cancel_appointment_pure(cancel_input(
            Some("customer"),
            "2026-07-31T20:00:00Z",
            "pending",
            json!([]),
        ))
        .unwrap();
        assert_eq!(
            inside.error.map(|e| e.code),
            Some("appointments.cancellation_notice_required".to_string())
        );
        let outside = cancel_appointment_pure(cancel_input(
            Some("customer"),
            "2026-08-05T10:00:00Z",
            "pending",
            json!([]),
        ))
        .unwrap();
        assert!(outside.error.is_none());
    }

    /// An unknown channel value is a caller bug, not a business refusal.
    #[test]
    fn cancel_with_unknown_channel_is_a_payload_error() {
        let err = cancel_appointment_pure(cancel_input(
            Some("robot"),
            "2026-08-05T10:00:00Z",
            "pending",
            policy(1, 24),
        ))
        .unwrap_err();
        assert!(err.starts_with("invalid_payload:"), "{err}");
    }

    // ── appointments#140: whose appointment is it? ───────────────────────────────────────────
    //
    // The customer channel applied the salon's policy to a cancellation it never checked BELONGED
    // to the person asking: the payload carried an appointment id and nothing else, so anyone who
    // saw or guessed an id could cancel a stranger's chair through the same door — with
    // `channel: customer`, so the salon's own rules signed it off as hers. The caller that has a
    // customer at all (the WhatsApp automation resolves her by phone before it lists anything)
    // must now say who is asking, and the appointment row decides.

    /// 🔴 The hole: an appointment that belongs to `cus-ada`, a cancellation asked by `cus-eve`.
    /// Refused with its own code, and NOTHING is written — no row update, no history line.
    #[test]
    fn cancel_by_customer_of_someone_elses_appointment_is_refused() {
        let out = cancel_appointment_pure(cancel_input_asked_by(
            Some("customer"),
            Some("cus-eve"),
            APT_CUSTOMER,
            "2026-08-10T10:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        assert_eq!(
            out.error.as_ref().map(|e| e.code.as_str()),
            Some(CUSTOMER_MISMATCH),
            "a stranger cancelled Ada's appointment: {:?}",
            out.operations
        );
        assert!(
            out.operations.is_empty(),
            "nothing may be written for an appointment that is not the caller's: {:?}",
            out.operations
        );
    }

    /// The same door with no customer at all: a `channel: customer` payload that names nobody
    /// proves nothing, so it cannot cancel either. It is a caller contract bug (the shape of the
    /// payload), not a business refusal — same treatment as a missing `appointment_id`.
    #[test]
    fn cancel_by_customer_without_saying_who_asks_is_a_payload_error() {
        let err = cancel_appointment_pure(cancel_input_asked_by(
            Some("customer"),
            None,
            APT_CUSTOMER,
            "2026-08-10T10:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap_err();
        assert!(err.starts_with("invalid_payload:"), "{err}");
        assert!(err.contains("customer_id"), "{err}");
    }

    /// A walk-in typed at the counter has no customer linked. Nobody can claim it through the
    /// customer channel: the check fails CLOSED, it does not fall through to «no owner, anyone».
    #[test]
    fn cancel_by_customer_of_an_appointment_with_no_customer_is_refused() {
        let out = cancel_appointment_pure(cancel_input_asked_by(
            Some("customer"),
            Some("cus-eve"),
            "",
            "2026-08-10T10:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        assert_eq!(
            out.error.as_ref().map(|e| e.code.as_str()),
            Some(CUSTOMER_MISMATCH)
        );
        assert!(out.operations.is_empty());
    }

    /// Her own appointment still cancels: the check binds the caller, it does not close the
    /// channel (appointments#6 stays exactly as it was).
    #[test]
    fn cancel_by_customer_of_her_own_appointment_is_allowed() {
        let out = cancel_appointment_pure(cancel_input_asked_by(
            Some("customer"),
            Some(APT_CUSTOMER),
            APT_CUSTOMER,
            "2026-08-10T10:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            op_commands(&out),
            vec!["appointments._cancel_row"]
        );
    }

    /// The agenda screen is untouched: staff cancel by id, with no customer in the payload, on an
    /// appointment of whoever. The receptionist owns the agenda — that is appointments#6.
    #[test]
    fn cancel_by_staff_needs_no_customer_id() {
        let out = cancel_appointment_pure(cancel_input_asked_by(
            None,
            None,
            APT_CUSTOMER,
            "2026-07-31T13:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            op_commands(&out),
            vec!["appointments._cancel_row"]
        );
    }

    /// A `customer_id` in a STAFF cancellation is not an identity claim and is not checked: the
    /// staff channel never had one, and reading it as one would let a mistyped id start refusing
    /// the receptionist's own cancellations.
    #[test]
    fn a_customer_id_sent_on_the_staff_channel_is_ignored() {
        let out = cancel_appointment_pure(cancel_input_asked_by(
            None,
            Some("cus-eve"),
            APT_CUSTOMER,
            "2026-07-31T13:00:00Z",
            "confirmed",
            policy(1, 24),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    /// Identity is decided BEFORE the state and the policy, so a stranger's guess learns the same
    /// thing whatever the row says: not yours. Otherwise the refusals themselves answer «is there
    /// an appointment under id X, and is it soon?» to anyone who asks.
    #[test]
    fn a_strangers_guess_never_learns_the_state_of_the_appointment() {
        for (status, start, settings) in [
            // Already cancelled → would have been `cannot_cancel`.
            ("cancelled", "2026-08-10T10:00:00Z", policy(1, 24)),
            // Inside the notice window → would have been `cancellation_notice_required`.
            ("confirmed", "2026-07-31T13:00:00Z", policy(1, 24)),
            // Policy off → would have been `customer_cancellation_disabled`.
            ("confirmed", "2026-08-10T10:00:00Z", policy(0, 24)),
        ] {
            let out = cancel_appointment_pure(cancel_input_asked_by(
                Some("customer"),
                Some("cus-eve"),
                APT_CUSTOMER,
                start,
                status,
                settings,
            ))
            .unwrap();
            assert_eq!(
                out.error.as_ref().map(|e| e.code.as_str()),
                Some(CUSTOMER_MISMATCH),
                "status {status} leaked a different refusal"
            );
        }
    }

    // ── appointments#13 / appointments#10 · the availability boundary ────────────────────────
    //
    // `create` guarded the OVERLAP and nothing else: an appointment could be booked on top of a
    // company holiday, or two minutes before it started. Both refusals are decided from the
    // authoritative reads (ADR-0069) — never from the payload — and both are pure instant
    // arithmetic, so they need no timezone.
    //
    // THE BUSINESS OPENING HOURS used to be the famous absence here, because they are WALL-CLOCK
    // (`HH:MM` on a `day_of_week`) while an appointment is an instant, and crossing them needs the
    // business timezone the core would not hand over. `context.timezone` (hub#1022) landed, so
    // appointments#89 moved that rule out of `queries/availability_check.sql` — where it was only
    // ADVISORY, informing the screen while every other door booked at three in the morning — and
    // into [`schedule_refusal`], next to the two below. Its cases live further down, DST included:
    // guessing the offset instead is what refuses correct bookings twice a year.
    //
    // THE PROFESSIONAL's own working hours are a door too since appointments#98: `create` reads
    // `staff.availability.day_at` (keyed by the payload's `staff_id` + instant; the runtime derives
    // the day on `:timezone`) and [`staff_hours_refusal`] decides the fit. Still NOT here: the batch,
    // the series and `reschedule` (whose payload carries no `staff_id`) — appointments#229.

    /// Settings row that switches both lead-time limits OFF (`0` = no limit), which is what the
    /// tests that are about something else need.
    fn no_lead_time() -> Value {
        json!([{ "allow_overlapping": 0, "default_duration": 60,
                 "min_booking_notice": 0, "max_advance_booking": 0 }])
    }

    fn lead_time(min_notice: i64, max_days: i64) -> Value {
        json!({ "appointments.settings.get": [
            { "allow_overlapping": 0, "default_duration": 60,
              "min_booking_notice": min_notice, "max_advance_booking": max_days }
        ]})
    }

    // ── the booking policy is READ, never told (appointments#10 point 2) ────────────────────

    /// The settings read is `required: true` in the manifest. If it is missing anyway, the answer
    /// is a refusal — NOT the caller's `payload.settings`. A guard that falls back to the payload
    /// when its input is missing is a guard that opens: the browser would be handing us
    /// `allow_overlapping` and the whole overlap gate with it.
    #[test]
    fn create_refuses_when_the_settings_read_is_missing_instead_of_trusting_the_payload() {
        let mut inp = input(item("2026-07-31T11:00:00Z", 30, "s1"), None);
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.settings.get");
        inp["payload"]["settings"] = json!({ "allow_overlapping": 1, "default_duration": 30 });

        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.settings_unavailable"),
            "no settings row → refuse; never fall back to what the caller sent"
        );
        assert!(out.operations.is_empty(), "a refusal writes nothing");
    }

    /// Same hole from the other side: with the read present, a `payload.settings` that opens the
    /// overlap gate must be ignored.
    #[test]
    fn create_ignores_a_payload_settings_that_tries_to_allow_overlapping() {
        let mut payload = item("2026-07-31T10:15:00Z", 30, "s1");
        payload["settings"] = json!({ "allow_overlapping": 1 });
        let mut inp = input(payload, None);
        inp["context"]["reads"]["appointments.settings.get"] = no_lead_time();
        inp["context"]["reads"]["appointments.appointments.conflicting"] = json!([
            { "id": "apt-x", "appointment_number": "APT-1", "staff_id": "s1",
              "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T10:30:00Z",
              "status": "confirmed" }
        ]);

        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.overlapping_appointment"),
            "the caller opened the gate from the payload"
        );
    }

    // ── lead time: too soon / too far (appointments#10 point 1) ─────────────────────────────

    /// `min_booking_notice` (minutes). Booking 15 minutes ahead when the hub asks for 60 is the
    /// classic online-booking abuse: the customer books while walking in.
    #[test]
    fn create_refuses_a_booking_inside_the_minimum_notice() {
        let inp = input(
            item("2026-07-31T10:15:00Z", 30, "s1"),
            Some(lead_time(60, 0)),
        );
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
        assert!(out.operations.is_empty());
    }

    /// Exactly on the boundary is IN: 60 minutes' notice means 60 is enough, not "more than 60".
    #[test]
    fn create_accepts_a_booking_exactly_at_the_minimum_notice() {
        let inp = input(
            item("2026-07-31T11:00:00Z", 30, "s1"),
            Some(lead_time(60, 0)),
        );
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out),
            None,
            "60 minutes ahead with a 60 minute notice is valid"
        );
    }

    /// `max_advance_booking` (days): a booking a year out blocks a slot nobody will honour.
    #[test]
    fn create_refuses_a_booking_beyond_the_maximum_advance() {
        let inp = input(
            item("2026-12-31T11:00:00Z", 30, "s1"),
            Some(lead_time(0, 90)),
        );
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_far"));
    }

    #[test]
    fn create_accepts_a_booking_inside_the_maximum_advance() {
        let inp = input(
            item("2026-08-15T11:00:00Z", 30, "s1"),
            Some(lead_time(0, 90)),
        );
        assert_eq!(domain_code(&create_appointment_pure(inp).unwrap()), None);
    }

    /// `0` disables the limit — a hub that never wants a lead time says so with a zero, and a
    /// zero must not mean "nothing can ever be booked".
    #[test]
    fn a_zero_lead_time_disables_the_limit() {
        let inp = input(
            item("2026-07-31T10:01:00Z", 30, "s1"),
            Some(lead_time(0, 0)),
        );
        assert_eq!(domain_code(&create_appointment_pure(inp).unwrap()), None);
        // appointments#78: the FAR side of the same zero. `check` used to call this same instant
        // `too_far` while `create` accepted it — the read and the write must read the setting
        // with one meaning, and here the meaning is "no cap".
        let far = input(
            item("2027-03-31T11:00:00Z", 30, "s1"),
            Some(lead_time(0, 0)),
        );
        let out = create_appointment_pure(far).unwrap();
        assert_eq!(
            domain_code(&out),
            None,
            "a zero max-advance cap must not refuse far bookings"
        );
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    // ── blocked time: holidays, closures, a professional's block (appointments#10) ──────────

    fn blocks(rows: Value) -> Value {
        let mut r = lead_time(0, 0);
        r["appointments.blocked_times.overlapping"] = rows;
        r
    }

    /// A hub-wide block (`staff_id` null) closes the agenda for everybody.
    #[test]
    fn create_refuses_inside_a_hub_wide_block() {
        let reads = blocks(json!([
            { "id": "b1", "title": "Festivo local", "staff_id": null, "all_day": 1,
              "start_datetime": "2026-07-31T00:00:00Z", "end_datetime": "2026-08-01T00:00:00Z" }
        ]));
        let out =
            create_appointment_pure(input(item("2026-07-31T11:00:00Z", 30, "s1"), Some(reads)))
                .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.blocked"));
        assert!(out.operations.is_empty());
    }

    /// A block on THIS professional refuses; the rest of the salon keeps working.
    #[test]
    fn create_refuses_inside_a_block_of_that_professional() {
        let reads = blocks(json!([
            { "id": "b2", "title": "Formación", "staff_id": "s1", "all_day": 0,
              "start_datetime": "2026-07-31T10:30:00Z", "end_datetime": "2026-07-31T12:00:00Z" }
        ]));
        let out =
            create_appointment_pure(input(item("2026-07-31T11:00:00Z", 30, "s1"), Some(reads)))
                .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.blocked"));
    }

    /// Another professional's block is none of this booking's business.
    #[test]
    fn a_block_of_another_professional_does_not_refuse() {
        let reads = blocks(json!([
            { "id": "b3", "title": "Formación", "staff_id": "s2", "all_day": 0,
              "start_datetime": "2026-07-31T10:30:00Z", "end_datetime": "2026-07-31T12:00:00Z" }
        ]));
        assert_eq!(
            domain_code(
                &create_appointment_pure(input(
                    item("2026-07-31T11:00:00Z", 30, "s1"),
                    Some(reads)
                ))
                .unwrap()
            ),
            None
        );
    }

    /// Touching edges do not overlap: a block that ENDS at 11:00 leaves the 11:00 slot free.
    #[test]
    fn a_block_that_ends_when_the_appointment_starts_does_not_refuse() {
        let reads = blocks(json!([
            { "id": "b4", "title": "Comida", "staff_id": "s1", "all_day": 0,
              "start_datetime": "2026-07-31T10:00:00Z", "end_datetime": "2026-07-31T11:00:00Z" }
        ]));
        assert_eq!(
            domain_code(
                &create_appointment_pure(input(
                    item("2026-07-31T11:00:00Z", 30, "s1"),
                    Some(reads)
                ))
                .unwrap()
            ),
            None
        );
    }

    /// The read is `required: true`; if it is missing anyway the booking is refused, not waved
    /// through. A guard whose input vanished must close, not open.
    #[test]
    fn create_refuses_when_the_blocked_times_read_is_missing() {
        let mut inp = input(item("2026-07-31T11:00:00Z", 30, "s1"), None);
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.blocked_times.overlapping");
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );
    }

    /// A deleted block is not a block.
    #[test]
    fn a_deleted_block_does_not_refuse() {
        let reads = blocks(json!([
            { "id": "b5", "title": "Cancelado", "staff_id": "s1", "all_day": 0, "is_deleted": 1,
              "start_datetime": "2026-07-31T10:30:00Z", "end_datetime": "2026-07-31T12:00:00Z" }
        ]));
        assert_eq!(
            domain_code(
                &create_appointment_pure(input(
                    item("2026-07-31T11:00:00Z", 30, "s1"),
                    Some(reads)
                ))
                .unwrap()
            ),
            None
        );
    }

    // ─────────── appointments#54 · a BATCH and a SERIES resolve their links like `create` ───────────
    //
    // `create` stopped believing the browser in appointments#11: who the customer is, what the
    // service costs and who performs it come from the rows the runtime pre-loads. `bulk_create`
    // and `recurring.materialize` went on writing `customer_name` / `service_name` /
    // `service_price` / `staff_name` exactly as they arrived, because `reads.params` only accepts
    // `payload.<field>` at the TOP level and a batch had its ids buried per item.
    //
    // The shape is what changed: a batch is «the same customer books N slots» and a series is ONE
    // template, so the three ids move up to the top level of the payload and both commands declare
    // the same reads as `create`. Nothing about the runtime contract had to change.

    /// A batch input: the ids at the top level and one entry per slot. `new_ids` is long enough
    /// for the whole batch (the host sends 256).
    ///
    /// A batch and a series span several days, so they declare the DAY-INDEPENDENT reads —
    /// `blocked_times.upcoming` and `appointments.upcoming_for_staff` — instead of the two the
    /// manifest filters by one `payload.start_datetime`. The helper swaps them the same way, so a
    /// test that plants a block or a conflicting appointment plants it where the command looks.
    fn batch_input(payload: Value, reads: Option<Value>) -> Value {
        let mut inp = input(payload, reads);
        inp["context"]["new_ids"] = json!((1..=60).map(|n| format!("apt-{n}")).collect::<Vec<_>>());
        let slot_reads = inp["context"]["reads"].as_object_mut().unwrap();
        let blocks = slot_reads
            .remove("appointments.blocked_times.overlapping")
            .unwrap_or_else(|| json!([]));
        slot_reads
            .entry("appointments.blocked_times.upcoming")
            .or_insert(blocks);
        let booked = slot_reads
            .remove("appointments.appointments.conflicting")
            .unwrap_or_else(|| json!([]));
        slot_reads
            .entry("appointments.appointments.upcoming_for_staff")
            .or_insert(booked);
        inp
    }

    fn slot(start: &str) -> Value {
        json!({ "start_datetime": start, "duration_minutes": 30 })
    }

    fn batch(slots: Value) -> Value {
        json!({
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "appointments": slots,
        })
    }

    fn insert_ops(out: &Output) -> Vec<&Operation> {
        out.operations
            .iter()
            .filter(|op| op.command.ends_with("_insert_appointment"))
            .collect()
    }

    #[test]
    fn bulk_create_takes_the_snapshot_from_the_catalogue_reads_not_the_payload() {
        let out = bulk_create_pure(batch_input(
            batch(json!([slot("2026-08-03T11:00:00Z")])),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let insert = insert_op(&out);
        assert_eq!(insert.params.get("customer_id"), Some(&json!("c1")));
        assert_eq!(
            insert.params.get("customer_name"),
            Some(&json!("Ada Lovelace"))
        );
        assert_eq!(insert.params.get("service_name"), Some(&json!("Corte")));
        assert_eq!(insert.params.get("service_price"), Some(&json!(2000)));
        assert_eq!(insert.params.get("staff_name"), Some(&json!("Bea Pro")));
    }

    /// The whole point of the batch: N slots, one customer, one service, one professional — so one
    /// resolution serves them all and every row carries the SAME authoritative snapshot.
    #[test]
    fn bulk_create_books_every_slot_of_the_batch_against_the_same_resolved_links() {
        let out = bulk_create_pure(batch_input(
            batch(json!([
                slot("2026-08-03T11:00:00Z"),
                slot("2026-08-10T11:00:00Z"),
                slot("2026-08-17T11:00:00Z")
            ])),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let inserts = insert_ops(&out);
        assert_eq!(inserts.len(), 3);
        for insert in inserts {
            assert_eq!(insert.params.get("service_id"), Some(&json!("s-corte")));
            assert_eq!(insert.params.get("service_price"), Some(&json!(2000)));
            assert_eq!(insert.params.get("staff_name"), Some(&json!("Bea Pro")));
        }
    }

    /// An id the catalogue does not resolve is a domain refusal for the WHOLE batch — the same
    /// answer `create` gives. Writing 4 of 5 rows and inventing the fifth is what this closes.
    #[test]
    fn bulk_create_refuses_a_service_the_hub_does_not_have() {
        let out = bulk_create_pure(batch_input(
            batch(json!([slot("2026-08-03T11:00:00Z")])),
            Some(json!({ "services.services.get": [] })),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.service_not_found")
        );
        assert!(out.operations.is_empty(), "nothing is written on a refusal");
    }

    #[test]
    fn bulk_create_refuses_a_professional_not_eligible_for_the_service() {
        let reads = json!({ "staff.services.eligible_for_service": [
            { "staff_id": "other", "full_name": "Otra", "is_primary": 1 }
        ]});
        let out = bulk_create_pure(batch_input(
            batch(json!([slot("2026-08-03T11:00:00Z")])),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.staff_not_eligible")
        );
    }

    /// The batch reads the booking policy like `create` does; the browser cannot hand it an
    /// `allow_overlapping` any more, and a missing policy refuses instead of degrading.
    #[test]
    fn bulk_create_refuses_when_the_settings_read_is_missing() {
        let mut inp = batch_input(batch(json!([slot("2026-08-03T11:00:00Z")])), None);
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.settings.get");
        let out = bulk_create_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.settings_unavailable")
        );
    }

    // ── recurring.materialize ──

    /// The recurring template as `appointments.recurring.get` returns it.
    fn template(extra: Value) -> Value {
        let mut row = json!({
            "id": "r1",
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "customer_name": "Ada Lovelace",
            "service_name": "Corte",
            "staff_name": "Bea Pro",
            "frequency": "weekly",
            "day_of_week": null,
            "time": "11:00",
            "duration_minutes": 30,
            "start_date": "2026-08-03",
            "end_date": null,
            "max_occurrences": 2,
            "is_active": 1
        });
        if let Value::Object(fields) = extra {
            for (k, v) in fields {
                row[k] = v;
            }
        }
        row
    }

    fn series_input(payload: Value, rows: Value, reads: Option<Value>) -> Value {
        let mut inp = batch_input(payload, reads);
        let planted = inp["context"]["reads"].as_object_mut().unwrap();
        planted.insert("appointments.recurring.get".into(), rows);
        // appointments#15: `required` in the manifest, so it is always there in production. Empty
        // by default = nothing of this series is on the books yet.
        planted
            .entry("appointments.recurring.occurrences")
            .or_insert_with(|| json!([]));
        inp
    }

    fn series_payload() -> Value {
        json!({
            "recurring_id": "r1",
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1"
        })
    }

    // ── appointments#12 · the BUSINESS clock inside the handler ─────────────────────────────
    //
    // The core resolves the business timezone (`settings::timezone_of`, hub#731) and hands it to
    // every command as `context.timezone` (hub#1022). Two things in this handler were reasoning
    // on the WRONG clock until that door existed, and both are user-visible.

    /// The appointment number rolls over with the SALON's day, not with UTC's.
    ///
    /// `day_key()` used to read the wall part of `context.now`, which arrives as UTC. In Madrid
    /// that means the counter starts a new series at 02:00 in summer: the 01:30 appointment of a
    /// late night is numbered as the next day's first, and two appointments of the same working
    /// day carry different date stamps. Every POS in the market cuts its own numbering on the
    /// business day — it is the same rule the cash register closes on.
    #[test]
    fn the_appointment_number_rolls_over_with_the_business_day_not_utc() {
        // 2026-07-31T22:30Z is already 2026-08-01 at 00:30 in Madrid (CEST).
        let mut inp = input(item("2026-08-01T09:00:00+02:00", 30, "s1"), None);
        inp["context"]["now"] = json!("2026-07-31T22:30:00Z");
        let out = create_appointment_pure(inp).unwrap();
        let bump = out
            .operations
            .iter()
            .find(|op| op.command.ends_with("_bump_counter"))
            .expect("counter bump");
        assert_eq!(
            bump.params.get("day").and_then(|v| v.as_str()),
            Some("20260801"),
            "the counter rolled on the UTC midnight, not the salon's"
        );
    }

    /// And the other way round: still the same business day though UTC already turned.
    #[test]
    fn the_appointment_number_keeps_the_business_day_when_utc_has_already_turned() {
        // 2026-01-15T23:30Z is 00:30 of the 16th in Madrid (CET) — a different day BOTH ways
        // depending on which clock you ask, which is what makes it worth pinning.
        let mut inp = input(item("2026-01-16T09:00:00+01:00", 30, "s1"), None);
        inp["context"]["now"] = json!("2026-01-15T23:30:00Z");
        let out = create_appointment_pure(inp).unwrap();
        let bump = out
            .operations
            .iter()
            .find(|op| op.command.ends_with("_bump_counter"))
            .expect("counter bump");
        assert_eq!(
            bump.params.get("day").and_then(|v| v.as_str()),
            Some("20260116")
        );
    }

    /// With no timezone in the context the handler degrades to UTC, exactly like the runtime's
    /// own `timezone_name()` — never to a guess.
    #[test]
    fn without_a_timezone_in_the_context_the_business_day_is_utc() {
        let mut inp = input(item("2026-08-01T09:00:00+02:00", 30, "s1"), None);
        inp["context"]["now"] = json!("2026-07-31T22:30:00Z");
        inp["context"]["timezone"] = json!("");
        let out = create_appointment_pure(inp).unwrap();
        let bump = out
            .operations
            .iter()
            .find(|op| op.command.ends_with("_bump_counter"))
            .expect("counter bump");
        assert_eq!(
            bump.params.get("day").and_then(|v| v.as_str()),
            Some("20260731")
        );
    }

    /// A recurring template stores a WALL time (`HH:MM`). Materializing it wrote that time NAIVE,
    /// with no offset at all — a text the database cannot order against the rows that do carry
    /// one, and a time nobody could place on a clock.
    ///
    /// It is written on the salon's clock now, with the offset of THAT day.
    #[test]
    fn materialize_writes_the_occurrence_on_the_business_clock_with_its_offset() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            None,
        ))
        .unwrap();
        let starts: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            starts,
            vec!["2026-08-03T11:00:00+02:00", "2026-08-10T11:00:00+02:00"],
            "a naive occurrence has no place on any clock"
        );
    }

    /// 🔴 The rule Google Calendar states outright for recurring events: the series keeps its WALL
    /// TIME across a DST change. An 11:00 appointment is at 11:00 in March and at 11:00 in April;
    /// the INSTANT moves by an hour, which is exactly the point.
    ///
    /// Adding 7 × 24 h — which is what expanding without a timezone amounts to — would drag the
    /// whole series an hour off twice a year, and the salon would find its Monday client arriving
    /// at 10:00 with no explanation.
    #[test]
    fn a_weekly_series_keeps_its_wall_time_across_the_spring_dst_change() {
        // 2026-03-29 is the spring change in Madrid (CET +1 → CEST +2). The series runs on
        // Mondays 11:00 either side of it.
        let mut inp = series_input(
            series_payload(),
            json!([template(json!({
                "frequency": "weekly",
                "time": "11:00",
                "start_date": "2026-03-23",
                "max_occurrences": 3
            }))]),
            None,
        );
        inp["context"]["now"] = json!("2026-03-20T09:00:00Z");
        let out = materialize_recurring_pure(inp).unwrap();
        let starts: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            starts,
            vec![
                "2026-03-23T11:00:00+01:00", // winter: 10:00Z
                "2026-03-30T11:00:00+02:00", // summer: 09:00Z — the WALL time did not move
                "2026-04-06T11:00:00+02:00",
            ]
        );
    }

    /// Same across the autumn change, the other way.
    #[test]
    fn a_weekly_series_keeps_its_wall_time_across_the_autumn_dst_change() {
        let mut inp = series_input(
            series_payload(),
            json!([template(json!({
                "frequency": "weekly",
                "time": "11:00",
                "start_date": "2026-10-19",
                "max_occurrences": 2
            }))]),
            None,
        );
        inp["context"]["now"] = json!("2026-10-15T09:00:00Z");
        let out = materialize_recurring_pure(inp).unwrap();
        let starts: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            starts,
            vec!["2026-10-19T11:00:00+02:00", "2026-10-26T11:00:00+01:00"]
        );
    }

    /// The one occurrence a year whose wall time DOES NOT EXIST (a series at 02:30 crossing the
    /// spring jump) is moved forward to the instant the clock jumps into — it is not skipped and
    /// it does not abort the series. Dropping an occurrence in silence loses a booking nobody will
    /// notice is missing until the client is at the door.
    #[test]
    fn an_occurrence_inside_the_spring_gap_lands_on_the_jump_instead_of_vanishing() {
        let mut inp = series_input(
            series_payload(),
            json!([template(json!({
                "frequency": "daily",
                "time": "02:30",
                "start_date": "2026-03-29",
                "max_occurrences": 2
            }))]),
            None,
        );
        inp["context"]["now"] = json!("2026-03-27T09:00:00Z");
        let out = materialize_recurring_pure(inp).unwrap();
        let starts: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            starts,
            vec![
                "2026-03-29T03:00:00+02:00", // 02:30 never happens: the clock jumps 02:00 → 03:00
                "2026-03-30T02:30:00+02:00",
            ],
            "an occurrence must never disappear without a trace"
        );
    }

    /// An AMBIGUOUS occurrence (the hour that happens twice in autumn) resolves to the FIRST
    /// pass, deterministically — the same rule the core's own scheduler applies
    /// (`LocalResult::Ambiguous(earliest, _)`), so a `cron` trigger and a series never disagree.
    #[test]
    fn an_ambiguous_occurrence_resolves_to_the_first_pass() {
        let mut inp = series_input(
            series_payload(),
            json!([template(json!({
                "frequency": "daily",
                "time": "02:30",
                "start_date": "2026-10-25",
                "max_occurrences": 1
            }))]),
            None,
        );
        inp["context"]["now"] = json!("2026-10-23T09:00:00Z");
        let out = materialize_recurring_pure(inp).unwrap();
        let starts: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(starts, vec!["2026-10-25T02:30:00+02:00"]);
    }

    /// This module is not Spain-only: a hub in a zone with a different rule gets the same
    /// treatment, and one WITHOUT daylight saving gets a constant offset.
    #[test]
    fn the_business_clock_is_whatever_the_hub_declared_not_ours() {
        for (tz, expected) in [
            ("America/New_York", "2026-08-03T11:00:00-04:00"),
            ("America/Phoenix", "2026-08-03T11:00:00-07:00"),
            ("Pacific/Auckland", "2026-08-03T11:00:00+12:00"),
        ] {
            let mut inp = series_input(
                series_payload(),
                json!([template(json!({ "max_occurrences": 1 }))]),
                None,
            );
            inp["context"]["timezone"] = json!(tz);
            let out = materialize_recurring_pure(inp).unwrap();
            let start = insert_ops(&out)[0]
                .params
                .get("start_datetime")
                .and_then(|v| v.as_str())
                .unwrap()
                .to_string();
            assert_eq!(start, expected, "{tz}");
        }
    }

    // ── appointments#15 · EDITAR LA SERIE, «esta y las siguientes» ──────────────────────────
    //
    // Decisión de mercado (15 referencias + 5 foros, en la issue): DOS alcances, no tres —
    // «solo esta» (que es el `reschedule` de siempre, sobre UNA cita) y «esta y las siguientes».
    // «Todas» se OMITE a propósito: reescribir el pasado, que aquí está cobrado y sellado en la
    // cadena fiscal. Ningún producto de salón lo ofrece; Apple tampoco; Odoo lo bloquea en cuanto
    // tocas la hora y Google esconde la opción.
    //
    // «Esta y las siguientes» = SPLIT: se cierra la plantilla original en la ocurrencia anterior
    // al corte y nace una plantilla NUEVA desde el corte. Es lo que hacen Google (`UNTIL` +
    // insert), Microsoft, Odoo (`_stop_at()`) y lo que canoniza RFC 5545
    // (`RANGE=THISANDFUTURE`). Versionar la misma plantilla rompería el índice único
    // `(hub_id, recurring_id, occurrence_date)`: la misma serie daría dos verdades para el mismo
    // día. Cada mitad con su `recurring_id` lo respeta gratis.

    /// The occurrences already on the books, as `appointments.recurring.occurrences` returns them.
    fn occurrence(date: &str, status: &str, extra: Value) -> Value {
        let mut row = json!({
            "id": format!("apt-{date}"),
            "occurrence_date": date,
            "status": status,
            "start_datetime": format!("{date}T11:00:00+02:00"),
            "end_datetime": format!("{date}T11:30:00+02:00"),
            "duration_minutes": 30,
            "converted_sale_id": null
        });
        if let Value::Object(fields) = extra {
            for (k, v) in fields {
                row[k] = v;
            }
        }
        row
    }

    fn series_edit_input(payload: Value, tmpl: Value, occurrences: Value) -> Value {
        let mut inp = series_input(series_payload(), json!([tmpl]), None);
        inp["payload"] = payload;
        inp["context"]["reads"]["appointments.recurring.occurrences"] = occurrences;
        inp["context"]["new_ids"] = json!((1..=30).map(|n| format!("new-{n}")).collect::<Vec<_>>());
        inp
    }

    fn edit_payload(from: &str, time: &str) -> Value {
        json!({
            "recurring_id": "r1",
            "scope": "this_and_following",
            "from_occurrence_date": from,
            "time": time
        })
    }

    fn ops_named<'a>(out: &'a Output, suffix: &str) -> Vec<&'a Operation> {
        out.operations
            .iter()
            .filter(|op| op.command.ends_with(suffix))
            .collect()
    }

    /// The shape of the whole operation: close the old template, open a new one, and move the
    /// future occurrences onto it. In one transaction, in that order.
    #[test]
    fn editing_this_and_following_splits_the_series_in_two() {
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-08-17", "12:00"),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-03", "completed", json!({})),
                occurrence("2026-08-10", "confirmed", json!({})),
                occurrence("2026-08-17", "confirmed", json!({})),
                occurrence("2026-08-24", "pending", json!({}))
            ]),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);

        // The original series ends the day BEFORE the cut — `UNTIL`, exactly as Google does it.
        let closed = ops_named(&out, "_recurring_close");
        assert_eq!(closed.len(), 1);
        assert_eq!(
            closed[0].params.get("end_date").and_then(|v| v.as_str()),
            Some("2026-08-16")
        );
        assert_eq!(
            closed[0]
                .params
                .get("recurring_id")
                .and_then(|v| v.as_str()),
            Some("r1")
        );

        // …and a NEW template starts at the cut, with the new time and the same links.
        let opened = ops_named(&out, "_recurring_split");
        assert_eq!(opened.len(), 1);
        let p = &opened[0].params;
        assert_eq!(
            p.get("start_date").and_then(|v| v.as_str()),
            Some("2026-08-17")
        );
        assert_eq!(p.get("time").and_then(|v| v.as_str()), Some("12:00"));
        assert_eq!(p.get("customer_id").and_then(|v| v.as_str()), Some("c1"));
        assert_eq!(
            p.get("service_id").and_then(|v| v.as_str()),
            Some("s-corte")
        );
        assert_eq!(p.get("staff_id").and_then(|v| v.as_str()), Some("s1"));
        assert_eq!(p.get("frequency").and_then(|v| v.as_str()), Some("weekly"));
        // Traceability: the new half says which one it came out of (#15 asks for TRAZABLE).
        assert_eq!(p.get("split_from_id").and_then(|v| v.as_str()), Some("r1"));
        let new_series = p
            .get("new_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        // The two future occurrences move to the new time and onto the new series.
        let moved = ops_named(&out, "_recurring_move_occurrence");
        let ids: Vec<_> = moved
            .iter()
            .filter_map(|op| op.params.get("appointment_id").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(ids, vec!["apt-2026-08-17", "apt-2026-08-24"]);
        assert_eq!(
            moved[0]
                .params
                .get("start_datetime")
                .and_then(|v| v.as_str()),
            Some("2026-08-17T12:00:00+02:00"),
            "the new slot is written on the business clock, with its offset"
        );
        assert_eq!(
            moved[0].params.get("end_datetime").and_then(|v| v.as_str()),
            Some("2026-08-17T12:30:00+02:00")
        );
        assert_eq!(
            moved[0].params.get("recurring_id").and_then(|v| v.as_str()),
            Some(new_series.as_str()),
            "a moved occurrence belongs to the NEW half of the series"
        );
        // Every move leaves an audit row, like every other transition of this module — as a
        // statement of the move command itself (appointments#196), so the channel its history line
        // stamps rides the move.
        // appointments#145: a series edit is always the counter's doing, and its history says so.
        for h in ops_named(&out, "_recurring_move_occurrence") {
            assert_eq!(h.params.get("channel"), Some(&json!("staff")));
        }
    }

    /// 🔴 THE PAST IS FROZEN. RFC 5545 deprecated `THISANDPRIOR` («MUST NOT be generated by
    /// applications»), Apple only offers «All Future Events» and Fresha only «all future». Here it
    /// is not a preference: a past appointment is charged, invoiced and chained into VeriFactu.
    #[test]
    fn the_past_is_never_touched_even_when_the_cut_is_in_the_past() {
        // `now` is 2026-07-31 in the fixtures; the caller asks to cut at a date before that.
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-07-06", "12:00"),
            template(json!({ "start_date": "2026-07-06", "max_occurrences": null })),
            json!([
                occurrence("2026-07-06", "completed", json!({})),
                occurrence("2026-07-13", "completed", json!({})),
                occurrence("2026-08-03", "confirmed", json!({}))
            ]),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        // The cut is pulled forward to TODAY on the business clock, so the closed series keeps
        // everything already served.
        assert_eq!(
            ops_named(&out, "_recurring_close")[0]
                .params
                .get("end_date")
                .and_then(|v| v.as_str()),
            Some("2026-07-30")
        );
        let ids: Vec<_> = ops_named(&out, "_recurring_move_occurrence")
            .iter()
            .filter_map(|op| op.params.get("appointment_id").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(
            ids,
            vec!["apt-2026-08-03"],
            "a served occurrence was rewritten"
        );
    }

    /// A cancelled occurrence stays cancelled: it is the EXCEPTION of the series («not that
    /// week»), and editing the series must not resurrect it. Same rule Google Calendar, Outlook,
    /// Fresha and Square apply — and the one that decides whether the receptionist trusts this.
    #[test]
    fn a_cancelled_occurrence_is_not_resurrected_by_editing_the_series() {
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-08-03", "12:00"),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-10", "cancelled", json!({})),
                occurrence("2026-08-17", "confirmed", json!({}))
            ]),
        ))
        .unwrap();
        let ids: Vec<_> = ops_named(&out, "_recurring_move_occurrence")
            .iter()
            .filter_map(|op| op.params.get("appointment_id").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(ids, vec!["apt-2026-08-17"]);
        // Counted as what it is — an EXCEPTION that was respected — and not merely swallowed by
        // the «not a plan any more» guard further down. The difference matters: the screen tells
        // the receptionist «the ones you cancelled by hand stay cancelled», which is the sentence
        // that makes the feature safe to press.
        let result = out.result.clone().expect("the command answers what it did");
        assert_eq!(
            result.get("kept_cancelled").and_then(|v| v.as_i64()),
            Some(1)
        );
        assert_eq!(result.get("moved").and_then(|v| v.as_i64()), Some(1));
    }

    /// An occurrence already turned into a sale is LOCKED. It carries a fiscal record, and the
    /// VeriFactu chain is not rewritten (ADR-0331). It is reported, not silently skipped.
    #[test]
    fn an_invoiced_occurrence_is_locked_and_reported() {
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-08-03", "12:00"),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence(
                    "2026-08-10",
                    "confirmed",
                    json!({ "converted_sale_id": "sale-1" })
                ),
                occurrence("2026-08-17", "confirmed", json!({}))
            ]),
        ))
        .unwrap();
        let ids: Vec<_> = ops_named(&out, "_recurring_move_occurrence")
            .iter()
            .filter_map(|op| op.params.get("appointment_id").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(ids, vec!["apt-2026-08-17"]);
        // Counted in the answer, not swallowed: the screen tells the receptionist that one
        // appointment did not move, and why. Silence is the failure the forums report about
        // every product that does this (Google and Microsoft both reset exceptions mutely).
        let result = out.result.clone().expect("the command answers what it did");
        assert_eq!(result.get("moved").and_then(|v| v.as_i64()), Some(1));
        assert_eq!(
            result.get("locked_invoiced").and_then(|v| v.as_i64()),
            Some(1)
        );
    }

    /// Cutting at the very first occurrence is «all events» in disguise, and there is nothing to
    /// split: the template itself is edited. Leaving a closed husk with `end_date < start_date`
    /// would be a row that generates nothing and that every list screen would still paint.
    #[test]
    fn cutting_at_the_first_occurrence_edits_the_template_instead_of_splitting_it() {
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-08-03", "12:00"),
            template(json!({ "max_occurrences": null })),
            json!([occurrence("2026-08-03", "confirmed", json!({}))]),
        ))
        .unwrap();
        assert!(
            ops_named(&out, "_recurring_close").is_empty(),
            "nothing to close"
        );
        assert!(
            ops_named(&out, "_recurring_split").is_empty(),
            "nothing to split"
        );
        let edited = ops_named(&out, "_recurring_edit");
        assert_eq!(edited.len(), 1);
        assert_eq!(
            edited[0].params.get("time").and_then(|v| v.as_str()),
            Some("12:00")
        );
        assert_eq!(
            edited[0]
                .params
                .get("recurring_id")
                .and_then(|v| v.as_str()),
            Some("r1")
        );
    }

    /// A series limited by COUNT keeps its count: the new half only gets the occurrences the old
    /// one had not spent. Carrying `max_occurrences` over untouched would silently double the
    /// series; dropping it would make a bounded series unbounded.
    #[test]
    fn a_series_limited_by_count_splits_the_remaining_count_not_the_whole_one() {
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-08-17", "12:00"),
            template(json!({ "max_occurrences": 5, "start_date": "2026-08-03" })),
            json!([]),
        ))
        .unwrap();
        // Weekly from 03/08: 03, 10 fall before the cut → 3 left of the 5.
        assert_eq!(
            ops_named(&out, "_recurring_split")[0]
                .params
                .get("max_occurrences")
                .and_then(|v| v.as_i64()),
            Some(3)
        );
    }

    #[test]
    fn editing_the_series_changes_the_duration_too() {
        let out = update_recurring_series_pure(series_edit_input(
            json!({
                "recurring_id": "r1",
                "scope": "this_and_following",
                "from_occurrence_date": "2026-08-17",
                "duration_minutes": 45
            }),
            template(json!({ "max_occurrences": null })),
            json!([occurrence("2026-08-17", "confirmed", json!({}))]),
        ))
        .unwrap();
        let split = ops_named(&out, "_recurring_split");
        assert_eq!(
            split[0]
                .params
                .get("duration_minutes")
                .and_then(|v| v.as_i64()),
            Some(45)
        );
        assert_eq!(
            split[0].params.get("time").and_then(|v| v.as_str()),
            Some("11:00"),
            "what was not asked for does not change"
        );
        let moved = ops_named(&out, "_recurring_move_occurrence");
        assert_eq!(
            moved[0].params.get("end_datetime").and_then(|v| v.as_str()),
            Some("2026-08-17T11:45:00+02:00")
        );
    }

    /// 🔴 The series keeps its WALL time across a DST change here too — the split writes the new
    /// slots on the business clock, so an occurrence either side of the change lands at the same
    /// hour of the salon and NOT at the same instant.
    #[test]
    fn moving_occurrences_across_a_dst_change_keeps_the_wall_time() {
        let mut inp = series_edit_input(
            edit_payload("2026-10-19", "12:00"),
            template(json!({ "start_date": "2026-10-05", "max_occurrences": null })),
            json!([
                occurrence("2026-10-19", "confirmed", json!({})),
                occurrence("2026-10-26", "confirmed", json!({}))
            ]),
        );
        inp["context"]["now"] = json!("2026-10-15T09:00:00Z");
        let out = update_recurring_series_pure(inp).unwrap();
        let slots: Vec<_> = ops_named(&out, "_recurring_move_occurrence")
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            slots,
            vec!["2026-10-19T12:00:00+02:00", "2026-10-26T12:00:00+01:00"]
        );
    }

    /// 🔴 The end of the slot is `start + duration` as INSTANTS, and the minutes have to carry.
    /// `11:30 + 45` is not «minute 75»: a naive `tm + duration` produces a time the calendar
    /// refuses, and the occurrence would be dropped from the move without a word — the series
    /// would silently keep half its appointments at the old hour.
    #[test]
    fn the_new_slot_carries_the_minutes_over_the_hour() {
        let out = update_recurring_series_pure(series_edit_input(
            json!({
                "recurring_id": "r1",
                "scope": "this_and_following",
                "from_occurrence_date": "2026-08-17",
                "time": "11:30",
                "duration_minutes": 45
            }),
            template(json!({ "max_occurrences": null })),
            json!([occurrence("2026-08-17", "confirmed", json!({}))]),
        ))
        .unwrap();
        let moved = ops_named(&out, "_recurring_move_occurrence");
        assert_eq!(moved.len(), 1, "the occurrence was dropped from the move");
        assert_eq!(
            moved[0]
                .params
                .get("start_datetime")
                .and_then(|v| v.as_str()),
            Some("2026-08-17T11:30:00+02:00")
        );
        assert_eq!(
            moved[0].params.get("end_datetime").and_then(|v| v.as_str()),
            Some("2026-08-17T12:15:00+02:00")
        );
    }

    /// And a slot that runs past midnight lands on the NEXT day, not on hour 25.
    #[test]
    fn a_slot_that_crosses_midnight_ends_on_the_next_day() {
        let out = update_recurring_series_pure(series_edit_input(
            json!({
                "recurring_id": "r1",
                "scope": "this_and_following",
                "from_occurrence_date": "2026-08-17",
                "time": "23:30",
                "duration_minutes": 60
            }),
            template(json!({ "max_occurrences": null })),
            json!([occurrence("2026-08-17", "confirmed", json!({}))]),
        ))
        .unwrap();
        let moved = ops_named(&out, "_recurring_move_occurrence");
        assert_eq!(moved.len(), 1);
        assert_eq!(
            moved[0].params.get("end_datetime").and_then(|v| v.as_str()),
            Some("2026-08-18T00:30:00+02:00")
        );
    }

    #[test]
    fn editing_a_series_the_hub_does_not_have_is_refused() {
        let mut inp = series_edit_input(
            edit_payload("2026-08-17", "12:00"),
            template(json!({})),
            json!([]),
        );
        inp["context"]["reads"]["appointments.recurring.get"] = json!([]);
        let out = update_recurring_series_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.recurring_not_found")
        );
    }

    #[test]
    fn editing_a_series_without_the_occurrences_read_refuses_instead_of_guessing() {
        // Fail closed: without knowing what is already on the books, moving «the following ones»
        // is moving an unknown set — which is how a series quietly loses half its appointments.
        let mut inp = series_edit_input(
            edit_payload("2026-08-17", "12:00"),
            template(json!({})),
            json!([]),
        );
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.recurring.occurrences");
        let out = update_recurring_series_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.recurring_unavailable")
        );
    }

    #[test]
    fn an_edit_that_changes_nothing_is_refused_instead_of_splitting_for_free() {
        let err = update_recurring_series_pure(series_edit_input(
            json!({
                "recurring_id": "r1",
                "scope": "this_and_following",
                "from_occurrence_date": "2026-08-17"
            }),
            template(json!({})),
            json!([]),
        ))
        .unwrap_err();
        assert!(err.starts_with("invalid_payload:"), "{err}");
    }

    /// The scope is a CLOSED enum. An unknown value must fail, never fall into a silent default —
    /// «all events» arriving as a typo and rewriting the past is exactly what must not happen.
    #[test]
    fn an_unknown_scope_is_refused_never_defaulted() {
        for scope in ["all", "this_only", ""] {
            let mut payload = edit_payload("2026-08-17", "12:00");
            payload["scope"] = json!(scope);
            let err = update_recurring_series_pure(series_edit_input(
                payload,
                template(json!({})),
                json!([]),
            ))
            .unwrap_err();
            assert!(
                err.starts_with("invalid_payload:"),
                "scope `{scope}`: {err}"
            );
        }
    }

    // ── appointments#90 · cambiar la PAUTA de la serie, no solo su hueco ─────────────────────
    //
    // `recurring.update` movía la HORA y la DURACIÓN «de esta en adelante». Cambiar la PAUTA
    // (`frequency`, `day_of_week`) es otra cosa: las ocurrencias caen en días DISTINTOS, así que
    // no hay correspondencia 1:1 con las citas ya reservadas y el split no puede limitarse a
    // reescribir el hueco de cada fila.
    //
    // DECISIÓN DE MERCADO. Google Calendar documenta el gesto exacto: `events.update` con `UNTIL`
    // sobre la serie vieja + `events.insert` de una serie nueva («the original one retains
    // instances without the change, and the new recurring event has instances where the change is
    // applied»). Outlook y Odoo (`_stop_at()`) hacen lo mismo. En el vertical de salón NADIE deja
    // cambiar la pauta desde una ocurrencia: Fresha, Vagaro, Square y Booksy obligan a CANCELAR y
    // volver a reservar — y esa es la respuesta a qué pasa con lo ya reservado que se queda sin
    // sitio: se CANCELA, no se borra. Borrar tira el nº de cita, el historial y la ficha de la
    // clienta; cancelar es exactamente lo que la recepcionista haría a mano.
    //
    // La objeción de la issue («cancelar deja excepciones que la pauta nueva nunca resucitará»)
    // muere con el split: lo cancelado se queda colgando de la mitad VIEJA, y la mitad nueva tiene
    // otro `recurring_id`, así que ni su read de ocurrencias las ve ni el índice único parcial de
    // la 005 choca con ellas.
    //
    // Y lo que SÍ sigue cabiendo en la pauta nueva no se cancela: se mueve, con su fila, su número
    // y su historial. Cancelar una cita que sigue siendo válida sería perder una reserva por un
    // detalle de implementación.

    fn pattern_payload(from: &str, extra: Value) -> Value {
        let mut p = json!({
            "recurring_id": "r1",
            "scope": "this_and_following",
            "from_occurrence_date": from
        });
        if let Value::Object(fields) = extra {
            for (k, v) in fields {
                p[k] = v;
            }
        }
        p
    }

    fn ids_of(out: &Output, suffix: &str) -> Vec<String> {
        ops_named(out, suffix)
            .iter()
            .filter_map(|op| op.params.get("appointment_id").and_then(|v| v.as_str()))
            .map(|s| s.to_string())
            .collect()
    }

    /// El caso de la recepcionista: «a partir del 17 Ana viene los MIÉRCOLES». Las citas de los
    /// lunes que quedan por delante ya no caben en la pauta nueva, así que se cancelan — con su
    /// motivo y su fila de historial — y se CUENTAN en la respuesta.
    #[test]
    fn changing_the_day_of_the_week_cancels_the_bookings_that_no_longer_fit() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-17", json!({ "day_of_week": 2 })),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-10", "confirmed", json!({})),
                occurrence("2026-08-17", "confirmed", json!({})),
                occurrence("2026-08-24", "pending", json!({}))
            ]),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);

        // La mitad nueva nace con la pauta NUEVA…
        let split = ops_named(&out, "_recurring_split");
        assert_eq!(split.len(), 1);
        assert_eq!(
            split[0].params.get("day_of_week").and_then(|v| v.as_i64()),
            Some(2)
        );
        assert_eq!(
            split[0].params.get("frequency").and_then(|v| v.as_str()),
            Some("weekly"),
            "lo que no se pide no cambia"
        );

        // …y ninguna cita se mueve: el 17 y el 24 son LUNES, y la pauta nueva son miércoles.
        assert!(
            ops_named(&out, "_recurring_move_occurrence").is_empty(),
            "una cita de un lunes no se recoloca en una serie de miércoles"
        );
        assert_eq!(
            ids_of(&out, "_recurring_cancel_occurrence"),
            vec!["apt-2026-08-17", "apt-2026-08-24"]
        );
        // Every cancellation leaves its trail, as a statement of the cancel command itself
        // (appointments#196): the channel its history line stamps rides that operation.
        for c in ops_named(&out, "_recurring_cancel_occurrence") {
            assert_eq!(c.params.get("channel"), Some(&json!("staff")));
        }

        let result = out.result.clone().expect("el command dice lo que hizo");
        assert_eq!(
            result.get("pattern_changed").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert_eq!(
            result
                .get("cancelled_pattern_change")
                .and_then(|v| v.as_i64()),
            Some(2)
        );
        assert_eq!(result.get("moved").and_then(|v| v.as_i64()), Some(0));
    }

    /// De semanal a quincenal: la mitad de lo reservado SIGUE cayendo en la pauta nueva. Esas
    /// citas se mueven a la mitad nueva (conservan fila, nº e historial); las que se quedan sin
    /// sitio se cancelan.
    #[test]
    fn switching_to_biweekly_keeps_the_dates_that_still_fit_and_cancels_the_rest() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-17", json!({ "frequency": "biweekly" })),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-17", "confirmed", json!({})),
                occurrence("2026-08-24", "confirmed", json!({})),
                occurrence("2026-08-31", "pending", json!({})),
                occurrence("2026-09-07", "pending", json!({}))
            ]),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let new_series = ops_named(&out, "_recurring_split")[0]
            .params
            .get("new_id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        // Quincenal desde el corte (17/08): 17/08 y 31/08 siguen siendo la serie.
        assert_eq!(
            ids_of(&out, "_recurring_move_occurrence"),
            vec!["apt-2026-08-17", "apt-2026-08-31"]
        );
        assert_eq!(
            ops_named(&out, "_recurring_move_occurrence")[0]
                .params
                .get("recurring_id")
                .and_then(|v| v.as_str()),
            Some(new_series.as_str())
        );
        assert_eq!(
            ids_of(&out, "_recurring_cancel_occurrence"),
            vec!["apt-2026-08-24", "apt-2026-09-07"]
        );
        let result = out.result.clone().expect("el command dice lo que hizo");
        assert_eq!(result.get("moved").and_then(|v| v.as_i64()), Some(2));
        assert_eq!(
            result
                .get("cancelled_pattern_change")
                .and_then(|v| v.as_i64()),
            Some(2)
        );
    }

    /// 🔴 La puerta es la MISMA que la de mover: una ocurrencia ya convertida en venta arrastra
    /// registro fiscal (ADR-0331) y no se cancela ni aunque la pauta la deje sin sitio. Se cuenta.
    #[test]
    fn a_pattern_change_never_cancels_an_invoiced_booking() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-17", json!({ "day_of_week": 2 })),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence(
                    "2026-08-17",
                    "confirmed",
                    json!({ "converted_sale_id": "sale-1" })
                ),
                occurrence("2026-08-24", "confirmed", json!({}))
            ]),
        ))
        .unwrap();
        assert_eq!(
            ids_of(&out, "_recurring_cancel_occurrence"),
            vec!["apt-2026-08-24"]
        );
        let result = out.result.clone().expect("el command dice lo que hizo");
        assert_eq!(
            result.get("locked_invoiced").and_then(|v| v.as_i64()),
            Some(1)
        );
    }

    /// Ni una cita EN CURSO o ya servida: no es un plan, es historia. Y una ya cancelada se queda
    /// como está — es la excepción de la serie, no algo que cancelar dos veces.
    #[test]
    fn a_pattern_change_never_touches_what_is_no_longer_a_plan() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-17", json!({ "day_of_week": 2 })),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-17", "in_progress", json!({})),
                occurrence("2026-08-24", "completed", json!({})),
                occurrence("2026-08-31", "cancelled", json!({}))
            ]),
        ))
        .unwrap();
        assert!(
            ops_named(&out, "_recurring_cancel_occurrence").is_empty(),
            "solo se cancela lo que sigue siendo un plan"
        );
        let result = out.result.clone().expect("el command dice lo que hizo");
        assert_eq!(
            result.get("kept_cancelled").and_then(|v| v.as_i64()),
            Some(1)
        );
        assert_eq!(
            result
                .get("cancelled_pattern_change")
                .and_then(|v| v.as_i64()),
            Some(0)
        );
    }

    /// El pasado sigue congelado: una cita anterior al corte no se cancela por cambiar la pauta.
    #[test]
    fn a_pattern_change_leaves_the_past_alone() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-17", json!({ "day_of_week": 2 })),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-03", "completed", json!({})),
                occurrence("2026-08-10", "confirmed", json!({}))
            ]),
        ))
        .unwrap();
        assert!(ops_named(&out, "_recurring_cancel_occurrence").is_empty());
        assert_eq!(
            ops_named(&out, "_recurring_close")[0]
                .params
                .get("end_date")
                .and_then(|v| v.as_str()),
            Some("2026-08-16")
        );
    }

    /// Cortar en la PRIMERA ocurrencia edita la plantilla en sitio, y la pauta nueva viaja en esa
    /// edición: sin esto el `_recurring_edit` guardaría la hora nueva con la frecuencia vieja.
    #[test]
    fn cutting_at_the_first_occurrence_changes_the_pattern_in_place() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-03", json!({ "frequency": "monthly" })),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-03", "confirmed", json!({})),
                occurrence("2026-08-10", "confirmed", json!({}))
            ]),
        ))
        .unwrap();
        assert!(ops_named(&out, "_recurring_split").is_empty());
        let edited = ops_named(&out, "_recurring_edit");
        assert_eq!(edited.len(), 1);
        assert_eq!(
            edited[0].params.get("frequency").and_then(|v| v.as_str()),
            Some("monthly")
        );
        // Mensual desde el 03/08: el 03 sigue cayendo en la pauta, el 10 no.
        assert_eq!(
            ids_of(&out, "_recurring_move_occurrence"),
            vec!["apt-2026-08-03"]
        );
        assert_eq!(
            ops_named(&out, "_recurring_move_occurrence")[0]
                .params
                .get("recurring_id")
                .and_then(|v| v.as_str()),
            Some("r1"),
            "sin split la cita sigue colgando de la MISMA serie"
        );
        assert_eq!(
            ids_of(&out, "_recurring_cancel_occurrence"),
            vec!["apt-2026-08-10"]
        );
    }

    /// Quitar el día de la semana (`null` explícito) es un cambio de pauta, y la mitad nueva se
    /// guarda SIN día: vuelve a alinearse con su fecha de inicio.
    #[test]
    fn clearing_the_day_of_the_week_is_a_pattern_change() {
        let out = update_recurring_series_pure(series_edit_input(
            pattern_payload("2026-08-20", json!({ "day_of_week": null })),
            template(json!({ "day_of_week": 3, "max_occurrences": null })),
            json!([occurrence("2026-08-20", "confirmed", json!({}))]),
        ))
        .unwrap();
        let split = ops_named(&out, "_recurring_split");
        assert_eq!(split.len(), 1);
        assert!(
            split[0]
                .params
                .get("day_of_week")
                .is_some_and(|v| v.is_null()),
            "el día se guarda vacío, no se hereda el viejo"
        );
        let result = out.result.clone().expect("el command dice lo que hizo");
        assert_eq!(
            result.get("pattern_changed").and_then(|v| v.as_bool()),
            Some(true)
        );
    }

    /// La frecuencia es una enum CERRADA, igual que el alcance: un valor desconocido falla, nunca
    /// cae en un defecto silencioso que convertiría la serie en otra cosa.
    #[test]
    fn an_unknown_frequency_is_refused_never_defaulted() {
        // El `time` va a propósito: sin él el rechazo sería el de «nada que cambiar» y el test
        // pasaría en verde sin haber mirado nunca la frecuencia.
        for frequency in ["yearly", "WEEKLY", ""] {
            let err = update_recurring_series_pure(series_edit_input(
                pattern_payload("2026-08-17", json!({ "time": "12:00", "frequency": frequency })),
                template(json!({})),
                json!([]),
            ))
            .unwrap_err();
            assert!(
                err.contains("frequency"),
                "frequency `{frequency}`: {err}"
            );
        }
    }

    /// Y un día de la semana fuera de 0..=6 tampoco pasa.
    #[test]
    fn a_day_of_the_week_out_of_range_is_refused() {
        for dow in [-1, 7, 99] {
            let err = update_recurring_series_pure(series_edit_input(
                pattern_payload("2026-08-17", json!({ "time": "12:00", "day_of_week": dow })),
                template(json!({})),
                json!([]),
            ))
            .unwrap_err();
            assert!(err.contains("day_of_week"), "day_of_week {dow}: {err}");
        }
    }

    /// 🔒 CERO REGRESIONES: mover la HORA de la serie sigue sin cancelar absolutamente nada. La
    /// cancelación es la respuesta a un cambio de PAUTA, no el nuevo camino por defecto.
    #[test]
    fn moving_only_the_time_still_cancels_nothing() {
        let out = update_recurring_series_pure(series_edit_input(
            edit_payload("2026-08-17", "12:00"),
            template(json!({ "max_occurrences": null })),
            json!([
                occurrence("2026-08-17", "confirmed", json!({})),
                occurrence("2026-08-24", "pending", json!({}))
            ]),
        ))
        .unwrap();
        assert!(ops_named(&out, "_recurring_cancel_occurrence").is_empty());
        let result = out.result.clone().expect("el command dice lo que hizo");
        assert_eq!(
            result.get("pattern_changed").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert_eq!(result.get("moved").and_then(|v| v.as_i64()), Some(2));
    }

    #[test]
    fn materialize_takes_the_template_from_the_read_not_the_payload() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let inserts = insert_ops(&out);
        assert_eq!(inserts.len(), 2, "max_occurrences = 2");
        let starts: Vec<_> = inserts
            .iter()
            .filter_map(|op| op.params.get("start_datetime").and_then(|v| v.as_str()))
            .collect();
        // appointments#12: on the SALON clock with its offset, never naive.
        assert_eq!(
            starts,
            vec!["2026-08-03T11:00:00+02:00", "2026-08-10T11:00:00+02:00"]
        );
    }

    /// Every materialized occurrence carries the snapshot resolved against the catalogue — not the
    /// denormalized copy the template row keeps for the list screen, and not the payload.
    #[test]
    fn materialize_takes_the_snapshot_from_the_catalogue_reads() {
        let stale = template(json!({
            "customer_name": "Stale name",
            "service_name": "Stale service",
            "staff_name": "Stale pro"
        }));
        let out = materialize_recurring_pure(series_input(series_payload(), json!([stale]), None))
            .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let insert = insert_op(&out);
        assert_eq!(
            insert.params.get("customer_name"),
            Some(&json!("Ada Lovelace"))
        );
        assert_eq!(insert.params.get("service_name"), Some(&json!("Corte")));
        assert_eq!(insert.params.get("service_price"), Some(&json!(2000)));
        assert_eq!(insert.params.get("staff_name"), Some(&json!("Bea Pro")));
    }

    #[test]
    fn materialize_refuses_a_template_the_hub_does_not_have() {
        let out =
            materialize_recurring_pure(series_input(series_payload(), json!([]), None)).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.recurring_not_found")
        );
        assert!(out.operations.is_empty());
    }

    #[test]
    fn materialize_refuses_an_inactive_template() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({ "is_active": 0 }))]),
            None,
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.recurring_inactive")
        );
    }

    /// The ids travel in the payload because that is the only place `reads.params` can look, so
    /// they are a SELECTOR, never a source of truth: if they do not match the template the runtime
    /// loaded, the reads resolved somebody else's customer and the series must not be written.
    #[test]
    fn materialize_refuses_when_the_payload_ids_do_not_match_the_template() {
        let mut payload = series_payload();
        payload["service_id"] = json!("s-other");
        let out = materialize_recurring_pure(series_input(
            payload,
            json!([template(json!({}))]),
            Some(json!({ "services.services.get": [
                { "id": "s-other", "name": "Otro", "price": 9900, "duration_minutes": 30,
                  "is_bookable": 1, "is_active": 1 }
            ]})),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.recurring_mismatch")
        );
        assert!(out.operations.is_empty());
    }

    #[test]
    fn materialize_refuses_a_service_the_hub_does_not_have() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(json!({ "services.services.get": [] })),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.service_not_found")
        );
    }

    // ── appointments#10 · the batch and the series apply the SAME availability rules as `create` ──

    fn upcoming_blocks(rows: Value) -> Value {
        json!({ "appointments.blocked_times.upcoming": rows })
    }

    #[test]
    fn bulk_create_refuses_a_slot_blocked_in_the_agenda() {
        let reads = upcoming_blocks(json!([
            { "id": "b1", "title": "Festivo", "staff_id": null, "all_day": 1,
              "start_datetime": "2026-08-03T00:00:00Z", "end_datetime": "2026-08-04T00:00:00Z" }
        ]));
        let out = bulk_create_pure(batch_input(
            batch(json!([slot("2026-08-03T11:00:00Z")])),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.blocked"));
        assert!(out.operations.is_empty());
    }

    /// A batch spans several days, so it reads the hub's UPCOMING blocks instead of the blocks of
    /// one day. The read is `required`; if it is missing anyway the batch closes, it does not open.
    #[test]
    fn bulk_create_refuses_when_the_blocked_times_read_is_missing() {
        let mut inp = batch_input(batch(json!([slot("2026-08-03T11:00:00Z")])), None);
        let reads = inp["context"]["reads"].as_object_mut().unwrap();
        reads.remove("appointments.blocked_times.upcoming");
        reads.remove("appointments.blocked_times.overlapping");
        let out = bulk_create_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );
    }

    #[test]
    fn bulk_create_refuses_a_slot_inside_the_minimum_notice() {
        let out = bulk_create_pure(batch_input(
            batch(json!([slot("2026-07-31T10:30:00Z")])),
            Some(lead_time(60, 0)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    /// The overlap candidates come from the professional's own upcoming appointments, read by the
    /// runtime — not from an `existing_appointments` array the caller assembled.
    ///
    /// appointments#70: and now that the overlap is a DOMAIN refusal, the batch stops with the
    /// code — the same rule the batch already applied to every other refusal of the hub (a
    /// five-session pass that silently books four is a worse answer than a named «no»).
    #[test]
    fn bulk_create_detects_overlap_from_the_authoritative_read() {
        let reads = json!({ "appointments.appointments.upcoming_for_staff": [
            { "id": "a9", "appointment_number": "APT-1", "staff_id": "s1", "status": "confirmed",
              "start_datetime": "2026-08-03T11:15:00Z", "end_datetime": "2026-08-03T11:45:00Z" }
        ]});
        let out = bulk_create_pure(batch_input(
            batch(json!([slot("2026-08-03T11:00:00Z")])),
            Some(reads),
        ))
        .expect("an overlap is a refusal, not a command fault");
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.overlapping_appointment")
        );
        assert!(out.operations.is_empty(), "a refused batch writes nothing");
    }

    /// A series skips the occurrences it cannot book and materializes the rest — the behaviour it
    /// already had for overlaps, now also for a blocked day.
    #[test]
    fn materialize_skips_a_blocked_occurrence_and_books_the_rest() {
        let reads = upcoming_blocks(json!([
            { "id": "b1", "title": "Festivo", "staff_id": null, "all_day": 1,
              "start_datetime": "2026-08-03T00:00:00Z", "end_datetime": "2026-08-04T00:00:00Z" }
        ]));
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(reads),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let starts: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| {
                op.params
                    .get("start_datetime")
                    .and_then(|v| v.as_str().map(String::from))
            })
            .collect();
        assert_eq!(
            starts,
            vec!["2026-08-10T11:00:00+02:00"],
            "the blocked 03/08 is skipped"
        );
    }

    // ── appointments#10 · `reschedule` stops trusting the caller ──
    //
    // It was the last Tier 0 command of the booking family: the browser sent `start_datetime`,
    // `end_datetime` AND `duration_minutes`, and the only server-side guards were the status WHERE
    // and the overlap gate. Nothing stopped a move onto a holiday, inside the minimum notice, or
    // with an `end_datetime` that did not match its own duration.

    fn booked_row(start: &str, minutes: i64, status: &str) -> Value {
        json!({
            "id": "apt-old",
            "appointment_number": "APT-20260731-0001",
            "staff_id": "s1",
            "customer_id": "c1",
            "service_id": "s-corte",
            "start_datetime": start,
            "end_datetime": "2026-07-31T12:00:00Z",
            "duration_minutes": minutes,
            "status": status
        })
    }

    /// `reschedule` has no `staff_id` in its payload — the professional is the appointment's own —
    /// so it cannot filter the blocked periods by person. It declares the day-independent
    /// `blocked_times.upcoming` and lets the handler do the fine cut, exactly like the batch does;
    /// the helper swaps the read the same way.
    fn reschedule_input(payload: Value, row: Value, reads: Option<Value>) -> Value {
        let mut inp = input(payload, reads);
        let planted = inp["context"]["reads"].as_object_mut().unwrap();
        planted.insert("appointments.appointments.get".into(), json!([row]));
        let blocks = planted
            .remove("appointments.blocked_times.overlapping")
            .unwrap_or_else(|| json!([]));
        planted
            .entry("appointments.blocked_times.upcoming")
            .or_insert(blocks);
        inp
    }

    fn move_to(start: &str, minutes: Option<i64>) -> Value {
        let mut p = json!({ "appointment_id": "apt-old", "start_datetime": start });
        if let Some(m) = minutes {
            p["duration_minutes"] = json!(m);
        }
        p
    }

    fn op_params<'a>(out: &'a Output, suffix: &str) -> &'a Map<String, Value> {
        &out.operations
            .iter()
            .find(|op| op.command.ends_with(suffix))
            .unwrap_or_else(|| panic!("operation {suffix} not found in {:?}", op_commands(out)))
            .params
    }

    /// The end of the slot is ARITHMETIC, not an opinion: the caller no longer sends it.
    #[test]
    fn reschedule_computes_the_end_from_the_start_and_the_duration() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let p = op_params(&out, "_reschedule_row");
        assert_eq!(
            p.get("start_datetime"),
            Some(&json!("2026-07-31T15:00:00+00:00"))
        );
        assert_eq!(
            p.get("end_datetime"),
            Some(&json!("2026-07-31T15:45:00+00:00"))
        );
        assert_eq!(p.get("duration_minutes"), Some(&json!(45)));
    }

    /// Moving an appointment without touching its length is the common gesture: the duration comes
    /// from the appointment's own row when the caller omits it.
    #[test]
    fn reschedule_keeps_the_duration_of_the_appointment_when_the_caller_omits_it() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", None),
            booked_row("2026-07-31T11:00:00Z", 90, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let p = op_params(&out, "_reschedule_row");
        assert_eq!(p.get("duration_minutes"), Some(&json!(90)));
        assert_eq!(
            p.get("end_datetime"),
            Some(&json!("2026-07-31T16:30:00+00:00"))
        );
    }

    #[test]
    fn reschedule_refuses_a_slot_blocked_in_the_agenda() {
        let reads = blocks(json!([
            { "id": "b1", "title": "Formación", "staff_id": "s1", "all_day": 0,
              "start_datetime": "2026-07-31T14:00:00Z", "end_datetime": "2026-07-31T18:00:00Z" }
        ]));
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.blocked"));
        assert!(out.operations.is_empty());
    }

    #[test]
    fn reschedule_refuses_a_slot_inside_the_minimum_notice() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T10:30:00Z", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(60, 0)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    // ── appointments#79 · a bad `start_datetime` is a REFUSAL, not a WASM stack ────────────────
    //
    // Every other rejection of this module already comes back as a domain code the shell can
    // translate. `invalid_start` was the one exception, and it surfaced as the runtime's own
    // plumbing:
    //
    //     {"code":"error","message":"error de handler WASM: wasm call to `reschedule_appointment`
    //      failed: invalid_start: la cita no puede empezar en el pasado"}
    //
    // A caller cannot key on that (it is prose, and prose in the wrong language), the shell paints
    // the raw string, and an aborted guest call is indistinguishable from a crash. Returning
    // `Ok(refuse(...))` keeps the transaction semantics identical — an `Output` carrying an error
    // rolls everything back (hub#139) — while giving the caller a code and a translation.

    #[test]
    fn reschedule_refuses_a_start_in_the_past_with_a_domain_code() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-30T10:00:00Z", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(0, 0)),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
    }

    #[test]
    fn reschedule_refuses_an_unparseable_start_with_a_domain_code() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("mañana por la tarde", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(0, 0)),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
    }

    /// `create` leaked the same way through the shared `prepare_appointment`, so the code has to
    /// come out of that door too — otherwise the module answers with a domain code on one command
    /// and a WASM stack on the next one for the very same mistake.
    #[test]
    fn create_refuses_a_start_in_the_past_with_a_domain_code() {
        let out = create_appointment_pure(input(
            item("2026-07-30T10:00:00Z", 30, "s1"),
            Some(lead_time(0, 0)),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
        assert!(out.operations.is_empty());
    }

    // ── appointments#155 · the counter records what has ALREADY started ────────────────────────
    //
    // The receptionist writes down the walk-in who is already in the chair, and by the time she
    // has picked customer, service and professional the start she chose is a minute old. Refusing
    // that is refusing the salon's most ordinary booking — and the market says so, unanimously in
    // the products whose users ARE salons:
    //
    //   · Mindbody/Booker ships the toggle by name — «Allow Appointments in the Past».
    //   · Acuity lets an admin pick a slot outside availability: a WARNING appears, and it «doesn't
    //     prevent you from scheduling the appointment»; its API says `admin=true` disables the
    //     availability validations outright.
    //   · Where it IS blocked (Calendly, GoHighLevel) it is the standing complaint, open for years.
    //
    // So the past stops being a wall and becomes a DECLARATION: the counter says «yes, this one
    // already started» and the booking happens. The declaration is what keeps every OTHER door
    // shut — an approval arriving from the inbox, a batch, a series occurrence — because those
    // have nobody in front of them to have seen the warning.
    #[test]
    fn create_books_a_start_in_the_past_when_the_counter_declares_it() {
        let mut payload = item("2026-07-30T10:00:00Z", 30, "s1");
        payload["allow_past"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(0, 0)))).unwrap();
        assert_eq!(domain_code(&out), None, "the counter's booking was refused");
        assert!(!out.operations.is_empty(), "nothing was written");
    }

    /// And the minimum notice cannot refuse it in its place. `min_booking_notice` defaults to
    /// **60** in the schema, so a hub that never touched its settings would answer `too_soon` to
    /// every backdated walk-in and the door would still be shut — with a different code. The
    /// notice is the window for whoever books from OUTSIDE; a start that already happened is not
    /// inside any window.
    #[test]
    fn a_backdated_counter_booking_is_not_refused_for_being_too_soon() {
        let mut payload = item("2026-07-31T09:00:00Z", 30, "s1");
        payload["allow_past"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(60, 0)))).unwrap();
        assert_eq!(domain_code(&out), None, "the minimum notice took over the wall");
    }

    /// The other half of the same rule: the declaration only excuses the PAST. A start still to
    /// come is judged by the notice like any other, or the counter would have a flag that turns
    /// the booking window off for good.
    #[test]
    fn the_minimum_notice_still_applies_to_a_future_start_the_counter_flagged() {
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["allow_past"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(60, 0)))).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.too_soon"),
            "the flag opened the booking window instead of just the past"
        );
    }

    /// Same for a batch: `bulk_create` books N slots for one customer, and its items are the
    /// caller's. The declaration is not a field the batch can carry.
    #[test]
    fn a_batch_item_cannot_borrow_the_counters_declaration() {
        let mut past = slot("2026-07-30T10:00:00Z");
        past["allow_past"] = json!(true);
        let out = bulk_create_pure(batch_input(batch(json!([past])), Some(lead_time(0, 0))))
            .expect("the batch reports per item, it does not abort");
        assert!(
            out.operations.is_empty(),
            "a batch item booked itself into the past"
        );
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
    }

    // ── appointments#157 · the minimum notice is the CUSTOMER's window, not the counter's ─────
    //
    // A customer walks in and asks for «half an hour from now». The receptionist, with the agenda
    // in front of her, books it — and the hub answered `too_soon`, because `min_booking_notice`
    // (60 by default) applied to every door. The notice exists so that nobody books ONLINE at
    // 10:58 for 11:00 without anyone seeing it; the person at the counter is exactly who sees it.
    // Fresha and Booksy file the minimum lead time under ONLINE booking settings, Square and
    // Mindbody scope it to the client-facing channel, and Acuity's `admin=true` disables the
    // availability validations outright. So the counter declares `allow_short_notice` and the
    // notice steps aside — for that caller alone. A separate declaration from `allow_past`
    // (#155), on purpose: excusing the past and excusing the window are different decisions.

    #[test]
    fn the_counter_books_inside_the_minimum_notice_when_it_declares_it() {
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["allow_short_notice"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(60, 0)))).unwrap();
        assert_eq!(
            domain_code(&out),
            None,
            "the counter's half-hour booking was refused"
        );
        assert!(!out.operations.is_empty(), "nothing was written");
    }

    /// The declaration opens the MINIMUM notice only: the far end of the window is another
    /// setting with another reason, and it stays where it was.
    #[test]
    fn the_counters_short_notice_does_not_open_the_maximum_advance() {
        let mut payload = item("2026-09-30T10:00:00Z", 30, "s1");
        payload["allow_short_notice"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(60, 30)))).unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_far"));
    }

    /// Nor does it excuse anything after the window: a slot inside the notice AND outside the
    /// opening hours is still refused — now for being shut, the reason that is left.
    #[test]
    fn the_counters_short_notice_does_not_open_the_opening_hours() {
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["allow_short_notice"] = json!(true);
        let mut reads = lead_time(60, 0);
        // Friday 2026-07-31 opens at 16:00 business time; 10:30Z is 12:30 in Madrid.
        reads["schedules.business_hours.list"] = json!([bh(4, "16:00", "20:00")]);
        let out = create_appointment_pure(input(payload, Some(reads))).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// 🔴 whatsapp_inbox#159: an ONLINE booking is the customer's, and the notice is exactly her
    /// window. The WhatsApp automation books through `create` itself, its grant pins
    /// `booked_online: true`, and the AI step gets the whole schema as tool parameters — so a
    /// model that also sends `allow_short_notice` must still meet the notice, whatever it declares.
    #[test]
    fn an_online_booking_cannot_borrow_the_counters_short_notice() {
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["booked_online"] = json!(true);
        payload["allow_short_notice"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(60, 0)))).unwrap();
        assert!(
            out.operations.is_empty(),
            "an online booking landed inside the notice"
        );
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    /// Same wall for the past: the walk-in already in the chair is the counter's word, never an
    /// online booking's.
    #[test]
    fn an_online_booking_cannot_borrow_the_counters_past() {
        let mut payload = item("2026-07-31T09:00:00Z", 30, "s1");
        payload["booked_online"] = json!(true);
        payload["allow_past"] = json!(true);
        let out = create_appointment_pure(input(payload, Some(lead_time(0, 0)))).unwrap();
        assert!(
            out.operations.is_empty(),
            "an online booking booked itself into the past"
        );
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
    }

    // ── appointments#177 · an AUTOMATION is not the counter either ─────────────────────────────
    //
    // The two declarations exist because a person has the agenda in front of them and has seen
    // the warning. A flow the business builds (its AI step gets the whole schema as tool
    // parameters) or an integration behind an API key has nobody there, so it keeps both walls
    // even when it does not mark the booking `booked_online`. The runtime says who is calling:
    // `context.current_user_id` is `flow:<id>` for a flow and `apikey:<id>` for a key.

    /// The same guest input, called by `caller` instead of a person.
    fn called_by(mut input: Value, caller: &str) -> Value {
        input["context"]["current_user_id"] = json!(caller);
        input
    }

    #[test]
    fn a_flow_cannot_borrow_the_counters_short_notice() {
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["allow_short_notice"] = json!(true);
        let out = create_appointment_pure(called_by(
            input(payload, Some(lead_time(60, 0))),
            "flow:f-1",
        ))
        .unwrap();
        assert!(
            out.operations.is_empty(),
            "a flow booked inside the notice"
        );
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    #[test]
    fn a_flow_cannot_borrow_the_counters_past() {
        let mut payload = item("2026-07-31T09:00:00Z", 30, "s1");
        payload["allow_past"] = json!(true);
        let out = create_appointment_pure(called_by(
            input(payload, Some(lead_time(0, 0))),
            "flow:f-1",
        ))
        .unwrap();
        assert!(out.operations.is_empty(), "a flow booked into the past");
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
    }

    #[test]
    fn an_api_key_cannot_borrow_the_counters_short_notice() {
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["allow_short_notice"] = json!(true);
        let out = create_appointment_pure(called_by(
            input(payload, Some(lead_time(60, 0))),
            "apikey:k-1",
        ))
        .unwrap();
        assert!(
            out.operations.is_empty(),
            "an API key booked inside the notice"
        );
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    /// Control: a person of the team (the id the runtime puts for a signed-in user) keeps both
    /// declarations — the wall is for machines, not for the counter.
    #[test]
    fn a_person_of_the_team_still_declares_the_counters_short_notice_and_past() {
        let mut payload = item("2026-07-31T09:00:00Z", 30, "s1");
        payload["allow_past"] = json!(true);
        let out = create_appointment_pure(called_by(
            input(payload, Some(lead_time(0, 0))),
            "0b7c1a52-6f7e-4d1c-9a51-2f0f6f2e8d11",
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "the counter's past booking was refused");
        let mut payload = item("2026-07-31T10:30:00Z", 30, "s1");
        payload["allow_short_notice"] = json!(true);
        let out = create_appointment_pure(called_by(
            input(payload, Some(lead_time(60, 0))),
            "0b7c1a52-6f7e-4d1c-9a51-2f0f6f2e8d11",
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "the counter's short notice was refused");
    }

    // ── appointments#180 · the HUB says who is calling, and only a person gets the counter ──────
    //
    // Since hub#2113 the runtime puts `context.principal` (`human` | `machine`) in every handler
    // context. It is an allow-list: only `human` keeps the two declarations, so a kind of caller
    // the hub grows tomorrow — whatever the shape of its `current_user_id` — is out by default.
    // An older hub that does not send the field falls back to the prefix list of #177.

    /// The same guest input, with the hub telling the handler `principal` about `caller`.
    fn called_by_principal(input: Value, caller: &str, principal: Value) -> Value {
        let mut input = called_by(input, caller);
        input["context"]["principal"] = principal;
        input
    }

    /// A counter booking (past AND short notice) from `caller` / `principal`.
    fn counter_booking_by(caller: &str, principal: Value) -> [Option<String>; 2] {
        let mut past = item("2026-07-31T09:00:00Z", 30, "s1");
        past["allow_past"] = json!(true);
        let past = create_appointment_pure(called_by_principal(
            input(past, Some(lead_time(0, 0))),
            caller,
            principal.clone(),
        ))
        .unwrap();
        let mut soon = item("2026-07-31T10:30:00Z", 30, "s1");
        soon["allow_short_notice"] = json!(true);
        let soon = create_appointment_pure(called_by_principal(
            input(soon, Some(lead_time(60, 0))),
            caller,
            principal,
        ))
        .unwrap();
        [domain_code(&past), domain_code(&soon)]
    }

    const A_PERSON_LIKE_ID: &str = "0b7c1a52-6f7e-4d1c-9a51-2f0f6f2e8d11";
    /// Both walls stood: the past start and the short notice were refused.
    fn refused() -> [Option<String>; 2] {
        [
            Some("appointments.invalid_start".to_string()),
            Some("appointments.too_soon".to_string()),
        ]
    }

    /// 🔴 The relay of the outbox runs a listener with the id of the PERSON who emitted the event,
    /// and the scheduler with an empty id: neither has a `flow:`/`apikey:` shape, both are
    /// machines for the hub. The prefix list let them through; the principal does not.
    #[test]
    fn a_machine_with_a_person_like_id_cannot_borrow_the_counter() {
        assert_eq!(
            counter_booking_by(A_PERSON_LIKE_ID, json!("machine")),
            refused()
        );
        assert_eq!(counter_booking_by("", json!("machine")), refused());
    }

    /// 🔴 Allow-list, not deny-list: a principal the module does not know yet is not a person.
    #[test]
    fn an_unknown_kind_of_caller_cannot_borrow_the_counter() {
        assert_eq!(
            counter_booking_by(A_PERSON_LIKE_ID, json!("service")),
            refused()
        );
        assert_eq!(
            counter_booking_by(A_PERSON_LIKE_ID, json!(true)),
            refused()
        );
    }

    /// Control: the hub says a person is calling → both declarations stand.
    #[test]
    fn a_person_the_hub_vouches_for_keeps_the_counter() {
        assert_eq!(
            counter_booking_by(A_PERSON_LIKE_ID, json!("human")),
            [None, None]
        );
    }

    /// An older hub sends no principal: the prefix list of #177 still keeps flows out and lets the
    /// team in, exactly as before.
    #[test]
    fn without_a_principal_the_prefix_list_still_decides() {
        assert_eq!(counter_booking_by("flow:f-1", Value::Null), refused());
        assert_eq!(
            counter_booking_by(A_PERSON_LIKE_ID, Value::Null),
            [None, None]
        );
    }

    /// The same allow-list on a move through the staff channel of `reschedule`.
    #[test]
    fn a_machine_cannot_borrow_the_counters_short_notice_on_a_move() {
        let out = reschedule_appointment_pure(called_by_principal(
            reschedule_input(
                counter_move_to("2026-07-31T10:30:00Z", false, true),
                booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
                Some(lead_time(60, 0)),
            ),
            A_PERSON_LIKE_ID,
            json!("machine"),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
        assert!(out.operations.is_empty());
    }

    /// Same for a batch item: the batch is not the counter's single booking.
    #[test]
    fn a_batch_item_cannot_borrow_the_counters_short_notice() {
        let mut soon = slot("2026-07-31T10:30:00Z");
        soon["allow_short_notice"] = json!(true);
        let out = bulk_create_pure(batch_input(batch(json!([soon])), Some(lead_time(60, 0))))
            .expect("the batch reports per item, it does not abort");
        assert!(
            out.operations.is_empty(),
            "a batch item booked inside the notice"
        );
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    #[test]
    fn reschedule_refuses_an_appointment_in_a_terminal_state() {
        for status in ["cancelled", "completed", "no_show"] {
            let out = reschedule_appointment_pure(reschedule_input(
                move_to("2026-07-31T15:00:00Z", Some(30)),
                booked_row("2026-07-31T11:00:00Z", 60, status),
                None,
            ))
            .unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.cannot_reschedule"),
                "status {status}"
            );
        }
    }

    #[test]
    fn reschedule_refuses_an_appointment_the_hub_does_not_have() {
        let mut inp = input(move_to("2026-07-31T15:00:00Z", Some(30)), None);
        inp["context"]["reads"]["appointments.appointments.get"] = json!([]);
        let out = reschedule_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.cannot_reschedule")
        );
    }

    #[test]
    fn reschedule_refuses_when_the_settings_read_is_missing() {
        let mut inp = reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        );
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.settings.get");
        let out = reschedule_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.settings_unavailable")
        );
    }

    /// The day read is not filtered by professional (there is no `staff_id` in this payload to
    /// filter by), so the appointment BEING MOVED comes back in it. Colliding with itself would
    /// make every reschedule impossible.
    #[test]
    fn reschedule_does_not_collide_with_itself() {
        let reads = json!({ "appointments.appointments.conflicting": [
            { "id": "apt-old", "appointment_number": "APT-20260731-0001", "staff_id": "s1",
              "status": "confirmed", "start_datetime": "2026-07-31T15:00:00Z",
              "end_datetime": "2026-07-31T16:00:00Z" }
        ]});
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(reads),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    /// Same read, another professional's appointment: not this booking's business.
    #[test]
    fn reschedule_ignores_an_appointment_of_another_professional() {
        let reads = json!({ "appointments.appointments.conflicting": [
            { "id": "a9", "appointment_number": "APT-9", "staff_id": "s2", "status": "confirmed",
              "start_datetime": "2026-07-31T15:00:00Z", "end_datetime": "2026-07-31T16:00:00Z" }
        ]});
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(reads),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    #[test]
    fn reschedule_refuses_an_overlap_with_the_same_professional() {
        let reads = json!({ "appointments.appointments.conflicting": [
            { "id": "a9", "appointment_number": "APT-9", "staff_id": "s1", "status": "confirmed",
              "start_datetime": "2026-07-31T15:15:00Z", "end_datetime": "2026-07-31T16:00:00Z" }
        ]});
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(reads),
        ))
        // appointments#70: moving an appointment onto a taken slot is the same refusal `create`
        // gives, and it answers the same way — leaving it as an `Err` here would have kept the
        // second sniffable prefix alive right next to the one the issue removed.
        .expect("an overlap is a refusal, not a command fault");
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.overlapping_appointment")
        );
        assert!(out.operations.is_empty(), "a refusal moves nothing");
    }

    /// The handler decides with a read and the row is written afterwards, so the check-then-insert
    /// race is still there for everything but overlap — which keeps its SERVER-SIDE gate inside the
    /// same transaction (appointments#20). Moving the command to WASM must not drop it.
    ///
    /// The chain ENDS by draining the gate table (appointments#116): both asserts write a passing
    /// row that would otherwise survive the commit and pile up one reschedule at a time.
    ///
    /// The overlap gate and the history line are statements of `_reschedule_row` itself, not
    /// operations of their own (appointments#196): they find the row by `updated_at = :now`, and the
    /// runtime mints a fresh `:now` for every operation a handler returns.
    #[test]
    fn reschedule_still_runs_the_server_side_overlap_gate_and_the_history() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        let commands = op_commands(&out);
        assert_eq!(
            commands,
            vec![
                "appointments._reschedule_state_assert",
                "appointments._reschedule_row",
                "appointments._gate_clear",
            ]
        );
    }

    // ── appointments#142: whose appointment is being MOVED? ─────────────────────────────────
    //
    // `cancel` learned this in appointments#140 and `reschedule` was left out of that fix, so the
    // other half of the same door stayed open: the payload carried an appointment id and nothing
    // else, and anyone who saw or guessed an id moved a stranger's chair to another hour — she
    // turns up to a slot that no longer exists, the person who really owns it loses hers, and the
    // salon loses the seat. The caller that speaks for a customer (the WhatsApp automation
    // resolves her by phone before it lists anything) must say WHO is asking, and the appointment
    // row decides. Same table of cases #140 left for `cancel`.

    /// The customer `booked_row` links its appointment to.
    const ROW_CUSTOMER: &str = "c1";

    /// The same fixture row, belonging to whoever the case needs (including nobody: a walk-in the
    /// counter typed with no customer attached).
    fn booked_row_of(customer_id: &str, start: &str, minutes: i64, status: &str) -> Value {
        let mut row = booked_row(start, minutes, status);
        row["customer_id"] = json!(customer_id);
        row
    }

    /// A move as an external channel composes it: `channel`, and — on the customer channel — WHO
    /// is asking. `asking_customer: None` is the payload every caller sent before this gate
    /// existed.
    fn move_asked_by(start: &str, channel: Option<&str>, asking_customer: Option<&str>) -> Value {
        let mut p = move_to(start, Some(30));
        if let Some(c) = channel {
            p["channel"] = json!(c);
        }
        if let Some(c) = asking_customer {
            p["customer_id"] = json!(c);
        }
        p
    }

    /// 🔴 The hole: an appointment that belongs to `c1`, a move asked by `cus-eve`. Refused with
    /// its own code, and NOTHING is written — no state assert, no UPDATE, no history line.
    #[test]
    fn reschedule_by_customer_of_someone_elses_appointment_is_refused() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", Some("customer"), Some("cus-eve")),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some(CUSTOMER_MISMATCH),
            "a stranger moved someone else's appointment: {:?}",
            op_commands(&out)
        );
        assert!(
            out.operations.is_empty(),
            "nothing may be written for an appointment that is not the caller's: {:?}",
            op_commands(&out)
        );
    }

    /// The same door with no customer at all: a `channel: customer` payload that names nobody
    /// proves nothing. It is a caller contract bug (the shape of the payload), not a business
    /// refusal — the same treatment as a missing `appointment_id`, and the same `cancel` gives.
    #[test]
    fn reschedule_by_customer_without_saying_who_asks_is_a_payload_error() {
        let err = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", Some("customer"), None),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap_err();
        assert!(err.starts_with("invalid_payload:"), "{err}");
        assert!(err.contains("customer_id"), "{err}");
    }

    /// A walk-in typed at the counter has no customer linked. Nobody can claim it through the
    /// customer channel: the check fails CLOSED, it does not fall through to «no owner, anyone».
    #[test]
    fn reschedule_by_customer_of_an_appointment_with_no_customer_is_refused() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", Some("customer"), Some("cus-eve")),
            booked_row_of("", "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some(CUSTOMER_MISMATCH));
        assert!(out.operations.is_empty());
    }

    /// Her own appointment still moves: the check binds the caller, it does not close the channel.
    #[test]
    fn reschedule_by_customer_of_her_own_appointment_is_allowed() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", Some("customer"), Some(ROW_CUSTOMER)),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            op_commands(&out),
            vec![
                "appointments._reschedule_state_assert",
                "appointments._reschedule_row",
                "appointments._gate_clear",
            ]
        );
    }

    /// The agenda screen is untouched: staff drag a block by id, with no customer in the payload,
    /// on the appointment of whoever. The receptionist owns the agenda — that is her job.
    #[test]
    fn reschedule_by_staff_needs_no_customer_id() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(30)),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            op_commands(&out).first().map(String::as_str),
            Some("appointments._reschedule_state_assert")
        );
    }

    /// A `customer_id` in a STAFF move is not an identity claim and is not checked: the staff
    /// channel never had one, and reading it as one would let a mistyped id start refusing the
    /// receptionist's own moves.
    #[test]
    fn a_customer_id_sent_on_the_staff_reschedule_channel_is_ignored() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", None, Some("cus-eve")),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    // ── appointments#145: the history of a move says WHO asked for it ─────────────────────────
    //
    // `cancel` stamps its channel on the history line (appointments#6); since #142 a move can be
    // asked for on the customer's behalf too, and the trail must tell the counter's move from hers.

    fn history_channel_of(out: &Output) -> Option<Value> {
        ops_named(out, "_reschedule_row")
            .first()
            .and_then(|op| op.params.get("channel").cloned())
    }

    #[test]
    fn the_history_of_a_move_asked_by_the_customer_says_customer() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", Some("customer"), Some(ROW_CUSTOMER)),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(history_channel_of(&out), Some(json!("customer")));
    }

    #[test]
    fn the_history_of_a_move_made_at_the_counter_says_staff() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(30)),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(history_channel_of(&out), Some(json!("staff")));
    }

    /// A channel the contract does not have is a payload bug, not a silent fall back to `staff` —
    /// which is what «anything that is not `customer`» would mean: a typo would reopen the door.
    #[test]
    fn reschedule_with_an_unknown_channel_is_a_payload_error() {
        let err = reschedule_appointment_pure(reschedule_input(
            move_asked_by("2026-07-31T15:00:00Z", Some("whatsapp"), Some("cus-eve")),
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        ))
        .unwrap_err();
        assert!(err.starts_with("invalid_payload:"), "{err}");
        assert!(err.contains("channel"), "{err}");
    }

    // ── appointments#165 / #156 · the counter's declarations reach the MOVE too ───────────────
    //
    // appointments#155 and #157 gave the counter two declarations on `create`: `allow_past` (the
    // walk-in already in the chair) and `allow_short_notice` (the minimum notice is the CUSTOMER's
    // window). Moving an appointment is booking it again, and the panel that moves it is the same
    // counter: the client of 13:00 who arrives early and can be seen in half an hour, or the one
    // who arrived late and was seen at 11:30 instead of 11:00. The customer channel (WhatsApp,
    // appointments#142) keeps both walls: it cannot borrow the counter's declarations.

    fn counter_move_to(start: &str, past: bool, short_notice: bool) -> Value {
        let mut p = move_to(start, Some(30));
        if past {
            p["allow_past"] = json!(true);
        }
        if short_notice {
            p["allow_short_notice"] = json!(true);
        }
        p
    }

    #[test]
    fn the_counter_moves_an_appointment_inside_the_minimum_notice_when_it_declares_it() {
        let out = reschedule_appointment_pure(reschedule_input(
            counter_move_to("2026-07-31T10:30:00Z", false, true),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(60, 0)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        let p = op_params(&out, "_reschedule_row");
        assert_eq!(
            p.get("start_datetime"),
            Some(&json!("2026-07-31T10:30:00+00:00"))
        );
    }

    /// It excuses the MINIMUM notice alone: the maximum advance still judges the move.
    #[test]
    fn the_counters_short_notice_does_not_open_the_maximum_advance_on_a_move() {
        let out = reschedule_appointment_pure(reschedule_input(
            counter_move_to("2026-08-10T10:00:00Z", false, true),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(60, 3)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_far"));
    }

    /// Nor the opening hours: inside the notice AND shut is refused for being shut.
    #[test]
    fn the_counters_short_notice_does_not_open_the_opening_hours_on_a_move() {
        let mut reads = lead_time(60, 0);
        // Friday 2026-07-31 opens at 16:00 business time; 10:30Z is 12:30 in Madrid.
        reads["schedules.business_hours.list"] = json!([bh(4, "16:00", "20:00")]);
        let out = reschedule_appointment_pure(reschedule_input(
            counter_move_to("2026-07-31T10:30:00Z", false, true),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// 🔴 The client moving her own appointment through WhatsApp keeps the notice, whatever keys
    /// the external channel sends along.
    #[test]
    fn the_customer_channel_cannot_borrow_the_counters_short_notice() {
        let mut payload =
            move_asked_by("2026-07-31T10:30:00Z", Some("customer"), Some(ROW_CUSTOMER));
        payload["allow_short_notice"] = json!(true);
        let out = reschedule_appointment_pure(reschedule_input(
            payload,
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(60, 0)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
        assert!(out.operations.is_empty());
    }

    /// appointments#156: the client was seen at 09:30, half an hour ago — the agenda tells the
    /// truth. A start that already happened has nothing to say about the forward window either.
    #[test]
    fn the_counter_moves_an_appointment_to_the_hour_it_was_really_attended() {
        let out = reschedule_appointment_pure(reschedule_input(
            counter_move_to("2026-07-31T09:30:00Z", true, false),
            booked_row("2026-07-31T09:00:00Z", 60, "confirmed"),
            Some(lead_time(60, 0)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        let p = op_params(&out, "_reschedule_row");
        assert_eq!(
            p.get("start_datetime"),
            Some(&json!("2026-07-31T09:30:00+00:00"))
        );
    }

    /// `allow_past` excuses the past and only the past: a start still to come keeps the notice.
    #[test]
    fn the_counters_past_declaration_alone_does_not_open_the_minimum_notice_on_a_move() {
        let out = reschedule_appointment_pure(reschedule_input(
            counter_move_to("2026-07-31T10:30:00Z", true, false),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(60, 0)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
    }

    /// 🔴 Nor can the customer channel move her appointment into yesterday.
    #[test]
    fn the_customer_channel_cannot_borrow_the_counters_past_declaration() {
        let mut payload =
            move_asked_by("2026-07-30T10:00:00Z", Some("customer"), Some(ROW_CUSTOMER));
        payload["allow_past"] = json!(true);
        let out = reschedule_appointment_pure(reschedule_input(
            payload,
            booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(lead_time(0, 0)),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
        assert!(out.operations.is_empty());
    }

    /// appointments#177: a flow granted `reschedule` moves on the staff channel, but it is not
    /// the counter — neither declaration survives it.
    #[test]
    fn a_flow_cannot_borrow_the_counters_short_notice_on_a_move() {
        let out = reschedule_appointment_pure(called_by(
            reschedule_input(
                counter_move_to("2026-07-31T10:30:00Z", false, true),
                booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
                Some(lead_time(60, 0)),
            ),
            "flow:f-1",
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.too_soon"));
        assert!(out.operations.is_empty());
    }

    #[test]
    fn a_flow_cannot_borrow_the_counters_past_on_a_move() {
        let out = reschedule_appointment_pure(called_by(
            reschedule_input(
                counter_move_to("2026-07-31T09:30:00Z", true, false),
                booked_row("2026-07-31T09:00:00Z", 60, "confirmed"),
                Some(lead_time(0, 0)),
            ),
            "flow:f-1",
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.invalid_start")
        );
        assert!(out.operations.is_empty());
    }

    /// A past start still has to fit the agenda: blocked time keeps judging the declared move.
    #[test]
    fn the_counters_past_declaration_does_not_open_blocked_time_on_a_move() {
        let reads = blocks(json!([
            { "id": "b1", "title": "Formación", "staff_id": "s1", "all_day": 0,
              "start_datetime": "2026-07-31T08:00:00Z", "end_datetime": "2026-07-31T10:00:00Z" }
        ]));
        let out = reschedule_appointment_pure(reschedule_input(
            counter_move_to("2026-07-31T09:00:00Z", true, false),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.blocked"));
    }

    /// Identity is decided BEFORE the state, the notice and the agenda, so a stranger's guess
    /// learns the same thing whatever the row says: not yours. Otherwise the refusals themselves
    /// answer «is there an appointment under id X, in what state, and is that hour free?» to
    /// anyone who asks — the probe #140 closed for `cancel`.
    #[test]
    fn a_strangers_guess_never_learns_anything_about_the_appointment_it_tried_to_move() {
        let cases: Vec<(&str, &str, Value, Option<Value>)> = vec![
            // Terminal state → would have been `cannot_reschedule`.
            ("cancelled", "2026-07-31T15:00:00Z", json!(30), None),
            // Inside the minimum notice → would have been `too_soon`.
            (
                "confirmed",
                "2026-07-31T10:30:00Z",
                json!(30),
                Some(lead_time(60, 0)),
            ),
            // Onto a blocked period → would have been `blocked`.
            (
                "confirmed",
                "2026-07-31T15:00:00Z",
                json!(30),
                Some(blocks(json!([
                    { "id": "b1", "title": "Formación", "staff_id": "s1", "all_day": 0,
                      "start_datetime": "2026-07-31T14:00:00Z",
                      "end_datetime": "2026-07-31T18:00:00Z" }
                ]))),
            ),
            // A start that is not an instant → would have been `invalid_start`.
            ("confirmed", "nope", json!(30), None),
        ];
        for (status, start, _minutes, reads) in cases {
            let out = reschedule_appointment_pure(reschedule_input(
                move_asked_by(start, Some("customer"), Some("cus-eve")),
                booked_row_of(ROW_CUSTOMER, "2026-07-31T11:00:00Z", 60, status),
                reads,
            ))
            .unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some(CUSTOMER_MISMATCH),
                "status {status} at {start} leaked a different refusal"
            );
            assert!(out.operations.is_empty(), "status {status} wrote something");
        }
    }

    // ── appointments#10 · a hub that never opened the Settings tab can still book ──

    /// `required: true` makes the runtime ABORT when the query fails, but a query that runs and
    /// returns NO ROWS is not a failure: it is a hub that has not configured its booking policy.
    /// Refusing there would mean a brand new hub cannot book its first appointment — and the DB
    /// defaults are the safe ones (`allow_overlapping = 0`, no lead-time limits). What must never
    /// happen is falling back to `payload.settings`, and that is gone for good.
    #[test]
    fn a_hub_without_a_settings_row_books_with_the_database_defaults() {
        let mut inp = input(item("2026-07-31T11:00:00Z", 30, "s1"), None);
        inp["payload"]["settings"] = json!({ "allow_overlapping": 1, "default_duration": 5 });
        inp["context"]["reads"]["appointments.settings.get"] = json!([]);
        let out = create_appointment_pure(inp).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
    }

    #[test]
    fn a_hub_without_a_settings_row_still_refuses_an_overlap() {
        let mut inp = input(item("2026-07-31T11:00:00Z", 30, "s1"), None);
        inp["payload"]["settings"] = json!({ "allow_overlapping": 1 });
        inp["context"]["reads"]["appointments.settings.get"] = json!([]);
        inp["context"]["reads"]["appointments.appointments.conflicting"] = json!([
            { "id": "a9", "appointment_number": "APT-9", "staff_id": "s1", "status": "confirmed",
              "start_datetime": "2026-07-31T11:15:00Z", "end_datetime": "2026-07-31T12:00:00Z" }
        ]);
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.overlapping_appointment")
        );
    }

    // ── appointments#15 · una serie es TRAZABLE e IDEMPOTENTE ──
    //
    // Una cita materializada no guardaba ningún vínculo con su plantilla: ni la serie ni la
    // ocurrencia. Reejecutar `materialize` DUPLICABA las citas — y materializar es justo lo que se
    // reintenta, porque la ventana avanza cada semana. Y sin ese vínculo una ocurrencia cancelada
    // no podía ser una EXCEPCIÓN de la serie: el siguiente reintento la resucitaba.

    /// The occurrences of the series that are already on the books, as the runtime pre-loads them.
    fn already_booked(dates: Value) -> Value {
        json!({
            "appointments.recurring.occurrences": dates
                .as_array()
                .unwrap()
                .iter()
                .map(|d| json!({ "occurrence_date": d, "status": "confirmed" }))
                .collect::<Vec<_>>()
        })
    }

    #[test]
    fn materialize_stamps_the_series_and_the_occurrence_date_on_every_appointment() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let stamped: Vec<_> = insert_ops(&out)
            .iter()
            .map(|op| {
                (
                    op.params.get("recurring_id").cloned(),
                    op.params.get("occurrence_date").cloned(),
                )
            })
            .collect();
        assert_eq!(
            stamped,
            vec![
                (Some(json!("r1")), Some(json!("2026-08-03"))),
                (Some(json!("r1")), Some(json!("2026-08-10"))),
            ]
        );
    }

    /// The retry is the normal case, not the exception: the window moves forward every week and
    /// somebody presses the button again. What is already on the books is skipped.
    #[test]
    fn materialize_twice_does_not_book_the_same_occurrence_again() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(already_booked(json!(["2026-08-03"]))),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let dates: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("occurrence_date").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(dates, vec!["2026-08-10"]);
    }

    /// Cancelling one appointment of a series is how a business says «not that week». Re-running
    /// the materialization must not undo it — the same answer Google Calendar, Outlook, Fresha and
    /// Square give.
    #[test]
    fn materialize_does_not_resurrect_a_cancelled_occurrence() {
        let mut reads = already_booked(json!(["2026-08-03"]));
        reads["appointments.recurring.occurrences"][0]["status"] = json!("cancelled");
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(reads),
        ))
        .unwrap();
        let dates: Vec<_> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("occurrence_date").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(dates, vec!["2026-08-10"], "the cancelled week came back");
    }

    /// Everything already booked is SUCCESS with nothing to do, not an error: an idempotent
    /// operation that shouts on the second run is one nobody dares to retry.
    #[test]
    fn materialize_with_nothing_left_to_book_succeeds_doing_nothing() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(already_booked(json!(["2026-08-03", "2026-08-10"]))),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert!(out.operations.is_empty());
    }

    /// A guard whose input goes missing closes: without knowing what is already booked, booking
    /// again is exactly the duplication this issue is about.
    #[test]
    fn materialize_refuses_when_the_booked_occurrences_read_is_missing() {
        let mut inp = series_input(series_payload(), json!([template(json!({}))]), None);
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.recurring.occurrences");
        let out = materialize_recurring_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.recurring_unavailable")
        );
    }

    fn event<'a>(out: &'a Output, name: &str) -> Option<&'a erplora_guest_sdk::Event> {
        out.events.iter().find(|e| e.name == name)
    }

    // ── appointments#89 · the business hours are a DOOR, not a hint ────────────────────────────
    //
    // `queries/availability_check.sql` has always computed `outside_schedule`, but a query is
    // ADVISORY: it tells the screen what to grey out, it does not stop anything. Every other way
    // in — the assistant, a flow, `whatsapp_inbox`, the public API — booked at three in the
    // morning and nothing said a word. The check now lives where the decision is made, reading the
    // hub's active timeslots as an AUTHORITATIVE read (ADR-0069), never from the payload.
    //
    // The reason it could not live here before is written two sections down: the timeslots are
    // WALL CLOCK (`HH:MM`, `day_of_week`) and an appointment is an instant. Crossing them needs the
    // business timezone, which the core now hands over in `context.timezone` (hub#1022). Guessing a
    // fixed offset instead is what refuses correct bookings twice a year — hence the DST cases.

    /// 2026-07-31 is a FRIDAY (`day_of_week` 4) and the hub closes at 18:00, so 23:00 is shut.
    #[test]
    fn create_refuses_a_booking_outside_the_business_hours() {
        let out = create_appointment_pure(input(
            item("2026-07-31T23:00:00+02:00", 30, "s1"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
        assert!(out.operations.is_empty());
    }

    /// The same Friday at 15:00 is open, and nothing about this gate may get in the way.
    #[test]
    fn create_accepts_a_booking_inside_the_business_hours() {
        let out = create_appointment_pure(input(
            item("2026-07-31T15:00:00+02:00", 30, "s1"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    /// An appointment that STARTS inside the day but RUNS PAST closing is outside it. The window
    /// is `[start, end]`, the same one `availability_check.sql` compares.
    #[test]
    fn create_refuses_a_booking_that_runs_past_closing_time() {
        let out = create_appointment_pure(input(
            item("2026-07-31T17:45:00+02:00", 30, "s1"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// A day with no timeslot at all is a closed day — Saturday here.
    #[test]
    fn create_refuses_a_booking_on_a_day_the_hub_does_not_open() {
        let out = create_appointment_pure(input(
            item("2026-08-01T11:00:00+02:00", 30, "s1"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// 🔴 THE DEGRADATION THAT MUST NOT BREAK. A hub that has not configured its opening hours
    /// yet cannot be a hub that can no longer book anything — that would turn a new feature into
    /// an outage on day one. No timeslots = every calendar hour counts, which is exactly what
    /// `availability_slots.sql` already does for the screen.
    #[test]
    fn a_hub_with_no_schedule_configured_can_still_book() {
        let out = create_appointment_pure(input(
            item("2026-07-31T23:00:00+02:00", 30, "s1"),
            Some(sched_hours(json!([]))),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    // ── the day the clock changes ──────────────────────────────────────────────────────────────
    //
    // 2026-10-25 is a SUNDAY and the day Madrid goes back from +02:00 to +01:00. Both cases below
    // are the same hub, open 09:00–18:00 on Sundays, and both are decided on the SAME instant a
    // fixed-offset guess would read one hour out.

    /// The one the issue is about: a booking that IS inside the working day. Read with the offset
    /// that was in force when the series was drawn up (+02:00), 16:30 UTC looks like 18:30 — shut —
    /// and a correct booking gets refused. Twice a year, for everybody.
    #[test]
    fn a_booking_on_the_dst_day_is_judged_on_the_business_wall_clock() {
        let out = create_appointment_pure(input(
            item("2026-10-25T17:30:00+01:00", 20, "s1"),
            Some(sched_hours(json!([bh(6, "09:00", "18:00")]))),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    /// And the gate still bites that day: 08:30 on the wall is before opening. Read as +02:00 the
    /// same instant would look like 09:30 and slip through.
    #[test]
    fn the_gate_still_refuses_before_opening_on_the_dst_day() {
        let out = create_appointment_pure(input(
            item("2026-10-25T08:30:00+01:00", 20, "s1"),
            Some(sched_hours(json!([bh(6, "09:00", "18:00")]))),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// Moving an appointment is booking it again: the same door, the same code.
    #[test]
    fn reschedule_refuses_a_slot_outside_the_business_hours() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T23:00:00+02:00", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    #[test]
    fn reschedule_accepts_a_slot_inside_the_business_hours() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-07-31T15:00:00+02:00", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
    }

    /// appointments#89 point 4: an occurrence outside the opening hours is SKIPPED, exactly as a
    /// blocked one already is — a year-long series does not collapse because the salon is shut on
    /// Tuesdays. The template below runs DAILY from Monday 2026-08-03, and the hub opens on
    /// Mondays only, so the first occurrence is booked and the second is quietly left out.
    #[test]
    fn materialize_skips_an_occurrence_outside_the_business_hours_without_aborting() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({ "frequency": "daily", "max_occurrences": 2 }))]),
            Some(sched_hours(json!([bh(0, "09:00", "18:00")]))),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "the series must not be aborted");
        let booked = out
            .operations
            .iter()
            .filter(|op| op.command.ends_with("_insert_appointment"))
            .count();
        assert_eq!(booked, 1, "only the Monday occurrence is inside the hours");
    }

    /// The control for the one above: with the hub open every day, BOTH occurrences are booked.
    /// Without it, «1 booked» would also be the answer to a series that silently stopped working.
    #[test]
    fn materialize_books_every_occurrence_when_the_hub_is_open_all_week() {
        let all_week: Vec<Value> = (0..7).map(|d| bh(d, "09:00", "18:00")).collect();
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({ "frequency": "daily", "max_occurrences": 2 }))]),
            Some(sched_hours(Value::Array(all_week))),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        let booked = out
            .operations
            .iter()
            .filter(|op| op.command.ends_with("_insert_appointment"))
            .count();
        assert_eq!(booked, 2);
    }

    // ── appointments#102 · the opening hours belong to `schedules`, not to us ───────────────────
    //
    // appointments#89 closed the door reading OUR OWN tables (`appointments_schedule*`). The
    // ownership matrix says the authority for «business opening hours» is the `schedules` module,
    // and ADR-0392 made it the single answer of the product to «are we open?». Two places to
    // configure the same thing is the very hub that is open for one module and shut for another.
    //
    // From here the door reads the four published lists of `schedules` and applies its precedence
    // — exact special day > yearly special day > override range > weekly hours > nothing — over
    // the WINDOW of the booking, not over an instant: a booking has to fit WHOLE inside one open
    // interval. Our own timeslots stay as the transitional answer for a hub that has not moved
    // its hours yet (see the fallback case below), never as a second opinion when `schedules`
    // has any rule of its own.

    /// One weekly opening interval as `schedules.business_hours.list` publishes it.
    fn bh(dow: i64, open: &str, close: &str) -> Value {
        json!({ "id": format!("bh-{dow}-{open}"), "day_of_week": dow, "position": 0,
                "open_time": open, "close_time": close, "is_closed": 0,
                "break_start": null, "break_end": null })
    }

    /// Monday–Friday 09:00–18:00 — the shape of nearly every salon's week, as
    /// `schedules.business_hours.list` publishes it.
    fn sched_weekdays_nine_to_six() -> Value {
        Value::Array((0..5).map(|d| bh(d, "09:00", "18:00")).collect())
    }

    /// The four reads of `schedules` the runtime pre-loads for the booking commands — the only
    /// hours the gate has consulted since appointments#118.
    fn with_schedules(
        hours: Value,
        special_days: Value,
        overrides: Value,
        intervals: Value,
    ) -> Value {
        let mut reads = lead_time(0, 0);
        reads["schedules.business_hours.list"] = hours;
        reads["schedules.special_days.list"] = special_days;
        reads["schedules.overrides.list"] = overrides;
        reads["schedules.exception_intervals.list"] = intervals;
        reads
    }

    /// Only the weekly hours; no exception of any kind.
    fn sched_hours(hours: Value) -> Value {
        with_schedules(hours, json!([]), json!([]), json!([]))
    }

    /// 🔴 THE SYMPTOM OF THE ISSUE. The salon declared Christmas closed in `schedules` — the
    /// authority every other module asks. The door read our own (empty) timeslots, decided the
    /// hub had not configured anything, and booked a haircut on Christmas Day.
    #[test]
    fn create_refuses_a_booking_on_a_holiday_declared_in_schedules() {
        let out = create_appointment_pure(input(
            item("2026-12-25T11:00:00+01:00", 30, "s1"),
            Some(with_schedules(
                sched_weekdays_nine_to_six(),
                json!([{ "id": "sd-xmas", "date": "2026-12-25", "name": "Navidad",
                         "is_closed": 1, "recurring_yearly": 0 }]),
                json!([]),
                json!([]),
            )),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
        assert!(out.operations.is_empty());
    }

    /// The control for the one above: the SAME Friday without the special day is open at 11:00,
    /// so the refusal really comes from the holiday and not from the weekly hours.
    #[test]
    fn create_accepts_the_same_day_when_no_holiday_is_declared() {
        let out = create_appointment_pure(input(
            item("2026-12-25T11:00:00+01:00", 30, "s1"),
            Some(sched_hours(sched_weekdays_nine_to_six())),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    /// A yearly special day (Christmas is the same date every year) closes the date whatever the
    /// year of the row — `recurring_yearly` matches on MM-DD, exactly as `schedules.is_open`.
    #[test]
    fn a_yearly_special_day_closes_the_same_date_in_another_year() {
        let out = create_appointment_pure(input(
            item("2026-12-25T11:00:00+01:00", 30, "s1"),
            Some(with_schedules(
                sched_weekdays_nine_to_six(),
                json!([{ "id": "sd-xmas", "date": "2020-12-25", "name": "Navidad",
                         "is_closed": 1, "recurring_yearly": 1 }]),
                json!([]),
                json!([]),
            )),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// An exact-date special day BEATS a yearly one, the precedence ADR-0392 fixed: the salon
    /// opens a reduced shift on the 24th even though a yearly rule closes that date.
    #[test]
    fn an_exact_special_day_beats_the_yearly_one() {
        let reads = with_schedules(
            sched_weekdays_nine_to_six(),
            json!([
                { "id": "sd-year", "date": "2020-12-24", "name": "Nochebuena",
                  "is_closed": 1, "recurring_yearly": 1 },
                { "id": "sd-exact", "date": "2026-12-24", "name": "Nochebuena 2026",
                  "is_closed": 0, "open_time": "09:00", "close_time": "14:00",
                  "recurring_yearly": 0 }
            ]),
            json!([]),
            json!([]),
        );
        // 2026-12-24 is a Thursday; the exact row opens 09:00–14:00.
        let out = create_appointment_pure(input(
            item("2026-12-24T10:00:00+01:00", 30, "s1"),
            Some(reads.clone()),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "the exact row opens the morning");

        let out = create_appointment_pure(input(
            item("2026-12-24T15:00:00+01:00", 30, "s1"),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule"),
            "and it closes at 14:00, so the afternoon is out"
        );
    }

    /// A special day that opens with SPLIT intervals (`schedules.exception_intervals.list`,
    /// schedules#23): the gap between the two shifts is shut.
    #[test]
    fn a_special_day_with_split_intervals_shuts_the_gap_between_them() {
        let reads = with_schedules(
            sched_weekdays_nine_to_six(),
            json!([{ "id": "sd-fair", "date": "2026-12-25", "name": "Feria",
                     "is_closed": 0, "recurring_yearly": 0 }]),
            json!([]),
            json!([
                { "id": "ei-1", "exception_kind": "special_day", "exception_id": "sd-fair",
                  "position": 0, "open_time": "09:00", "close_time": "12:00" },
                { "id": "ei-2", "exception_kind": "special_day", "exception_id": "sd-fair",
                  "position": 1, "open_time": "17:00", "close_time": "20:00" }
            ]),
        );
        let out = create_appointment_pure(input(
            item("2026-12-25T17:30:00+01:00", 30, "s1"),
            Some(reads.clone()),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "the evening shift is open");

        let out = create_appointment_pure(input(
            item("2026-12-25T14:00:00+01:00", 30, "s1"),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule"),
            "and the gap between the two shifts is not"
        );
    }

    /// A closed override range (the salon shuts for the summer break) refuses every day inside it.
    #[test]
    fn a_closed_override_range_refuses_the_whole_range() {
        let out = create_appointment_pure(input(
            item("2026-08-12T11:00:00+02:00", 30, "s1"),
            Some(with_schedules(
                sched_weekdays_nine_to_six(),
                json!([]),
                json!([{ "id": "ov-1", "start_date": "2026-08-10", "end_date": "2026-08-20",
                         "reason": "Vacaciones", "is_closed": 1 }]),
                json!([]),
            )),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// The lunch break of a weekly interval is CLOSED time: a booking that lands on it, or that
    /// runs into it, does not fit. `schedules.is_open` answers `on_break` for the same minutes.
    #[test]
    fn the_lunch_break_of_the_weekly_hours_is_closed_time() {
        let with_break = json!([{ "id": "bh-fri", "day_of_week": 4, "position": 0,
                                  "open_time": "09:00", "close_time": "18:00", "is_closed": 0,
                                  "break_start": "14:00", "break_end": "16:00" }]);
        let out = create_appointment_pure(input(
            item("2026-07-31T14:30:00+02:00", 30, "s1"),
            Some(sched_hours(with_break.clone())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule"),
            "inside the break"
        );

        let out = create_appointment_pure(input(
            item("2026-07-31T13:45:00+02:00", 30, "s1"),
            Some(sched_hours(with_break.clone())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule"),
            "and a booking that runs INTO the break does not fit either"
        );

        let out = create_appointment_pure(input(
            item("2026-07-31T16:30:00+02:00", 30, "s1"),
            Some(sched_hours(with_break)),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "after the break it is open again");
    }

    /// A weekday with a row marked `is_closed` is shut, even though the row carries hours.
    #[test]
    fn a_weekday_marked_closed_in_schedules_is_shut() {
        let out = create_appointment_pure(input(
            item("2026-07-31T15:00:00+02:00", 30, "s1"),
            Some(sched_hours(
                json!([{ "id": "bh-fri", "day_of_week": 4, "position": 0,
                         "open_time": "09:00", "close_time": "18:00", "is_closed": 1 }]),
            )),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// An overnight interval (`close_time < open_time`) is a real shift, not a typo: a bar open
    /// Friday 20:00–02:00 can take a booking at 00:30 on SATURDAY, which belongs to Friday's
    /// interval. Our own timeslots could never express it — a booking that left its weekday was
    /// simply refused.
    #[test]
    fn an_overnight_interval_takes_a_booking_past_midnight() {
        let overnight = json!([bh(4, "20:00", "02:00")]);
        let out = create_appointment_pure(input(
            item("2026-08-01T00:30:00+02:00", 30, "s1"),
            Some(sched_hours(overnight.clone())),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out),
            None,
            "00:30 on Saturday is inside Friday's overnight shift"
        );

        let out = create_appointment_pure(input(
            item("2026-08-01T03:00:00+02:00", 30, "s1"),
            Some(sched_hours(overnight)),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule"),
            "03:00 is past closing and Saturday has no hours of its own"
        );
    }

    /// `00:00–00:00` is «open 24 hours» (the representation of Google Business Profile that
    /// schedules#8 adopted), not an empty interval.
    #[test]
    fn a_24_hour_interval_is_open_all_day() {
        let out = create_appointment_pure(input(
            item("2026-07-31T23:00:00+02:00", 30, "s1"),
            Some(sched_hours(json!([bh(4, "00:00", "00:00")]))),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
    }

    /// 🔴 THE DST CASES, on the authority's rules now. 2026-10-25 is the Sunday Madrid goes back
    /// to +01:00. Read with the offset that was in force the day the hours were written (+02:00)
    /// the same instant looks one hour off, and a correct booking gets refused twice a year.
    #[test]
    fn the_schedules_gate_is_judged_on_the_business_wall_clock_on_the_dst_day() {
        let sunday = json!([bh(6, "09:00", "18:00")]);
        let out = create_appointment_pure(input(
            item("2026-10-25T17:30:00+01:00", 20, "s1"),
            Some(sched_hours(sunday.clone())),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "17:30 on the wall is inside");

        let out = create_appointment_pure(input(
            item("2026-10-25T08:30:00+01:00", 20, "s1"),
            Some(sched_hours(sunday)),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule"),
            "and 08:30 is still before opening"
        );
    }

    /// 🔴 THE SYMPTOM OF appointments#118. Our own timetable has had no screen to write it
    /// since appointments#117, and `schedules` seeds a whole week the moment it is installed
    /// (schedules#36), so whatever those rows still hold is a leftover nobody can see or edit.
    /// Letting them refuse a booking is a rejection the salon cannot explain with anything it has
    /// configured. They decide nothing any more: with no rule in the authority, every calendar
    /// hour is bookable, exactly as it already is for a hub whose own rows are empty.
    #[test]
    fn the_gate_ignores_the_modules_own_timetable() {
        let mut reads = with_schedules(json!([]), json!([]), json!([]), json!([]));
        // Monday–Friday 09:00–18:00 in the shape the retired read published. Written out and not
        // built from a helper on purpose: the helper went with the read, and a guard that plants
        // the old rows by hand keeps biting even if somebody wires that query back in.
        reads["appointments.schedules.active_timeslots"] = Value::Array(
            (0..5)
                .map(|d| json!({ "day_of_week": d, "start_time": "09:00", "end_time": "18:00" }))
                .collect(),
        );

        let out = create_appointment_pure(input(
            item("2026-07-31T23:00:00+02:00", 30, "s1"),
            Some(reads),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out),
            None,
            "a leftover row of our own timetable must not shut the night"
        );
    }

    /// The four reads are `required` in the manifest. If one does not arrive the answer is a
    /// refusal, never an open door — the same rule as every other guard of this module.
    #[test]
    fn create_refuses_when_a_schedules_read_is_missing() {
        for missing in [
            "schedules.business_hours.list",
            "schedules.special_days.list",
            "schedules.overrides.list",
            "schedules.exception_intervals.list",
        ] {
            let mut inp = input(
                item("2026-07-31T15:00:00+02:00", 30, "s1"),
                Some(sched_hours(sched_weekdays_nine_to_six())),
            );
            inp["context"]["reads"]
                .as_object_mut()
                .expect("reads is an object")
                .remove(missing);
            let out = create_appointment_pure(inp).unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.availability_unavailable"),
                "removing {missing} must fail closed"
            );
        }
    }

    /// Moving an appointment is booking it again: the same door, the same authority.
    #[test]
    fn reschedule_reads_the_schedules_authority_too() {
        let out = reschedule_appointment_pure(reschedule_input(
            move_to("2026-12-25T11:00:00+01:00", Some(30)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            Some(with_schedules(
                sched_weekdays_nine_to_six(),
                json!([{ "id": "sd-xmas", "date": "2026-12-25", "name": "Navidad",
                         "is_closed": 1, "recurring_yearly": 0 }]),
                json!([]),
                json!([]),
            )),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.outside_schedule")
        );
    }

    /// A series skips the occurrences the authority shuts, exactly as it already skips the ones
    /// outside our own timeslots — a year of appointments does not collapse because one date is
    /// a bank holiday. The template runs DAILY from Monday 2026-08-03 and 2026-08-04 is closed.
    #[test]
    fn materialize_skips_an_occurrence_on_a_schedules_holiday() {
        let all_week: Vec<Value> = (0..7).map(|d| bh(d, "09:00", "18:00")).collect();
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({ "frequency": "daily", "max_occurrences": 2 }))]),
            Some(with_schedules(
                Value::Array(all_week),
                json!([{ "id": "sd-1", "date": "2026-08-04", "name": "Festivo local",
                         "is_closed": 1, "recurring_yearly": 0 }]),
                json!([]),
                json!([]),
            )),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None, "the series must not be aborted");
        let booked = out
            .operations
            .iter()
            .filter(|op| op.command.ends_with("_insert_appointment"))
            .count();
        assert_eq!(booked, 1, "only the Monday occurrence survives the holiday");
    }

    // ── appointments#105: the SCREEN asks the DOOR ──────────────────────────────────────────
    //
    // appointments#102 moved the opening-hours authority to `schedules` for every command that
    // WRITES a slot, but `queries/availability_slots.sql` kept filtering by the module's OWN
    // tables — which SQL cannot swap, because a query of this module may only name this module's
    // tables. For the normal hub after #102 (hours in `schedules`, our timeslots empty) that
    // filter matches nothing, so the list offered 08:00 to a salon that opens at 10:00 and
    // `create` refused it a click later with `appointments.outside_schedule`.
    //
    // `day_opening` closes it without a second implementation of anything: it is the SAME
    // `schedules_opening` the door runs, exposed for ONE date, so the screen filters by exactly
    // what the gate will accept. `source` says who answered — `schedules` (filter by `spans`,
    // empty = the date is shut) or `own` (the authority is silent, the SQL already applied our
    // legacy timeslots and the screen must not filter again).

    /// Minutes-from-midnight pairs of the answer, so a test reads like the span it means.
    fn spans_of(out: &Output) -> Vec<(i64, i64)> {
        out.result
            .as_ref()
            .and_then(|r| r.get("spans"))
            .and_then(|v| v.as_array())
            .expect("day_opening answers with spans")
            .iter()
            .map(|s| (as_i64(&s["start_minute"], -1), as_i64(&s["end_minute"], -1)))
            .collect()
    }

    fn source_of(out: &Output) -> String {
        out.result
            .as_ref()
            .and_then(|r| r.get("source"))
            .map(as_str)
            .unwrap_or_default()
    }

    fn day_opening_input(date: &str, reads: Value) -> Value {
        json!({
            "payload": { "date": date },
            "context": { "hub_id": "h1", "now": "2026-07-01T08:00:00Z", "new_ids": [],
                         "timezone": "Europe/Madrid", "reads": reads }
        })
    }

    /// 2026-07-27 is a MONDAY. The authority opens 09:00–18:00, so that is what the screen has to
    /// offer — in the same units the gate compares, minutes from the date's own midnight.
    #[test]
    fn day_opening_answers_the_stretches_schedules_resolves_for_the_date() {
        let out = day_opening_pure(day_opening_input(
            "2026-07-27",
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        assert_eq!(source_of(&out), "schedules");
        assert_eq!(spans_of(&out), vec![(9 * 60, 18 * 60)]);
    }

    /// A break is CLOSED time inside the stretch, so the day comes back in two pieces — the same
    /// carving `schedule_refusal` does, which is why a booking that merely RUNS INTO the break
    /// stops being offered instead of being offered and then refused.
    #[test]
    fn day_opening_carves_the_break_out_of_the_day() {
        let hours = json!([json!({ "id": "bh-lunch", "day_of_week": 0, "position": 0,
                                   "open_time": "09:00", "close_time": "18:00", "is_closed": 0,
                                   "break_start": "14:00", "break_end": "16:00" })]);
        let out = day_opening_pure(day_opening_input("2026-07-27", sched_hours(hours))).unwrap();
        assert_eq!(spans_of(&out), vec![(9 * 60, 14 * 60), (16 * 60, 18 * 60)]);
    }

    /// The authority shuts the date (a closed special day). `source` still says `schedules` — the
    /// screen has to show NO hours, which is a very different answer from «nobody said anything».
    #[test]
    fn day_opening_says_shut_with_no_stretches_when_the_authority_closes_the_date() {
        let out = day_opening_pure(day_opening_input(
            "2026-12-25",
            with_schedules(
                sched_weekdays_nine_to_six(),
                json!([{ "id": "sd-xmas", "date": "2026-12-25", "name": "Navidad",
                         "is_closed": 1, "recurring_yearly": 0 }]),
                json!([]),
                json!([]),
            ),
        ))
        .unwrap();
        assert_eq!(source_of(&out), "schedules");
        assert_eq!(spans_of(&out), Vec::<(i64, i64)>::new());
    }

    /// The authority carries no rule that reaches the date, so the gate refuses nothing and the
    /// screen must NOT filter: saying `unset` with no spans is what keeps a hub with no hours
    /// seeing the whole day it can actually book (appointments#118).
    #[test]
    fn day_opening_hands_the_date_back_when_the_authority_is_silent() {
        let reads = with_schedules(json!([]), json!([]), json!([]), json!([]));
        let out = day_opening_pure(day_opening_input("2026-07-27", reads)).unwrap();
        assert_eq!(source_of(&out), "unset");
        assert_eq!(spans_of(&out), Vec::<(i64, i64)>::new());
    }

    /// Missing read = refusal, never an open door — the same rule the gate obeys. A screen that
    /// silently stops filtering because a read went missing is the optimistic list all over again.
    #[test]
    fn day_opening_refuses_when_a_schedules_read_is_missing() {
        for missing in [
            "schedules.business_hours.list",
            "schedules.special_days.list",
            "schedules.overrides.list",
            "schedules.exception_intervals.list",
        ] {
            let mut reads = sched_hours(sched_weekdays_nine_to_six());
            reads.as_object_mut().unwrap().remove(missing);
            let out = day_opening_pure(day_opening_input("2026-07-27", reads)).unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.availability_unavailable"),
                "{missing} missing must refuse"
            );
        }
    }

    /// A date the handler cannot read is a refusal too, not «everything is open». The schema
    /// already pins the shape at the door; this is the guard behind it.
    #[test]
    fn day_opening_refuses_a_date_it_cannot_read() {
        for bad in ["", "tomorrow", "2026-13-40"] {
            let out = day_opening_pure(day_opening_input(
                bad,
                sched_hours(sched_weekdays_nine_to_six()),
            ))
            .unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.invalid_start"),
                "`{bad}` must be refused"
            );
        }
    }

    /// 🔒 THE REGRESSION GUARD of appointments#105. The whole point of the command is that the
    /// screen and the door cannot drift apart, so this walks a whole Monday half hour by half
    /// hour and demands the SAME verdict from both: every window `day_opening` reports as inside
    /// a stretch is one the gate lets through, and every one it leaves out is one the gate
    /// refuses with `appointments.outside_schedule`. If somebody ever changes one side only, this
    /// fails. The date is 2026-08-03 — a Monday AHEAD of the tests' `now`, so the only rule that
    /// can speak here is the opening hours one.
    #[test]
    fn day_opening_accepts_exactly_what_the_door_accepts() {
        let hours = json!([json!({ "id": "bh-lunch", "day_of_week": 0, "position": 0,
                                   "open_time": "09:00", "close_time": "18:00", "is_closed": 0,
                                   "break_start": "14:00", "break_end": "16:00" })]);
        let reads = sched_hours(hours);
        let spans =
            spans_of(&day_opening_pure(day_opening_input("2026-08-03", reads.clone())).unwrap());
        assert!(!spans.is_empty(), "the fixture has to open the day");

        let mut offered_any = false;
        for half_hour in 0..47 {
            let start_min = half_hour * 30;
            let end_min = start_min + 30;
            let offered = spans
                .iter()
                .any(|(from, to)| *from <= start_min && end_min <= *to);
            offered_any |= offered;

            let at = format!(
                "2026-08-03T{:02}:{:02}:00+02:00",
                start_min / 60,
                start_min % 60
            );
            let out =
                create_appointment_pure(input(item(&at, 30, "s1"), Some(reads.clone()))).unwrap();
            let shut = domain_code(&out).as_deref() == Some("appointments.outside_schedule");

            assert_eq!(
                offered, !shut,
                "the screen and the door disagree at {at}: offered={offered}, gate shut={shut}"
            );
        }
        assert!(offered_any, "a walk where nothing is ever offered proves nothing");
    }

    // ── appointments#122 · the ENGINE answers the hours too, or it lies ────────────────────────
    //
    // «Is Tuesday at 8 free?» came back FREE from a salon that opens at 9, and the caller only
    // found out one click later, when `create` refused. The screen had papered over it by asking
    // `day_opening` separately and filtering itself (appointments#105), but that is the screen's
    // patch, not the engine's answer: the assistant, a flow, an integration and the public API all
    // read `available` and believed it.
    //
    // The engine now answers through the handler, exactly like the door: `availability_check.sql`
    // keeps the verdicts built on tables THIS module owns (notice, blocks, overlaps) and
    // the handler adds the one it does not — the hours, from `schedules`, through the very
    // function the gate runs. The order is the gate's, not the query's convenience.

    /// The engine's own rules, as `queries/availability_check.sql` answers them.
    fn own_rules(available: i64, reason: &str) -> Value {
        json!([{ "available": available, "reason": reason }])
    }

    fn check_input(start: &str, rules: Value, reads: Value) -> Value {
        let mut merged = reads;
        merged["appointments.availability.own_rules"] = rules;
        // appointments#98: required like the rest; a day nobody's template governs refuses nothing.
        if merged.get(STAFF_DAY_READ).is_none() {
            merged[STAFF_DAY_READ] = json!([{ "kind": "day", "day": "2026-07-31",
                "schedule_id": null, "start_time": null, "end_time": null, "is_full_day": 0 }]);
        }
        json!({
            "payload": { "start_datetime": start, "duration_minutes": 30, "staff_id": "s1" },
            "context": { "hub_id": "h1", "now": "2026-07-01T08:00:00Z", "new_ids": [],
                         "timezone": "Europe/Madrid", "reads": merged }
        })
    }

    /// `(available, reason)` as the caller reads them off the answer.
    fn verdict_of(out: &Output) -> (i64, String) {
        let result = out.result.clone().unwrap_or(Value::Null);
        (
            result.get("available").map(|v| as_i64(v, -1)).unwrap_or(-1),
            result.get("reason").map(as_str).unwrap_or_default(),
        )
    }

    /// 🔴 THE SYMPTOM OF THE ISSUE. 2026-07-31 is a FRIDAY and the salon closes at 18:00. Nothing
    /// this module owns objects to 23:00 — no block, no appointment — so the SQL says
    /// FREE, and that is the answer that used to reach the assistant.
    #[test]
    fn check_says_outside_schedule_when_the_business_is_shut() {
        let out = check_availability_pure(check_input(
            "2026-07-31T23:00:00+02:00",
            own_rules(1, ""),
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        assert_eq!(verdict_of(&out), (0, "outside_schedule".to_string()));
    }

    /// The same Friday at 15:00 is open, and the engine must not invent a refusal there.
    #[test]
    fn check_keeps_the_hour_available_when_the_business_is_open() {
        let out = check_availability_pure(check_input(
            "2026-07-31T15:00:00+02:00",
            own_rules(1, ""),
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        assert_eq!(verdict_of(&out), (1, String::new()));
    }

    /// The hours do not overwrite what the SQL already refused BEFORE them in the gate's order:
    /// `lead_time_refusal` runs before `schedule_refusal`, so a slot that is both too soon and
    /// shut comes back `too_soon` — the same word `create` would answer.
    #[test]
    fn check_keeps_a_refusal_the_door_ranks_above_the_hours() {
        for reason in ["invalid_start", "too_soon", "too_far"] {
            let out = check_availability_pure(check_input(
                "2026-07-31T23:00:00+02:00",
                own_rules(0, reason),
                sched_hours(sched_weekdays_nine_to_six()),
            ))
            .unwrap();
            assert_eq!(verdict_of(&out), (0, reason.to_string()));
        }
    }

    /// …and it DOES overwrite the ones the gate ranks below: the door checks the hours before the
    /// blocked time and the overlap, so a shut hour is `outside_schedule` even when the
    /// agenda has something else to say about it.
    #[test]
    fn check_ranks_the_hours_above_the_refusals_the_door_ranks_lower() {
        for reason in ["blocked", "overlap"] {
            let out = check_availability_pure(check_input(
                "2026-07-31T23:00:00+02:00",
                own_rules(0, reason),
                sched_hours(sched_weekdays_nine_to_six()),
            ))
            .unwrap();
            assert_eq!(
                verdict_of(&out),
                (0, "outside_schedule".to_string()),
                "the door refuses {reason} with outside_schedule first"
            );
        }
    }

    /// A hub that has configured no hours anywhere books at any hour — the same answer the door
    /// gives, and for the same reason: «I have not set my hours yet» must not read as «I cannot
    /// take bookings».
    #[test]
    fn check_leaves_every_hour_available_when_no_hours_are_configured() {
        let out = check_availability_pure(check_input(
            "2026-07-31T23:00:00+02:00",
            own_rules(1, ""),
            sched_hours(json!([])),
        ))
        .unwrap();
        assert_eq!(verdict_of(&out), (1, String::new()));
    }

    /// Missing read = refusal, never an open door. Both halves: the authority's lists and the
    /// module's own engine.
    #[test]
    fn check_refuses_when_a_read_it_needs_did_not_arrive() {
        let mut reads = sched_hours(sched_weekdays_nine_to_six());
        reads.as_object_mut().unwrap().remove("schedules.special_days.list");
        let out = check_availability_pure(check_input(
            "2026-07-31T15:00:00+02:00",
            own_rules(1, ""),
            reads,
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );

        let mut without_engine = check_input(
            "2026-07-31T15:00:00+02:00",
            own_rules(1, ""),
            sched_hours(sched_weekdays_nine_to_six()),
        );
        without_engine["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.availability.own_rules");
        let out = check_availability_pure(without_engine).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );
    }

    /// 🔒 THE REGRESSION GUARD. Half-hour by half-hour, what the engine calls unavailable-because-
    /// shut is exactly what the door refuses with `appointments.outside_schedule`. This is the
    /// pair appointments#122 exists to close: the engine saying «free» about an hour the door will
    /// refuse is the whole defect, and a walk is the only shape that cannot pass by accident.
    #[test]
    fn check_and_the_door_agree_on_the_hours_hour_by_hour() {
        let hours = json!([json!({ "id": "bh-lunch", "day_of_week": 0, "position": 0,
                                   "open_time": "09:00", "close_time": "18:00", "is_closed": 0,
                                   "break_start": "14:00", "break_end": "16:00" })]);
        let reads = sched_hours(hours);
        let mut shut_somewhere = false;
        let mut open_somewhere = false;
        for half_hour in 0..47 {
            let start_min = half_hour * 30;
            let at = format!(
                "2026-08-03T{:02}:{:02}:00+02:00",
                start_min / 60,
                start_min % 60
            );

            let engine = check_availability_pure(check_input(
                &at,
                own_rules(1, ""),
                reads.clone(),
            ))
            .unwrap();
            let engine_shut = verdict_of(&engine) == (0, "outside_schedule".to_string());

            let door = create_appointment_pure(input(item(&at, 30, "s1"), Some(reads.clone())))
                .unwrap();
            let door_shut =
                domain_code(&door).as_deref() == Some("appointments.outside_schedule");

            shut_somewhere |= door_shut;
            open_somewhere |= !door_shut;
            assert_eq!(
                engine_shut, door_shut,
                "the engine and the door disagree at {at}: engine shut={engine_shut}, \
                 door shut={door_shut}"
            );
        }
        assert!(
            shut_somewhere && open_somewhere,
            "a walk where the day is all open or all shut proves nothing"
        );
    }
    // ── appointments#127 · the LIST answers the hours too, or it lies ──────────────────────────
    //
    // appointments#122 closed the question about ONE hour; this is the one that gets asked all
    // day. «What slots do I have on Sunday?» came back with the whole calendar day of a salon
    // that does not open on Sundays, and so did the lunch break and the hour before opening. The
    // screen papered over it by asking `day_opening` separately and filtering itself
    // (appointments#105) — the screen's patch, not the engine's answer: the assistant, a flow, an
    // integration and the public API read the list and believed it.
    //
    // `queries/availability_slots.sql` cannot fix it: the hours belong to `schedules` (ADR-0392)
    // and a query of this module may only name this module's tables. So the SQL keeps every
    // verdict built on tables this module owns and arrives as the read
    // `appointments.availability.own_slots`; the hours are carved out HERE, with the very
    // `schedules_opening` the door runs.

    /// One row as `queries/availability_slots.sql` returns it: the naive wall pair plus the
    /// `HH:MM` pair the caller reads.
    fn own_slot(date: &str, start_min: i64, dur: i64) -> Value {
        let hhmm = |m: i64| format!("{:02}:{:02}", m / 60, m % 60);
        let (from, to) = (hhmm(start_min), hhmm(start_min + dur));
        json!({
            "slot_start": format!("{date}T{from}:00"),
            "slot_end": format!("{date}T{to}:00"),
            "start_time": from,
            "end_time": to,
        })
    }

    /// The whole calendar day the SQL generates with the hub defaults (08:00–20:00, step 15) for
    /// a 30-minute service — every candidate, hours not yet applied. This is exactly the list the
    /// issue measured: 45 slots offered on a Sunday the salon is shut.
    fn own_slots_calendar_day(date: &str, dur: i64) -> Value {
        let mut rows = Vec::new();
        let mut m = 8 * 60;
        while m + dur <= 20 * 60 {
            rows.push(own_slot(date, m, dur));
            m += 15;
        }
        Value::Array(rows)
    }

    fn slots_input(date: &str, own: Value, reads: Value) -> Value {
        let mut merged = reads;
        merged["appointments.availability.own_slots"] = own;
        json!({
            "payload": { "date": date, "duration_minutes": 30, "staff_id": "s1" },
            "context": { "hub_id": "h1", "now": "2026-07-01T08:00:00Z", "new_ids": [],
                         "timezone": "Europe/Madrid", "reads": merged }
        })
    }

    /// The `HH:MM` starts the caller ends up seeing, read off the very envelope it reads today.
    fn offered(out: &Output) -> Vec<String> {
        out.result
            .as_ref()
            .and_then(|r| r.get("rows"))
            .and_then(|v| v.as_array())
            .expect("the list answers with rows")
            .iter()
            .map(|row| as_str(&row["start_time"]))
            .collect()
    }

    /// 🔴 THE SYMPTOM OF THE ISSUE. 2026-08-30 is a SUNDAY and the salon works Monday to Friday.
    /// Nothing this module owns objects to any of those hours — no block, no appointment
    /// — so the SQL offers the whole calendar day, and that is the list that used to reach the
    /// assistant, a flow and the public API.
    #[test]
    fn slots_offers_nothing_on_a_day_the_authority_shuts() {
        let out = available_slots_pure(slots_input(
            "2026-08-30",
            own_slots_calendar_day("2026-08-30", 30),
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        assert_eq!(offered(&out), Vec::<String>::new());
    }

    /// The Monday of that same week is open 09:00–18:00, so the calendar hours outside it go and
    /// the ones inside it stay — including the last one that FITS WHOLE (17:30–18:00) and not the
    /// one that would run past closing (17:45–18:15).
    #[test]
    fn slots_keeps_only_the_hours_inside_the_open_stretches() {
        let out = available_slots_pure(slots_input(
            "2026-08-31",
            own_slots_calendar_day("2026-08-31", 30),
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        let times = offered(&out);
        assert_eq!(times.first().map(String::as_str), Some("09:00"));
        assert_eq!(times.last().map(String::as_str), Some("17:30"));
        for gone in ["08:00", "08:45", "17:45", "18:00"] {
            assert!(!times.iter().any(|t| t == gone), "{gone} is outside 09:00-18:00");
        }
    }

    /// A break is CLOSED time inside the stretch, so the list loses the hours that run into it —
    /// the same carving the door does, which is why 13:45 stops being offered instead of being
    /// offered and then refused.
    #[test]
    fn slots_carves_the_break_out_of_the_day() {
        let hours = json!([json!({ "id": "bh-lunch", "day_of_week": 0, "position": 0,
                                   "open_time": "09:00", "close_time": "18:00", "is_closed": 0,
                                   "break_start": "14:00", "break_end": "16:00" })]);
        let out = available_slots_pure(slots_input(
            "2026-08-31",
            own_slots_calendar_day("2026-08-31", 30),
            sched_hours(hours),
        ))
        .unwrap();
        let times = offered(&out);
        for kept in ["13:30", "16:00"] {
            assert!(times.iter().any(|t| t == kept), "{kept} fits whole inside a stretch");
        }
        for gone in ["13:45", "14:00", "15:30"] {
            assert!(!times.iter().any(|t| t == gone), "{gone} runs into the break");
        }
    }

    /// A hub that has configured no hours anywhere books at any hour, so the list must NOT be
    /// filtered: the door refuses nothing there, and a day that quietly empties is the same
    /// contradiction as an optimistic list, only in reverse.
    #[test]
    fn slots_hands_the_whole_day_back_when_the_authority_is_silent() {
        let day = own_slots_calendar_day("2026-08-30", 30);
        let expected = day.as_array().unwrap().len();
        let out = available_slots_pure(slots_input("2026-08-30", day, sched_hours(json!([]))))
            .unwrap();
        assert_eq!(offered(&out).len(), expected);
    }

    /// The envelope the caller already reads does not change (appointments#127): `slots` was a
    /// Tier-0 query and the runtime hands an unpaginated one back as `{rows,total,limit,offset}`.
    /// `total` counts what the caller actually gets, so a pager built on it cannot promise hours
    /// the business is shut for.
    #[test]
    fn slots_answers_the_same_envelope_the_query_answered() {
        let out = available_slots_pure(slots_input(
            "2026-08-31",
            own_slots_calendar_day("2026-08-31", 30),
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        let result = out.result.clone().expect("the list answers with a result");
        let kept = offered(&out).len() as i64;
        assert_eq!(as_i64(&result["total"], -1), kept);
        assert_eq!(as_i64(&result["limit"], -1), kept);
        assert_eq!(as_i64(&result["offset"], -1), 0);
    }

    /// Missing read = refusal, never an open door — the same rule the gate and `check` obey. A
    /// list that silently stops filtering because a read went missing is the optimistic list all
    /// over again.
    #[test]
    fn slots_refuses_when_a_read_it_needs_did_not_arrive() {
        for missing in [
            "schedules.business_hours.list",
            "schedules.special_days.list",
            "schedules.overrides.list",
            "schedules.exception_intervals.list",
            "appointments.availability.own_slots",
        ] {
            let mut input = slots_input(
                "2026-08-31",
                own_slots_calendar_day("2026-08-31", 30),
                sched_hours(sched_weekdays_nine_to_six()),
            );
            input["context"]["reads"]
                .as_object_mut()
                .unwrap()
                .remove(missing);
            let out = available_slots_pure(input).unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.availability_unavailable"),
                "{missing} missing must refuse"
            );
        }
    }

    /// A date the handler cannot read is a refusal too, not «everything is open». The schema pins
    /// the shape at the door; this is the guard behind it.
    #[test]
    fn slots_refuses_a_date_it_cannot_read() {
        for bad in ["", "tomorrow", "2026-13-40"] {
            let out = available_slots_pure(slots_input(
                bad,
                own_slots_calendar_day("2026-08-31", 30),
                sched_hours(sched_weekdays_nine_to_six()),
            ))
            .unwrap();
            assert_eq!(
                domain_code(&out).as_deref(),
                Some("appointments.invalid_start"),
                "`{bad}` must be refused"
            );
        }
    }

    /// A row this module's own SQL returned in a shape nobody can judge is a FAULT, not a slot to
    /// quietly drop: dropping it hides a broken read behind a shorter list, which is the mute
    /// failure the production-ready rule is about.
    #[test]
    fn slots_refuses_a_row_it_cannot_read_instead_of_dropping_it() {
        let out = available_slots_pure(slots_input(
            "2026-08-31",
            json!([{ "slot_start": "2026-08-31T09:00:00", "slot_end": "2026-08-31T09:30:00" }]),
            sched_hours(sched_weekdays_nine_to_six()),
        ))
        .unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );
    }

    /// 🔒 THE REGRESSION GUARD of appointments#127. Quarter-hour by quarter-hour, what the list
    /// OFFERS is exactly what the door ACCEPTS: a slot the list keeps is a slot `create` books,
    /// and a slot the list drops is one `create` refuses with `appointments.outside_schedule`.
    /// This is the pair the issue exists to close — the list saying «free» about an hour the door
    /// will refuse — and a walk is the only shape that cannot pass by accident.
    #[test]
    fn slots_offers_exactly_what_the_door_accepts() {
        let hours = json!([json!({ "id": "bh-lunch", "day_of_week": 0, "position": 0,
                                   "open_time": "09:00", "close_time": "18:00", "is_closed": 0,
                                   "break_start": "14:00", "break_end": "16:00" })]);
        let reads = sched_hours(hours);
        // 2026-08-03 is a Monday AHEAD of the tests' `now`, so the only rule that can speak is
        // the weekly one — the same date `check_and_the_door_agree_on_the_hours_hour_by_hour`
        // walks, on purpose: the two guards have to be reading the same day.
        let day = "2026-08-03";
        let out = available_slots_pure(slots_input(
            day,
            own_slots_calendar_day(day, 30),
            reads.clone(),
        ))
        .unwrap();
        let times = offered(&out);

        let mut offered_any = false;
        let mut dropped_any = false;
        let mut m = 8 * 60;
        while m + 30 <= 20 * 60 {
            let at = format!("{day}T{:02}:{:02}:00+02:00", m / 60, m % 60);
            let hhmm = format!("{:02}:{:02}", m / 60, m % 60);
            let in_list = times.iter().any(|t| *t == hhmm);
            let door = create_appointment_pure(input(item(&at, 30, "s1"), Some(reads.clone())))
                .unwrap();
            let door_shut = domain_code(&door).as_deref() == Some("appointments.outside_schedule");
            offered_any |= in_list;
            dropped_any |= !in_list;
            assert_eq!(
                in_list, !door_shut,
                "the list and the door disagree at {at}: offered={in_list}, door shut={door_shut}"
            );
            m += 15;
        }
        assert!(
            offered_any && dropped_any,
            "a walk where the day is all offered or all dropped proves nothing"
        );
    }

    // ── appointments#136 · la cita que reservó el propio cliente NACE CONFIRMADA ────────────────
    //
    // Hasta aquí TODA cita nacía `pending` y alguien del salón tenía que pulsar «Confirmar», una
    // por una — también las que el cliente ya se había reservado él mismo por internet o por
    // WhatsApp. Para el canal desatendido (whatsapp_inbox#58) eso es una persona en medio de cada
    // cita, que es justo lo que el canal existe para quitar.
    //
    // El mercado lo tiene resuelto en la misma dirección desde hace años: en Fresha, Booksy y
    // Square la reserva online se ACEPTA sola y «revisar antes de aceptar» es la opción que el
    // negocio activa si quiere. Así que el interruptor nace encendido y apagarlo devuelve el
    // comportamiento de siempre.
    //
    // One door counts as «the customer already committed»: a booking marked `booked_online`
    // (the `request_id` door of the WhatsApp requests was retired in appointments#183). What the
    // counter types is still born pending.

    /// The settings singleton with the switch in a KNOWN position. The shared [`catalog_reads`]
    /// fixture leaves the key OUT on purpose — that is the case
    /// [`a_settings_row_that_predates_the_switch_reads_it_as_the_column_default`] pins.
    fn settings_auto_confirm(on: bool) -> Value {
        json!({
            "appointments.settings.get": [
                { "allow_overlapping": 0, "default_duration": 60, "min_booking_notice": 0,
                  "max_advance_booking": 0, "auto_confirm_online": on }
            ]
        })
    }

    /// The same booking as [`item`], but arriving with the flag an online booking carries.
    fn online_item(start: &str) -> Value {
        let mut it = item(start, 30, "s1");
        it["booked_online"] = json!(true);
        it
    }

    /// The history entries of one `action`, in the order the handler emitted them.
    fn history_ops<'a>(out: &'a Output, action: &str) -> Vec<&'a Operation> {
        out.operations
            .iter()
            .filter(|op| {
                op.command.ends_with("_insert_history")
                    && op.params.get("action") == Some(&json!(action))
            })
            .collect()
    }

    /// `new_value` travels as a serialised JSON string, the way `_insert_history` stores it.
    fn history_new_value(op: &Operation) -> Value {
        let raw = as_str(op.params.get("new_value").unwrap_or(&Value::Null));
        serde_json::from_str(&raw).unwrap_or(Value::Null)
    }

    fn status_of(out: &Output) -> Option<&Value> {
        insert_op(out).params.get("status")
    }

    /// The heart of the issue: the client booked it herself, the salon said «confirm those on
    /// their own», so nobody has to press anything.
    #[test]
    fn a_booking_the_customer_made_online_is_born_confirmed() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(true)),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(status_of(&out), Some(&json!("confirmed")));
    }

    /// And switching it off brings back exactly what the salon had before: review every one.
    #[test]
    fn switching_the_setting_off_brings_the_manual_review_back() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(false)),
        ))
        .unwrap();
        assert_eq!(status_of(&out), Some(&json!("pending")));
    }

    /// What the counter types is NOT an online booking. The receptionist is on the phone with the
    /// client and writes it down; the appointment goes through the salon's own review, unchanged.
    #[test]
    fn what_the_counter_types_is_still_born_pending() {
        let out = create_appointment_pure(input(
            item("2026-07-31T11:00:00Z", 30, "s1"),
            Some(settings_auto_confirm(true)),
        ))
        .unwrap();
        assert_eq!(status_of(&out), Some(&json!("pending")));
    }

    /// A settings row that does not carry the switch reads it as the column default (`DEFAULT 1`,
    /// ON), the way [`default_duration_of`] and [`allow_overlapping_of`] read theirs. The
    /// shared [`catalog_reads`] fixture leaves the key out on purpose, so this is the case every
    /// other test in this file runs on.
    #[test]
    fn a_settings_row_that_predates_the_switch_reads_it_as_the_column_default() {
        let out =
            create_appointment_pure(input(online_item("2026-07-31T11:00:00Z"), None)).unwrap();
        assert_eq!(status_of(&out), Some(&json!("confirmed")));
    }

    /// A brand new hub has NO settings row until somebody opens the Settings tab and saves —
    /// `settings_read` hands the handler `{}` then. That is exactly the salon that just installed
    /// the WhatsApp channel: its Settings screen already shows the switch ON (it paints the schema
    /// `default: true`), and the column is `NOT NULL DEFAULT 1`. The handler has to read the empty
    /// row the way the column and the screen do, or the very first WhatsApp booking is born
    /// pending while the screen says it should not be — and nothing tells anyone.
    #[test]
    fn a_fresh_hub_without_a_settings_row_confirms_like_its_settings_screen_says() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(json!({ "appointments.settings.get": [] })),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(status_of(&out), Some(&json!("confirmed")));
    }

    // appointments#183: the WhatsApp «requests» door is retired (whatsapp_inbox#206). Its
    // `request_id` was a marker only that listener carried; with the listener gone, a
    // `request_id` that reaches the handler is just an unknown key and must buy nothing.

    fn payload_with_request_id(start: &str) -> Value {
        json!({
            "request_id": "req-9",
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "start_datetime": start,
            "duration_minutes": 30
        })
    }

    #[test]
    fn a_request_id_no_longer_confirms_a_booking_on_arrival() {
        let out = create_appointment_pure(input(
            payload_with_request_id("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(true)),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(status_of(&out), Some(&json!("pending")));
    }

    #[test]
    fn the_created_event_carries_no_request_key() {
        let out = create_appointment_pure(input(
            payload_with_request_id("2026-07-31T11:00:00Z"),
            None,
        ))
        .unwrap();
        let created = events_named(&out, "appointments.appointment.created");
        assert_eq!(created.len(), 1, "{:?}", out.events);
        assert!(created[0].payload.get("request_id").is_none(), "{}", created[0].payload);
    }

    /// Born confirmed ANNOUNCES it. Whatever reacts to a confirmation — the reminder, an
    /// automation answering the customer — must not go blind to half the diary because the
    /// confirmation happened at creation instead of a second later.
    #[test]
    fn a_booking_born_confirmed_announces_the_confirmation() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(true)),
        ))
        .unwrap();
        let ev = event(&out, "appointments.appointment.confirmed")
            .expect("a booking that is born confirmed emits the confirmation");
        assert_eq!(ev.payload.get("appointment_id"), Some(&json!("apt-1")));
    }

    /// …and one born pending does NOT: an event that fires when nothing was confirmed is the
    /// defect appointments#18 already paid for once.
    #[test]
    fn a_booking_born_pending_announces_no_confirmation() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(false)),
        ))
        .unwrap();
        assert!(event(&out, "appointments.appointment.confirmed").is_none());
    }

    /// The trail says what really happened: created (already confirmed) and confirmed. Without
    /// the second line the agenda's history could tell a WhatsApp booking apart from a counter
    /// one that somebody confirmed — the origin leaking into the audit trail.
    #[test]
    fn the_trail_of_a_booking_born_confirmed_records_the_confirmation() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(true)),
        ))
        .unwrap();
        let created = history_ops(&out, "created");
        assert_eq!(created.len(), 1);
        assert_eq!(
            history_new_value(created[0]).get("status"),
            Some(&json!("confirmed")),
            "the creation entry has to report the status the row was BORN with"
        );
        let confirmed = history_ops(&out, "confirmed");
        assert_eq!(confirmed.len(), 1, "one confirmation line, not none and not two");
        assert_eq!(
            confirmed[0].params.get("old_value"),
            Some(&Value::Null),
            "it was never pending: claiming otherwise would be inventing a transition"
        );
        assert_eq!(
            history_new_value(confirmed[0]).get("status"),
            Some(&json!("confirmed"))
        );
        let pos = |action: &str| {
            out.operations
                .iter()
                .position(|op| {
                    op.command.ends_with("_insert_history")
                        && op.params.get("action") == Some(&json!(action))
                })
                .unwrap()
        };
        assert!(
            pos("created") < pos("confirmed"),
            "the creation is written first; the confirmation behind it"
        );
    }

    /// And a booking born pending leaves ONE line, exactly as before this issue.
    #[test]
    fn the_trail_of_a_booking_born_pending_has_only_the_creation() {
        let out = create_appointment_pure(input(
            online_item("2026-07-31T11:00:00Z"),
            Some(settings_auto_confirm(false)),
        ))
        .unwrap();
        assert_eq!(history_ops(&out, "created").len(), 1);
        assert!(history_ops(&out, "confirmed").is_empty());
        assert_eq!(
            history_new_value(history_ops(&out, "created")[0]).get("status"),
            Some(&json!("pending"))
        );
    }

    /// The third door the counter uses — a batch typed into the agenda — is the salon's own
    /// booking too. Its items carry no `booked_online`, so the switch changes nothing.
    #[test]
    fn a_batch_the_counter_types_is_still_born_pending() {
        let mut batch = json!({
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "appointments": [
                { "start_datetime": "2026-07-31T11:00:00Z" },
                { "start_datetime": "2026-07-31T12:00:00Z" }
            ]
        });
        binder_applied_defaults(BULK_CREATE_SCHEMA, &mut batch);
        let mut bulk_input = input(batch, Some(settings_auto_confirm(true)));
        bulk_input["context"]["new_ids"] = json!(["apt-1", "apt-2"]);
        let out = bulk_create_pure(bulk_input).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let born: Vec<&Value> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("status"))
            .collect();
        assert_eq!(born.len(), 2, "both rows of the batch are booked: {:?}", out.operations);
        assert!(
            born.iter().all(|s| *s == &json!("pending")),
            "a batch typed at the counter is the salon's own booking: {born:?}"
        );
    }

    // appointments#138: a batch books N appointments and must ANNOUNCE N appointments. Whatever
    // listens to `appointments.appointment.created` — a flow sending the confirmation, a reminder,
    // a KPI counting new bookings — used to see the one-by-one booking and not the batch, so the
    // same appointment reached the customer or not depending on the door it came in by.

    /// The batch every test below books: two slots for the same customer, service and
    /// professional, with the ids the host hands the handler.
    fn two_slot_batch(second: Value, settings: Value) -> Value {
        let mut batch = json!({
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "appointments": [ { "start_datetime": "2026-07-31T11:00:00Z" }, second ]
        });
        binder_applied_defaults(BULK_CREATE_SCHEMA, &mut batch);
        let mut bulk_input = input(batch, Some(settings));
        bulk_input["context"]["new_ids"] = json!(["apt-1", "apt-2"]);
        bulk_input
    }

    fn events_named<'a>(out: &'a Output, name: &str) -> Vec<&'a erplora_guest_sdk::Event> {
        out.events.iter().filter(|e| e.name == name).collect()
    }

    /// One `created` per appointment of the batch, carrying the same fields the other doors
    /// announce: which appointment, for whom, what, with whom and when.
    #[test]
    fn a_batch_announces_every_appointment_it_books() {
        let out = bulk_create_pure(two_slot_batch(
            json!({ "start_datetime": "2026-07-31T12:00:00Z" }),
            settings_auto_confirm(false),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let created = events_named(&out, "appointments.appointment.created");
        assert_eq!(created.len(), 2, "one announcement per booked appointment: {:?}", out.events);
        for (ev, (id, start)) in created.iter().zip([
            ("apt-1", "2026-07-31T11:00:00Z"),
            ("apt-2", "2026-07-31T12:00:00Z"),
        ]) {
            assert_eq!(ev.payload.get("appointment_id"), Some(&json!(id)));
            // appointments#174: the start the ROW was written with (normalised), not the string
            // the caller typed — the event says what the row says.
            let row_start = insert_ops(&out)
                .iter()
                .find(|op| op.params.get("appointment_id") == Some(&json!(id)))
                .and_then(|op| op.params.get("start_datetime").cloned());
            assert_eq!(ev.payload.get("start_datetime"), row_start.as_ref());
            assert_eq!(
                parse_dt(ev.payload["start_datetime"].as_str().unwrap()),
                parse_dt(start)
            );
            assert_eq!(ev.payload.get("customer_id"), Some(&json!("c1")));
            assert_eq!(ev.payload.get("service_id"), Some(&json!("s-corte")));
            assert_eq!(ev.payload.get("staff_id"), Some(&json!("s1")));
        }
        assert!(
            events_named(&out, "appointments.appointment.confirmed").is_empty(),
            "nothing in this batch was confirmed: {:?}",
            out.events
        );
    }

    /// Since appointments#136 a batch slot marked `booked_online` can be born confirmed. It then
    /// announces BOTH — never a confirmation of an appointment that was not announced as
    /// created — and only for that slot: the other one stays pending and silent about it.
    #[test]
    fn a_batch_slot_born_confirmed_announces_created_and_confirmed() {
        let out = bulk_create_pure(two_slot_batch(
            json!({ "start_datetime": "2026-07-31T12:00:00Z", "booked_online": true }),
            settings_auto_confirm(true),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(events_named(&out, "appointments.appointment.created").len(), 2);
        let confirmed = events_named(&out, "appointments.appointment.confirmed");
        assert_eq!(confirmed.len(), 1, "only the online slot: {:?}", out.events);
        assert_eq!(confirmed[0].payload.get("appointment_id"), Some(&json!("apt-2")));
        // The event and the row can never disagree: the confirmed one is the one born confirmed.
        let statuses: Vec<(&Value, &Value)> = insert_ops(&out)
            .iter()
            .map(|op| (&op.params["appointment_id"], &op.params["status"]))
            .collect();
        assert!(
            statuses.contains(&(&json!("apt-2"), &json!("confirmed"))),
            "{statuses:?}"
        );
    }

    /// A batch the hub refuses books nothing, so it announces nothing.
    #[test]
    fn a_refused_batch_announces_nothing() {
        let mut refused = two_slot_batch(
            json!({ "start_datetime": "2026-07-31T12:00:00Z" }),
            settings_auto_confirm(false),
        );
        refused["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("appointments.settings.get");
        let out = bulk_create_pure(refused).unwrap();
        assert!(out.error.is_some(), "the batch must be refused: {:?}", out.operations);
        assert!(out.events.is_empty(), "{:?}", out.events);
    }

    /// A recurring series the salon set up is the salon's own booking, whatever the switch says:
    /// `materialize` books occurrences with `booked_online: false`, so no occurrence can slip
    /// through the online door.
    #[test]
    fn occurrences_of_a_series_are_never_born_confirmed() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(settings_auto_confirm(true)),
        ))
        .unwrap();
        let born: Vec<&Value> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("status"))
            .collect();
        assert!(!born.is_empty(), "a run that booked nothing proves nothing");
        assert!(
            born.iter().all(|s| *s == &json!("pending")),
            "a series occurrence is the salon's own booking: {born:?}"
        );
    }

    // appointments#172: the third door. The occurrences a series books are appointments like any
    // other, so each one announces `created` with the same fields the batch sends (#138) — the
    // customer of a weekly series gets the confirmation flow the customer of a one-off gets.

    /// `(appointment_id, start_datetime)` of every `created` announced, in order.
    fn announced_created(out: &Output) -> Vec<(Value, Value)> {
        events_named(out, "appointments.appointment.created")
            .iter()
            .map(|ev| {
                assert_eq!(ev.payload.get("customer_id"), Some(&json!("c1")));
                assert_eq!(ev.payload.get("service_id"), Some(&json!("s-corte")));
                assert_eq!(ev.payload.get("staff_id"), Some(&json!("s1")));
                assert_eq!(ev.payload.get("recurring_id"), Some(&json!("r1")));
                // appointments#183: the WhatsApp request correlation is gone from the shape.
                assert!(ev.payload.get("request_id").is_none(), "{}", ev.payload);
                (
                    ev.payload.get("appointment_id").cloned().unwrap_or(Value::Null),
                    ev.payload.get("start_datetime").cloned().unwrap_or(Value::Null),
                )
            })
            .collect()
    }

    #[test]
    fn a_series_announces_every_occurrence_it_books() {
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            None,
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            announced_created(&out),
            vec![
                (json!("apt-1"), json!("2026-08-03T11:00:00+02:00")),
                (json!("apt-2"), json!("2026-08-10T11:00:00+02:00")),
            ],
            "one announcement per booked occurrence: {:?}",
            out.events
        );
        // The announced id is the row's id: a listener that reads the appointment finds it.
        let rows: Vec<&Value> = insert_ops(&out)
            .iter()
            .filter_map(|op| op.params.get("appointment_id"))
            .collect();
        assert_eq!(rows, vec![&json!("apt-1"), &json!("apt-2")]);
        assert!(
            events_named(&out, "appointments.appointment.confirmed").is_empty(),
            "occurrences are born pending: {:?}",
            out.events
        );
    }

    /// An occurrence the series skips — a holiday, or one already on the books from a previous
    /// run — was not booked now, so it is not announced now.
    #[test]
    fn a_series_does_not_announce_the_occurrences_it_skips() {
        let holiday = upcoming_blocks(json!([
            { "id": "b1", "title": "Festivo", "staff_id": null, "all_day": 1,
              "start_datetime": "2026-08-03T00:00:00Z", "end_datetime": "2026-08-04T00:00:00Z" }
        ]));
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(holiday),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            announced_created(&out),
            vec![(json!("apt-1"), json!("2026-08-10T11:00:00+02:00"))]
        );

        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(already_booked(json!(["2026-08-03"]))),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert_eq!(
            announced_created(&out),
            vec![(json!("apt-1"), json!("2026-08-10T11:00:00+02:00"))]
        );

        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({}))]),
            Some(already_booked(json!(["2026-08-03", "2026-08-10"]))),
        ))
        .unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        assert!(out.operations.is_empty() && out.events.is_empty(), "{:?}", out.events);
    }
    // appointments#174: ONE shape for `appointments.appointment.created`, whatever the door. The
    // one-by-one booking used to announce it declaratively (the command's whole payload plus the
    // runtime's system params, the id as `new_id`) while the batch and the (since retired) WhatsApp approval sent
    // five fields with the id as `appointment_id` — so an automation tested on one door failed on
    // the other. The doors now build the event from the SAME row they write.

    const MANIFEST: &str = include_str!("../../module.json");

    /// The same booking through the one-by-one and the batch doors: customer c1, «Corte» with Bea,
    /// 11:00, 30 min, under the same policy (no confirmation on arrival), so every field can be compared.
    fn booked_through_every_door() -> [(&'static str, Output); 2] {
        let single = create_appointment_pure(input(
            json!({
                "customer_id": "c1", "service_id": "s-corte", "staff_id": "s1",
                "start_datetime": "2026-07-31T11:00:00Z", "duration_minutes": 30,
                "notes": "the same colour as last time"
            }),
            Some(settings_auto_confirm(false)),
        ))
        .unwrap();
        let mut batch = json!({
            "customer_id": "c1", "service_id": "s-corte", "staff_id": "s1",
            "appointments": [ { "start_datetime": "2026-07-31T11:00:00Z",
                                "duration_minutes": 30,
                                "notes": "the same colour as last time" } ]
        });
        binder_applied_defaults(BULK_CREATE_SCHEMA, &mut batch);
        let bulk = bulk_create_pure(input(batch, Some(settings_auto_confirm(false)))).unwrap();
        [("single", single), ("batch", bulk)]
    }

    /// The ONE `created` a door announces.
    fn created_payload(out: &Output, door: &str) -> Value {
        assert!(out.error.is_none(), "{door}: {:?}", out.error);
        let created = events_named(out, "appointments.appointment.created");
        assert_eq!(created.len(), 1, "{door} announces the appointment once: {:?}", out.events);
        created[0].payload.clone()
    }

    fn created_through_every_door() -> [(&'static str, Value); 2] {
        booked_through_every_door().map(|(door, out)| (door, created_payload(&out, door)))
    }

    /// The event says what the ROW says: every field of the payload is the value the door is
    /// about to write in `_insert_appointment`, in every door. (Comparing the doors with each
    /// other is not enough — a builder that read the wrong column would agree with itself.)
    #[test]
    fn the_created_event_says_what_the_row_says_in_every_door() {
        for (door, out) in booked_through_every_door() {
            let payload = created_payload(&out, door);
            let rows = insert_ops(&out);
            assert_eq!(rows.len(), 1, "{door} writes one appointment");
            let row = &rows[0].params;
            for field in [
                "appointment_id", "customer_id", "customer_name", "service_id", "service_name",
                "service_price", "staff_id", "staff_name", "start_datetime", "end_datetime",
                "duration_minutes", "status", "notes", "recurring_id",
            ] {
                assert_eq!(payload.get(field), row.get(field), "{door}: `{field}` is not the row's");
            }
            assert_eq!(payload.get("new_id"), row.get("appointment_id"), "{door}: `new_id`");
            assert_eq!(
                payload.get("booked_online"),
                Some(&json!(as_bool(&row["booked_online"]))),
                "{door}: `booked_online`"
            );
            assert_eq!(payload["duration_minutes"], json!(30), "{door}");
            assert_eq!(payload["service_price"], row["service_price"], "{door}");
        }
    }

    #[test]
    fn the_created_event_has_the_same_payload_through_every_door() {
        let doors = created_through_every_door();
        let (_, reference) = &doors[0];
        for (door, payload) in &doors {
            let keys: Vec<&String> = payload.as_object().unwrap().keys().collect();
            let expected: Vec<&String> = reference.as_object().unwrap().keys().collect();
            assert_eq!(keys, expected, "{door} announces a different shape: {payload}");
            for field in [
                "customer_id", "customer_name", "service_id", "service_name", "staff_id",
                "staff_name", "start_datetime", "end_datetime", "duration_minutes", "status",
                "notes",
            ] {
                assert!(
                    payload.get(field).is_some_and(|v| !v.is_null()),
                    "{door} does not say `{field}`: {payload}"
                );
                assert_eq!(payload.get(field), reference.get(field), "{door}: `{field}` differs");
            }
            // The id is the row's id, under the same name in every door — and still under the
            // `new_id` the one-by-one booking always carried, for automations built on it.
            assert_eq!(payload.get("appointment_id"), Some(&json!("apt-1")), "{door}");
            assert_eq!(payload.get("new_id"), Some(&json!("apt-1")), "{door}");
        }
        assert_eq!(reference.get("customer_name"), Some(&json!("Ada Lovelace")));
        assert_eq!(reference.get("service_name"), Some(&json!("Corte")));
        assert_eq!(reference.get("status"), Some(&json!("pending")));
    }

    /// The one-by-one booking announces from its handler now. Keeping the declarative `emit` as
    /// well would queue a SECOND, differently shaped copy on a runtime that predates hub#1786.
    #[test]
    fn the_single_booking_does_not_also_emit_created_declaratively() {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("module.json parses");
        let create = &manifest["commands"]["appointments.appointments.create"];
        assert!(create.is_object(), "the create command exists");
        let declared = create.get("emit").cloned().unwrap_or(json!([]));
        assert!(
            !declared.as_array().unwrap().iter().any(|e| e == "appointments.appointment.created"),
            "{declared}"
        );
        assert!(
            manifest["events"]["emits"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e == "appointments.appointment.created"),
            "a handler event must be declared in `events.emits` (hub#240)"
        );
    }

    // ── appointments#98 · the PROFESSIONAL's hours are a door too ────────────────────────────
    //
    // appointments#89 closed the door on the hours of the BUSINESS. The salon being open says
    // nothing about whether Bea works that hour: she may be on her break, off on Fridays, or on an
    // approved holiday. `staff` owns that answer; `staff.availability.day_at` hands the door the
    // business day of the booking's instant (its governing template, the working pieces and the
    // approved absences), and the handler — which alone knows the booking's END — decides.
    //
    // The degradation that must not break is the #89 one: a professional with NO template for
    // that day has not configured her hours, and refusing there would switch off booking for
    // every hub that never set shifts up. An approved absence refuses always.

    /// Bea's day as `staff.availability.day_at` answers it: governed by `tpl-1`, with the pieces
    /// given, plus any approved absences.
    fn staff_day(day: &str, shifts: &[(&str, &str)], off: Value) -> Value {
        let mut rows = vec![json!({ "kind": "day", "day": day, "schedule_id": "tpl-1",
                                    "start_time": null, "end_time": null, "is_full_day": 0 })];
        for (s, e) in shifts {
            rows.push(json!({ "kind": "shift", "day": day, "schedule_id": "tpl-1",
                              "start_time": s, "end_time": e, "is_full_day": 0 }));
        }
        for o in off.as_array().cloned().unwrap_or_default() {
            rows.push(o);
        }
        Value::Array(rows)
    }

    /// A day NO template governs (nothing configured for Bea), plus any approved absences.
    fn staff_day_ungoverned(day: &str, off: Value) -> Value {
        let mut rows = staff_day(day, &[], off);
        rows[0]["schedule_id"] = Value::Null;
        rows
    }

    fn full_day_off(day: &str) -> Value {
        json!([{ "kind": "off", "day": day, "schedule_id": null, "start_time": null,
                 "end_time": null, "is_full_day": 1 }])
    }

    fn partial_off(day: &str, s: &str, e: &str) -> Value {
        json!([{ "kind": "off", "day": day, "schedule_id": null, "start_time": s,
                 "end_time": e, "is_full_day": 0 }])
    }

    /// Friday 2026-08-07: Bea works 09:00–13:00 and 14:00–18:00.
    fn bea_friday() -> Value {
        staff_day("2026-08-07", &[("09:00:00", "13:00:00"), ("14:00:00", "18:00:00")], json!([]))
    }

    fn create_with_staff_day(start: &str, dur: i64, day: Value) -> Output {
        create_appointment_pure(input(
            item(start, dur, "s1"),
            Some(json!({ STAFF_DAY_READ: day })),
        ))
        .unwrap()
    }

    /// 🔴 THE SYMPTOM OF THE ISSUE. The salon keeps no hours (nothing configured in `schedules`,
    /// so #89 lets every hour through) and Bea finishes at 18:00: 19:00 was booked.
    #[test]
    fn create_refuses_a_booking_outside_the_professionals_shift() {
        let out = create_with_staff_day("2026-08-07T19:00:00+02:00", 30, bea_friday());
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
        assert!(out.operations.is_empty(), "a refusal writes nothing");
    }

    #[test]
    fn create_accepts_a_booking_inside_the_professionals_shift() {
        let out = create_with_staff_day("2026-08-07T10:00:00+02:00", 30, bea_friday());
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    /// The whole booking must fit ONE piece: starting at 12:45 for 30 minutes runs into her break.
    #[test]
    fn create_refuses_a_booking_that_runs_into_the_professionals_break() {
        let out = create_with_staff_day("2026-08-07T12:45:00+02:00", 30, bea_friday());
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// Both ends included, like the business hours: 17:30 + 30 ends exactly at 18:00 and fits.
    #[test]
    fn create_accepts_a_booking_that_ends_exactly_when_the_shift_ends() {
        let out = create_with_staff_day("2026-08-07T17:30:00+02:00", 30, bea_friday());
        assert_eq!(domain_code(&out), None);
    }

    /// The other end, included too: the first client of the shift, at 09:00 sharp.
    #[test]
    fn create_accepts_a_booking_that_starts_exactly_when_the_shift_starts() {
        let out = create_with_staff_day("2026-08-07T09:00:00+02:00", 30, bea_friday());
        assert_eq!(domain_code(&out), None);
    }

    /// A booking that lasts past the NEXT day cannot fit inside one piece of one day — whatever
    /// the day's pieces are, it is refused instead of being measured against the wrong midnight.
    #[test]
    fn create_refuses_a_booking_that_runs_past_the_next_day() {
        let out = create_with_staff_day("2026-08-07T09:00:00+02:00", 3000, bea_friday());
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// The business is OPEN at 13:15, so this is not `outside_schedule`: the person is on her
    /// break. Two motives, two codes — the receptionist has to know which one applies.
    #[test]
    fn the_professionals_break_is_not_reported_as_the_business_being_shut() {
        let mut reads = sched_hours(sched_weekdays_nine_to_six());
        reads[STAFF_DAY_READ] = bea_friday();
        let out = create_appointment_pure(input(item("2026-08-07T13:15:00+02:00", 30, "s1"), Some(reads)))
            .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// Shut AND off: the business hours run first, as they do in `availability.check`.
    #[test]
    fn a_shut_business_answers_outside_schedule_before_the_professionals_hours() {
        let mut reads = sched_hours(sched_weekdays_nine_to_six());
        reads[STAFF_DAY_READ] = bea_friday();
        let out = create_appointment_pure(input(item("2026-08-07T23:00:00+02:00", 30, "s1"), Some(reads)))
            .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some("appointments.outside_schedule"));
    }

    /// Her hours rank above the blocked time, the same place the business hours hold.
    #[test]
    fn the_professionals_hours_answer_before_the_blocked_time() {
        let out = create_appointment_pure(input(
            item("2026-08-07T19:00:00+02:00", 30, "s1"),
            Some(json!({
                STAFF_DAY_READ: bea_friday(),
                "appointments.blocked_times.overlapping": [
                    { "id": "b1", "staff_id": "", "start_datetime": "2026-08-07T16:00:00Z",
                      "end_datetime": "2026-08-07T20:00:00Z", "reason": "Obras" }
                ]
            })),
        ))
        .unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// A day her template governs with no working piece (Saturday off) is a day she does not work.
    #[test]
    fn create_refuses_a_booking_on_the_professionals_day_off() {
        let out = create_with_staff_day(
            "2026-08-01T11:00:00+02:00",
            30,
            staff_day("2026-08-01", &[], json!([])),
        );
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    #[test]
    fn create_refuses_a_booking_during_an_approved_full_day_absence() {
        let mut day = bea_friday();
        day.as_array_mut().unwrap().extend(full_day_off("2026-08-07").as_array().unwrap().clone());
        let out = create_with_staff_day("2026-08-07T10:00:00+02:00", 30, day);
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// A partial absence (a doctor's appointment 10:00–11:00) cuts the piece: 10:30 is out, and
    /// 11:00 — the minute she is back — is in.
    #[test]
    fn a_partial_absence_cuts_the_shift_and_its_end_is_bookable() {
        let day = || {
            staff_day(
                "2026-08-07",
                &[("09:00:00", "13:00:00")],
                partial_off("2026-08-07", "10:00:00", "11:00:00"),
            )
        };
        let during = create_with_staff_day("2026-08-07T10:30:00+02:00", 30, day());
        assert_eq!(domain_code(&during).as_deref(), Some(OUTSIDE_STAFF_HOURS));
        let into = create_with_staff_day("2026-08-07T09:45:00+02:00", 30, day());
        assert_eq!(domain_code(&into).as_deref(), Some(OUTSIDE_STAFF_HOURS), "runs into it");
        let after = create_with_staff_day("2026-08-07T11:00:00+02:00", 30, day());
        assert_eq!(domain_code(&after), None, "back at 11:00");
        let before = create_with_staff_day("2026-08-07T09:30:00+02:00", 30, day());
        assert_eq!(domain_code(&before), None, "ends exactly when she leaves");
    }

    /// 🔴 THE DEGRADATION THAT MUST NOT BREAK. No template governs Bea's day: nothing configured,
    /// so her hours do not refuse anything (the business hours still do).
    #[test]
    fn a_professional_with_no_schedule_configured_can_still_be_booked() {
        let out = create_with_staff_day(
            "2026-08-07T22:00:00+02:00",
            30,
            staff_day_ungoverned("2026-08-07", json!([])),
        );
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    /// …but an approved holiday is a holiday, template or not.
    #[test]
    fn an_approved_absence_refuses_even_without_a_schedule() {
        let out = create_with_staff_day(
            "2026-08-07T10:00:00+02:00",
            30,
            staff_day_ungoverned("2026-08-07", full_day_off("2026-08-07")),
        );
        assert_eq!(domain_code(&out).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// 2026-10-25 is the day Madrid goes back to +01:00. Bea works 09:00–10:00. 08:15Z is 09:15
    /// on the wall (in); 07:30Z is 08:30 (out). Guessing the summer offset (+02:00) swaps BOTH
    /// answers — a correct booking refused and a wrong one accepted.
    #[test]
    fn the_professionals_hours_are_read_on_the_business_clock_on_the_dst_change_day() {
        let day = || staff_day("2026-10-25", &[("09:00:00", "10:00:00")], json!([]));
        let inside = create_with_staff_day("2026-10-25T08:15:00Z", 30, day());
        assert_eq!(domain_code(&inside), None);
        let outside = create_with_staff_day("2026-10-25T07:30:00Z", 30, day());
        assert_eq!(domain_code(&outside).as_deref(), Some(OUTSIDE_STAFF_HOURS));
    }

    /// The read is `required` in the manifest. If it is missing anyway, the answer is a refusal:
    /// a guard that shrugs when its input is absent is a guard that opens (appointments#10).
    #[test]
    fn create_refuses_when_the_professionals_day_could_not_be_read() {
        let mut inp = input(item("2026-08-07T10:00:00+02:00", 30, "s1"), None);
        inp["context"]["reads"].as_object_mut().unwrap().remove(STAFF_DAY_READ);
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some(STAFF_HOURS_UNAVAILABLE));
        assert!(out.operations.is_empty());
        let mut empty = input(item("2026-08-07T10:00:00+02:00", 30, "s1"), None);
        empty["context"]["reads"][STAFF_DAY_READ] = json!([]);
        let out = create_appointment_pure(empty).unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some(STAFF_HOURS_UNAVAILABLE), "no day row");
    }

    /// An approved PART-day absence whose times cannot be read is an absence nobody can place:
    /// refused as unreadable, never skipped as if Bea were in.
    #[test]
    fn a_partial_absence_with_unreadable_times_refuses_instead_of_being_skipped() {
        let off = partial_off("2026-08-07", "", "12:00:00");
        let out = create_with_staff_day("2026-08-07T10:00:00+02:00", 30, staff_day_ungoverned("2026-08-07", off));
        assert_eq!(domain_code(&out).as_deref(), Some(STAFF_HOURS_UNAVAILABLE));
    }

    /// A restricting answer about ANOTHER day (the read and the handler disagreeing on the
    /// business clock) is never applied to this booking: refused as unreadable, not judged.
    #[test]
    fn a_professionals_day_that_is_not_the_bookings_day_is_not_applied() {
        let out = create_with_staff_day(
            "2026-08-07T10:00:00+02:00",
            30,
            staff_day("2026-07-30", &[("09:00:00", "18:00:00")], json!([])),
        );
        assert_eq!(domain_code(&out).as_deref(), Some(STAFF_HOURS_UNAVAILABLE));
    }

    /// The screen answers what the door enforces: `availability.check` says `outside_staff_hours`
    /// for the hour `create` refuses, and FREE for the hour it accepts.
    #[test]
    fn check_answers_the_professionals_hours_like_the_door() {
        let mut reads = sched_hours(json!([]));
        reads[STAFF_DAY_READ] = bea_friday();
        let off = check_availability_pure(check_input("2026-08-07T19:00:00+02:00", own_rules(1, ""), reads.clone()))
            .unwrap();
        assert_eq!(verdict_of(&off), (0, "outside_staff_hours".to_string()));
        let on = check_availability_pure(check_input("2026-08-07T10:00:00+02:00", own_rules(1, ""), reads.clone()))
            .unwrap();
        assert_eq!(verdict_of(&on), (1, String::new()));
        // ranked like the door: above a block
        let blocked = check_availability_pure(check_input("2026-08-07T19:00:00+02:00", own_rules(0, "blocked"), reads))
            .unwrap();
        assert_eq!(verdict_of(&blocked), (0, "outside_staff_hours".to_string()));
    }

    /// Asked about the whole agenda (no professional), there is nobody's day to judge.
    #[test]
    fn check_without_a_professional_does_not_judge_anyones_hours() {
        let mut reads = sched_hours(json!([]));
        reads[STAFF_DAY_READ] = staff_day("2026-08-07", &[], full_day_off("2026-08-07"));
        let mut inp = check_input("2026-08-07T10:00:00+02:00", own_rules(1, ""), reads);
        inp["payload"].as_object_mut().unwrap().remove("staff_id");
        let out = check_availability_pure(inp).unwrap();
        assert_eq!(verdict_of(&out), (1, String::new()));
    }

    #[test]
    fn check_fails_when_the_professionals_day_could_not_be_read() {
        let mut inp = check_input("2026-08-07T10:00:00+02:00", own_rules(1, ""), sched_hours(json!([])));
        inp["context"]["reads"].as_object_mut().unwrap().remove(STAFF_DAY_READ);
        let out = check_availability_pure(inp).unwrap();
        assert_eq!(domain_code(&out).as_deref(), Some(STAFF_HOURS_UNAVAILABLE));
    }

    /// Both doors declare the read, `required`, keyed by what their payload carries.
    #[test]
    fn create_and_check_declare_the_professionals_day_as_a_required_read() {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("module.json parses");
        for (cmd, params) in [
            ("appointments.appointments.create", json!({ "staff_id": "payload.staff_id", "at": "payload.start_datetime" })),
            ("appointments.availability.check", json!({ "staff_id": "payload.staff_id", "at": "payload.start_datetime" })),
        ] {
            let reads = manifest["commands"][cmd]["reads"].as_array().cloned().unwrap_or_default();
            let read = reads.iter().find(|r| r["query"] == STAFF_DAY_READ);
            assert!(read.is_some(), "{cmd} does not declare {STAFF_DAY_READ}");
            assert_eq!(read.unwrap()["required"], json!(true), "{cmd}");
            assert_eq!(read.unwrap()["params"], params, "{cmd}");
        }
    }

    /// The read is `required`, so a hub still running a `staff` without it would abort EVERY
    /// booking with `ReadUnavailable`. The dependency floor is what keeps that hub from installing
    /// this version: it must name the first `staff` that ships `staff.availability.day_at`.
    #[test]
    fn the_staff_dependency_floor_is_the_version_that_ships_the_day_read() {
        let manifest: Value = serde_json::from_str(MANIFEST).expect("module.json parses");
        let staff = manifest["depends_on"]
            .as_array()
            .and_then(|deps| deps.iter().find(|d| d["id"] == "staff"))
            .cloned()
            .unwrap_or(Value::Null);
        let floor: Vec<u64> = staff["min_version"]
            .as_str()
            .unwrap_or_default()
            .split('.')
            .filter_map(|n| n.parse().ok())
            .collect();
        assert!(floor >= vec![2, 3, 0], "staff min_version is {:?}", staff["min_version"]);
    }
}
