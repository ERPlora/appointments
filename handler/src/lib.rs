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
pub fn book_from_request(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(book_from_request_pure(input.into_inner().into_value()))
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
fn lead_time_refusal(settings: &Value, start: &Dt, now: &Dt) -> Option<DomainError> {
    let ahead = cmp_secs(start, now);

    let notice_min = settings
        .get("min_booking_notice")
        .map(|v| as_i64(v, 0))
        .unwrap_or(0);
    if notice_min > 0 && ahead < notice_min * 60 {
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

/// An instant read on the BUSINESS wall clock: `(day_of_week, minute of the day)`.
///
/// `day_of_week` is 0 = Monday … 6 = Sunday, the module's convention everywhere (docs/concepts.md)
/// and the one stored in `appointments_schedule_timeslot.day_of_week`.
///
/// This is the crossing the opening-hours rule needed and could not do before: the timeslots are
/// wall clock (`HH:MM` on a weekday), an appointment is an instant, and only the business timezone
/// relates the two. `chrono_tz` applies the real IANA rules, so the answer stays right on the two
/// days a year when the offset moves — which is the whole reason this was not done by guessing.
fn business_wall_parts(instant: &Dt, tz: chrono_tz::Tz) -> Option<(i64, i64)> {
    use chrono::{Datelike, Timelike};
    let local = chrono::DateTime::from_timestamp(instant.epoch_secs(), 0)?.with_timezone(&tz);
    let dow = local.weekday().num_days_from_monday() as i64;
    Some((dow, local.hour() as i64 * 60 + local.minute() as i64))
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

/// The business's opening hours, enforced (appointments#89).
///
/// `queries/availability_check.sql` has computed `outside_schedule` since the beginning, but a
/// query only INFORMS the screen. Every other door — the assistant, a flow, `whatsapp_inbox`, the
/// public API — could book at three in the morning. This is the same rule, where the decision is
/// actually taken, reading `appointments.schedules.active_timeslots` as an AUTHORITATIVE read
/// (ADR-0069) and never from the payload.
///
/// The semantics are deliberately the SQL's, so screen and door cannot disagree:
///
///   * the timeslots are the hub's, not the professional's — there is no `staff_id` join in the
///     query either. Whether a given professional works that hour is a different rule, and it
///     needs a read this module cannot express yet (appointments#98);
///   * a hub with NO active timeslot has not configured its opening hours, and then every calendar
///     hour counts. Refusing there would turn «I have not set my hours yet» into «I cannot take
///     bookings», which is an outage, not a guard;
///   * the appointment must fit WHOLE inside one timeslot of its weekday — `[start, end]`, both
///     ends included, so a booking that runs past closing is out.
///
/// Missing read = refusal, never an open door: the manifest declares it `required`, and a guard
/// that shrugs when its input is absent is a guard that opens (appointments#10).
fn schedule_refusal(
    input: &Value,
    tz: chrono_tz::Tz,
    start: &Dt,
    end: &Dt,
) -> Option<DomainError> {
    let Some(rows) = read_rows(input, "appointments.schedules.active_timeslots") else {
        return Some(DomainError::new(
            "appointments.availability_unavailable",
            "The business opening hours could not be read; the appointment was not booked.",
        ));
    };
    // Not configured yet: every hour of the calendar is bookable (same as `availability_slots`).
    if rows.is_empty() {
        return None;
    }

    let (Some((dow, start_min)), Some((end_dow, end_min))) = (
        business_wall_parts(start, tz),
        business_wall_parts(end, tz),
    ) else {
        return Some(DomainError::new(
            "appointments.availability_unavailable",
            "The appointment's time could not be read on the business clock.",
        ));
    };
    // An appointment that runs past midnight leaves its weekday, and no single timeslot can hold
    // it. Treating it as outside is the honest answer, and it matches the SQL, which compares one
    // `day_of_week` only.
    let end_min = if end_dow == dow { end_min } else { 24 * 60 + 1 };

    let open = rows.iter().any(|row| {
        if row.get("is_deleted").map(as_bool).unwrap_or(false) {
            return false;
        }
        if row.get("day_of_week").map(|v| as_i64(v, -1)).unwrap_or(-1) != dow {
            return false;
        }
        let (Some(from), Some(to)) = (
            wall_minutes(&as_str(row.get("start_time").unwrap_or(&Value::Null))),
            wall_minutes(&as_str(row.get("end_time").unwrap_or(&Value::Null))),
        ) else {
            return false;
        };
        from <= start_min && end_min <= to
    });

    if open {
        return None;
    }
    Some(DomainError::new(
        "appointments.outside_schedule",
        "That time is outside the business opening hours.",
    ))
}

/// The live slot holds this booking has to respect (appointments#69).
///
/// A **hold** is a slot this module has apartado for a decision that is still pending — today, a
/// booking request somebody is deciding on in the WhatsApp inbox. It is a row of THIS module with
/// an opaque reference to whoever asked for it (`source`/`source_ref`), exactly like the table
/// hold of `tables` (tables#12): `appointments` never learns what a WhatsApp request is, only that
/// someone identifiable set a slot aside and can give it back.
///
/// Two reads feed it, mirroring the pair the blocked times already use: `.live` (the holds of ONE
/// day) for `create`/`reschedule`, and `.upcoming` (every hold still ahead) for `bulk_create` and
/// `recurring.materialize`, which span days that `reads.params` cannot express.
///
/// `exclude_ref` is the request that OWNS the hold, and it is the one thing that must not be
/// blocked by it: the whole point of holding a slot for a pending request is that the request can
/// still book it. It comes from `payload.request_id`, which only the listener
/// (`_book_from_request`) carries — `create`'s schema is `additionalProperties: false`, so no
/// outside caller can smuggle a `request_id` in to walk past somebody else's hold.
fn holds_from(input: &Value, staff_id: &str, exclude_ref: &str) -> Vec<Candidate> {
    let Some(rows) = read_rows(input, "appointments.slot_holds.live")
        .or_else(|| read_rows(input, "appointments.slot_holds.upcoming"))
    else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            if row.get("is_deleted").map(as_bool).unwrap_or(false) {
                return None;
            }
            if !exclude_ref.is_empty()
                && as_str(row.get("source_ref").unwrap_or(&Value::Null)) == exclude_ref
            {
                return None;
            }
            let owner = as_str(row.get("staff_id").unwrap_or(&Value::Null));
            if !owner.is_empty() && !staff_id.is_empty() && owner != staff_id {
                return None;
            }
            let start = parse_dt(&as_str(row.get("start_datetime")?))?;
            let end = parse_dt(&as_str(row.get("end_datetime")?))?;
            Some(Candidate {
                start,
                end,
                label: str_or(row, "label", "(en espera)"),
            })
        })
        .collect()
}

/// A slot somebody else has set aside while they decide (appointments#69).
///
/// It gets its OWN code and is not folded into `overlapping_appointment` on purpose. «That
/// professional already has an appointment» would send the receptionist to look for an appointment
/// that does not exist, and the forums say exactly that is how a hold gets read: Square's own
/// troubleshooting article lists its 15-minute hold among the causes of slots that «appear
/// unavailable for no reason». A hold that cannot say its name is indistinguishable from a bug.
fn hold_refusal(c: &Candidate) -> DomainError {
    DomainError::new(
        "appointments.slot_on_hold",
        &format!(
            "That slot is being held for a pending request — {} ({} – {}). It frees itself if \
             nobody books it.",
            c.label,
            c.start.iso(),
            c.end.iso()
        ),
    )
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
) -> Result<Vec<Operation>, PrepareError> {
    let customer_name = resolved.customer_name.clone();
    if customer_name.is_empty() {
        return Err(PrepareError::Invalid(
            "invalid_payload: customer_name es obligatorio".to_string(),
        ));
    }

    // appointments#79: a `Domain` error, not an `Invalid` one. `Invalid` is re-raised as a raw
    // `Err` by `create` (and by `book_from_request`), which the host turns into «error de handler
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
    if cmp_secs(&start, now) < 0 {
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

    if let Some(refusal) = lead_time_refusal(settings, &start, now) {
        return Err(PrepareError::Domain(refusal));
    }
    // appointments#89: opening hours before blocked time, the same order `availability_check.sql`
    // reports its `reason` in — the screen and the door must not rank the same refusals differently.
    if let Some(refusal) = schedule_refusal(input, business_tz(input), &start, &end) {
        return Err(PrepareError::Domain(refusal));
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
        // appointments#69: y las franjas RETENIDAS por una decisión pendiente. Van detrás del
        // solape a propósito — una cita real es una razón más firme que una retención que caduca
        // sola, y cuando las dos aplican es la cita la que hay que nombrar.
        let held = holds_from(
            input,
            &resolved.staff_id,
            &str_or(&payload_of(input), "request_id", ""),
        );
        if let Some(c) = held
            .iter()
            .find(|c| cmp_secs(&c.start, &end) < 0 && cmp_secs(&c.end, &start) > 0)
        {
            return Err(PrepareError::Domain(hold_refusal(c)));
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
    let mut ops: Vec<Operation> = Vec::with_capacity(3);

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
    p.insert("status".into(), json!("pending"));
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
        "status": "pending",
    })
    .to_string();
    let mut h = Map::new();
    h.insert("appointment_id".into(), json!(appointment_id));
    h.insert("action".into(), json!("created"));
    h.insert("description".into(), json!(history_description));
    h.insert("old_value".into(), Value::Null);
    h.insert("new_value".into(), json!(new_value));
    ops.push(Operation::sql("appointments._insert_history", h));

    candidates.push(Candidate {
        start,
        end,
        label: format!("(nueva {})", start.iso()),
    });
    Ok(ops)
}

// ───────────────────────────── funciones puras por command ─────────────────────────────

/// Who is asking to cancel (appointments#6). `staff` = someone operating the hub (the default:
/// the agenda screen never sends a channel); `customer` = the client herself through an
/// external channel (online booking, a flow acting on her behalf).
#[derive(Clone, Copy, PartialEq, Debug)]
enum CancelChannel {
    Staff,
    Customer,
}

fn cancel_channel(payload: &Value) -> Result<CancelChannel, String> {
    match payload.get("channel").map(as_str).as_deref() {
        None | Some("") | Some("staff") => Ok(CancelChannel::Staff),
        Some("customer") => Ok(CancelChannel::Customer),
        Some(other) => Err(format!(
            "invalid_payload: channel `{other}` is not one of staff|customer"
        )),
    }
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
    let channel = cancel_channel(&payload)?;
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
    let status = as_str(row.get("status").unwrap_or(&Value::Null));
    if status == "cancelled" || status == "completed" {
        return Ok(refuse(
            "appointments.cannot_cancel",
            "This appointment can no longer be cancelled in its current state.",
        ));
    }

    if channel == CancelChannel::Customer {
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

    let channel_label = match channel {
        CancelChannel::Staff => "staff",
        CancelChannel::Customer => "customer",
    };
    let mut cancel = Map::new();
    cancel.insert("appointment_id".into(), json!(appointment_id));
    cancel.insert("reason".into(), json!(str_or(&payload, "reason", "")));
    let mut history = Map::new();
    history.insert("appointment_id".into(), json!(appointment_id));
    history.insert("channel".into(), json!(channel_label));
    Ok(Output {
        operations: vec![
            Operation::sql("appointments._cancel_row", cancel),
            Operation::sql("appointments._history_cancel", history),
        ],
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
    if cmp_secs(&start, &ctx.now) < 0 {
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

    if let Some(refusal) = lead_time_refusal(&settings, &start, &ctx.now) {
        return Ok(Output::new().with_error(refusal));
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
        // appointments#69: mover una cita encima de una franja retenida es venderla igual que
        // crearla ahí. Sin exclusión: reprogramar no viene de ninguna petición.
        if let Some(c) = holds_from(&input, &staff_id, "")
            .iter()
            .find(|c| cmp_secs(&c.start, &end) < 0 && cmp_secs(&c.end, &start) > 0)
        {
            return Ok(Output::new().with_error(hold_refusal(c)));
        }
    }

    let mut p = Map::new();
    p.insert("appointment_id".into(), json!(appointment_id));
    p.insert("start_datetime".into(), json!(start.iso()));
    p.insert("end_datetime".into(), json!(end.iso()));
    p.insert("duration_minutes".into(), json!(duration));

    let only_id = |_: ()| {
        let mut m = Map::new();
        m.insert("appointment_id".into(), json!(appointment_id));
        m
    };

    // The handler decided with a read; between that read and this UPDATE the state could have
    // changed. Both gates stay SERVER-SIDE, inside the command's own transaction, because that is
    // the only place the race actually closes (appointments#20).
    Ok(Output {
        operations: vec![
            Operation::sql("appointments._reschedule_state_assert", only_id(())),
            Operation::sql("appointments._reschedule_row", p),
            Operation::sql("appointments._appointment_overlap_assert", only_id(())),
            Operation::sql("appointments._history_reschedule", only_id(())),
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
    ) {
        Ok(ops) => ops,
        Err(PrepareError::Domain(refusal)) => return Ok(Output::new().with_error(refusal)),
        Err(PrepareError::Invalid(detail)) => return Err(detail),
    };
    // `..Default::default()` para que el literal compile contra LAS DOS formas de `Output`: la de
    // antes de hub#139 y la que ganó `error` (rechazo de dominio). Sin esto el handler deja de
    // compilar en cuanto el checkout del hub avanza, y nadie puede regenerar el wasm (pm#81).
    Ok(Output {
        operations: ops,
        events: vec![],
        ..Default::default()
    })
}

// ───────────────── una petición aprobada en otro módulo → una cita (appointments#38) ─────────────

/// The answer this module sends back when it DID book what it was asked to book.
const BOOKING_FULFILLED: &str = "appointments.booking_request.fulfilled";

/// The answer it sends back when it did not, and why.
const BOOKING_FAILED: &str = "appointments.booking_request.failed";

/// The refusal for a request nobody bound to real records — the heart of appointments#38.
const REQUEST_NOT_BOUND: &str = "appointments.request_not_bound";

/// The answer event for a booking that did not happen.
///
/// It is an EVENT and not an [`Output::with_error`] on purpose, and this is the whole design of
/// the listener: the host discards the operations **and the events** of an output that carries an
/// error (hub#139). Expressed as an error, a refusal would fail the listener command, the relay
/// would retry it eight times over an hour and drop the row into the dead-letter — and the inbox
/// that is waiting for an answer would never get one. A slot lost to the counter is a business
/// outcome, not a fault: it must travel, not retry.
fn booking_refused(request_id: &str, code: &str, message: &str) -> Output {
    Output::new().with_event(erplora_guest_sdk::Event::new(
        BOOKING_FAILED,
        json!({ "request_id": request_id, "reason_code": code, "reason": message }),
    ))
}

/// `appointments._book_from_request` — the listener of `whatsapp_inbox.request.approved`
/// (appointments#38).
///
/// Until this existed, the chain stopped one step short of being a booking channel: a customer
/// wrote on WhatsApp, an LLM parsed the message into a request, somebody at the salon approved it
/// — and nothing was created. The salon still typed the appointment by hand, which is what the
/// approval was supposed to replace.
///
/// **What this is not.** It is not a second, looser door into the agenda. It books through exactly
/// the same [`create_appointment_pure`] as the screen and the assistant: same authoritative reads,
/// same snapshot frozen from the catalogue (appointments#11), same lead-time, blocked-agenda and
/// overlap rules (appointments#10). What a language model read in a sentence gets no privileges
/// here; if anything, less.
///
/// **Why it needs the ids up front.** `create` resolves customer/service/professional against this
/// hub's records and fails closed, so a request carrying a service NAME and «tomorrow at ten» can
/// never become an appointment. The binding is done by a PERSON when they approve, in the inbox,
/// and travels in the event payload — which is why this command reads the same flat fields as
/// `create` (`reads.params` can only address `payload.<field>`, so the shape is not a choice).
/// That order — parse, propose, a human commits against real records — is what the market does
/// without exception: Square Messages composes the appointment in the normal sheet, Zenoti refuses
/// to confirm a request until a therapist is chosen, Booksy answers WhatsApp with a booking link
/// rather than parsing the chat. The two products that do book from free text unattended (Podium,
/// Booksy via Google) both replaced the human with a live-availability contract, which an inbox
/// request parsed hours earlier is not.
///
/// **Reads are declared NON-required here, deliberately**, unlike in `create`. A `required` read
/// that cannot resolve aborts the command (`ReadUnavailable`) — and inside a listener that means a
/// dead-letter row nobody reads. There is no degradation to caller data either way: every read
/// this handler is missing ends in a refusal (`catalog_unavailable`, `settings_unavailable`,
/// `availability_unavailable`), so making them non-required does not open a door — it turns a
/// silent death into a visible answer, which is the entire point of the issue.
pub fn book_from_request_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);

    // No request = nobody to answer. That is a wiring bug (a listener on the wrong event, an
    // emitter that dropped the correlation), and it SHOULD retry and end up in the dead-letter:
    // unlike a refusal, there is no inbox row this could be reported on.
    let request_id = str_or(&payload, "request_id", "");
    if request_id.is_empty() {
        return Err("invalid_payload: request_id requerido".to_string());
    }

    // The four things a person had to bind for there to be anything to book. Checked BEFORE the
    // booking so the answer names the real problem — «this request was never bound to a customer,
    // a service and a slot» — instead of whichever catalogue lookup happened to miss first.
    let missing: Vec<&str> = ["customer_id", "service_id", "staff_id", "start_datetime"]
        .into_iter()
        .filter(|k| str_or(&payload, k, "").is_empty())
        .collect();
    if !missing.is_empty() {
        return Ok(booking_refused(
            &request_id,
            REQUEST_NOT_BOUND,
            &format!(
                "The request was approved without choosing {}, so there was nothing to book. \
                 Open it again, pick them, and approve.",
                missing.join(", ")
            ),
        ));
    }

    let appointment_id = host_ctx(&input)?
        .new_ids
        .first()
        .cloned()
        .ok_or_else(|| "context.new_ids vacío (lo inyecta el host)".to_string())?;

    let booked = match create_appointment_pure(input) {
        Ok(out) => out,
        // What is left here is NOT a business refusal any more: appointments#70 gave the overlap —
        // the refusal this listener meets most, because hours pass between the message and the
        // approval — its own domain code, so it now arrives below as `booked.error` like every
        // other «no» of the module. This arm is the malformed-item case (a start date that will
        // not parse, an empty customer name), and it is still answered rather than retried: inside
        // a listener an `Err` aborts the command, the relay retries it eight times over an hour
        // and drops the row into the dead-letter, so the inbox waiting for an answer never gets
        // one.
        Err(detail) => {
            return Ok(booking_refused(
                &request_id,
                "appointments.booking_refused",
                &detail,
            ));
        }
    };
    if let Some(refusal) = booked.error {
        // The refusal `create` produced, forwarded WHOLE: the code so a screen can act on it, and
        // the sentence so the inbox can paint the real reason instead of «something went wrong».
        // Since appointments#70 the overlap comes through HERE, with the same
        // `appointments.overlapping_appointment` the inbox already showed — no prefix to sniff, no
        // `format!` in `prepare_appointment` that can rename the error behind this module's back.
        return Ok(booking_refused(
            &request_id,
            &refusal.code,
            &refusal.message,
        ));
    }

    // appointments#69: the slot this request had set aside is now an appointment, so the hold is
    // CONSUMED — in the same transaction, right behind the row it protected. Leaving it for
    // afterwards is how orphan holds are made: a failure in between would leave the slot set aside
    // for a request that is no longer waiting for anything, blocking its OWN appointment until the
    // sweep got to it. Idempotent and blind: it matches 0 rows when there was no hold, which is the
    // normal case for a hub whose inbox never held anything.
    let mut operations = booked.operations;
    let mut consume = Map::new();
    consume.insert("source_ref".into(), json!(request_id));
    operations.push(Operation::sql("appointments._hold_consume", consume));

    Ok(Output {
        operations,
        events: vec![
            // A booking made through this door is a booking: whatever subscribes to new
            // appointments (reminders, KPIs) must not go blind to half the diary because it
            // arrived by WhatsApp.
            erplora_guest_sdk::Event::new(
                "appointments.appointment.created",
                json!({
                    "appointment_id": appointment_id,
                    "customer_id": str_or(&payload, "customer_id", ""),
                    "service_id": str_or(&payload, "service_id", ""),
                    "staff_id": str_or(&payload, "staff_id", ""),
                    "start_datetime": str_or(&payload, "start_datetime", ""),
                    "request_id": request_id,
                }),
            ),
            erplora_guest_sdk::Event::new(
                BOOKING_FULFILLED,
                json!({
                    "request_id": request_id,
                    "appointment_id": appointment_id,
                    // Who booked it. The asking module stores this as the link, so the answer is
                    // not hard-wired to one module: a table reservation would answer the same way.
                    "module": "appointments",
                }),
            ),
        ],
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
        ) {
            Ok(item_ops) => {
                ops.extend(item_ops);
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
        events: vec![],
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
    if new_time.is_none() && new_duration.is_none() {
        return Err(
            "invalid_payload: nada que cambiar (se espera `time`, `duration_minutes` o ambos)"
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
            "frequency",
        ] {
            split.insert(key.into(), json!(str_or(&tmpl, key, "")));
        }
        split.insert(
            "day_of_week".into(),
            tmpl.get("day_of_week").cloned().unwrap_or(Value::Null),
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
        if moved >= 50 {
            break; // same per-invocation ceiling as `materialize` and `bulk_create`
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
        ops.push(Operation::sql(
            "appointments._recurring_move_occurrence",
            mv,
        ));

        // Every move leaves an audit row, like every other transition of this module: the trail is
        // what lets anyone answer «why is this at 12:00 now?» a month later.
        let mut h = Map::new();
        h.insert("appointment_id".into(), json!(appointment_id));
        ops.push(Operation::sql("appointments._history_reschedule", h));
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
        "moved": moved,
        "locked_invoiced": locked_invoiced,
        "kept_cancelled": kept_cancelled
    })))
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
        ) {
            Ok(item_ops) => {
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
        events: vec![],
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
            // appointments#89: the runtime pre-loads the hub's opening hours for all four booking
            // commands, so the shared fixture carries it for the same reason it carries the
            // catalogue — a test that never sees a read production always sends is a test of a
            // different handler. Empty = a hub that has not configured its hours, which is the
            // state most of these cases are really about; the ones that DO care plant their own.
            "appointments.schedules.active_timeslots": [],
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
            "appointments.appointments.conflicting": []
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

    // ── appointments#69 · una franja RETENIDA no se vende ──────────────────────────────────────
    //
    // Entre que el cliente escribe por WhatsApp y alguien del salón aprueba la petición pasan
    // horas, y el mostrador vende esa hora por la puerta. Hasta aquí el choque se gestionaba
    // DESPUÉS: la reserva se rechazaba y la petición volvía a la bandeja (appointments#38).
    // Retener la franja mientras se decide es lo que cierra la ventana en vez de gestionarla, y
    // es lo que hace el mercado (Square 15 min, Phorest 7, Odoo bloquea la pre-reserva).
    //
    // La retención es un dato de ESTE módulo con referencia OPACA a quien la pidió
    // (`source`/`source_ref`), exactamente como la de `tables` (tables#12): `appointments` no
    // aprende qué es una petición de WhatsApp, solo que alguien identificable apartó un hueco y
    // puede soltarlo.

    /// Una retención viva tal como la precarga el runtime (`appointments.slot_holds.live`).
    fn hold(start: &str, end: &str, staff: &str, source_ref: &str) -> Value {
        json!({
            "id": format!("hold-{source_ref}"),
            "staff_id": staff,
            "source": "whatsapp_inbox",
            "source_ref": source_ref,
            "start_datetime": start,
            "end_datetime": end,
            "label": "Ana (WhatsApp)"
        })
    }

    /// El mostrador intenta vender una hora que una petición pendiente tiene apartada. Se rechaza
    /// —y con su PROPIO código: «ya hay una cita» sería mentira y mandaría a la recepcionista a
    /// buscar en la agenda una cita que no existe. El fallo típico que cuentan los foros de Square
    /// es justo ese: el hueco desaparece «sin motivo» porque la retención es invisible.
    #[test]
    fn create_refuses_a_slot_another_request_is_holding() {
        let mut inp = input(item("2026-07-31T10:15:00Z", 30, "s1"), None);
        inp["context"]["reads"]["appointments.slot_holds.live"] = json!([hold(
            "2026-07-31T10:00:00Z",
            "2026-07-31T10:30:00Z",
            "s1",
            "req-9"
        )]);
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.slot_on_hold")
        );
        assert!(out.operations.is_empty(), "a refusal writes nothing");
    }

    /// La retención es POR PROFESIONAL, como el solape: apartar el hueco de Bea no puede cerrar
    /// la agenda de Carla, o retener una franja vaciaría el salón entero.
    #[test]
    fn a_hold_on_another_professional_does_not_block_this_booking() {
        let mut inp = input(item("2026-07-31T10:15:00Z", 30, "s1"), None);
        inp["context"]["reads"]["appointments.slot_holds.live"] = json!([hold(
            "2026-07-31T10:00:00Z",
            "2026-07-31T10:30:00Z",
            "s2",
            "req-9"
        )]);
        assert!(create_appointment_pure(inp).unwrap().error.is_none());
    }

    /// Bordes que se tocan NO solapan, igual que en el resto del módulo: una retención que
    /// termina a las 10:15 deja libres las 10:15.
    #[test]
    fn a_hold_that_ends_where_the_booking_starts_does_not_block_it() {
        let mut inp = input(item("2026-07-31T10:15:00Z", 30, "s1"), None);
        inp["context"]["reads"]["appointments.slot_holds.live"] = json!([hold(
            "2026-07-31T09:45:00Z",
            "2026-07-31T10:15:00Z",
            "s1",
            "req-9"
        )]);
        assert!(create_appointment_pure(inp).unwrap().error.is_none());
    }

    /// Y la que cierra el círculo de appointments#38: la petición que APARTÓ el hueco tiene que
    /// poder reservarlo. Su propia retención no puede rechazarla — sería el único caso en que
    /// retener una franja impide usarla, que es lo contrario de retenerla.
    #[test]
    fn the_request_that_holds_the_slot_can_book_it() {
        let mut inp = input(request_payload("2026-07-31T11:00:00Z"), None);
        inp["context"]["reads"]["appointments.slot_holds.live"] = json!([hold(
            "2026-07-31T11:00:00Z",
            "2026-07-31T11:30:00Z",
            "s1",
            "req-1"
        )]);
        let out = book_from_request_pure(inp).unwrap();
        assert!(
            event(&out, "appointments.booking_request.fulfilled").is_some(),
            "the request was refused by the very hold it had asked for: {:?}",
            event(&out, "appointments.booking_request.failed").map(|e| e.payload.clone())
        );
    }

    /// Reservar la petición CONSUME su retención, en la misma transacción que la cita.
    ///
    /// Si el consumo se dejase para después, un fallo entre medias dejaría la franja apartada por
    /// una petición que ya no espera nada — la retención huérfana que Lightspeed documenta en sus
    /// notas de versión. Caducaría sola, sí, pero mientras tanto estaría cerrando el hueco de su
    /// propia cita.
    #[test]
    fn booking_a_request_consumes_the_hold_it_was_holding() {
        let out =
            book_from_request_pure(input(request_payload("2026-07-31T11:00:00Z"), None)).unwrap();
        let consume = out
            .operations
            .iter()
            .find(|op| op.command.ends_with("_hold_consume"))
            .expect("the hold is consumed with the booking, not after it");
        assert_eq!(consume.params.get("source_ref"), Some(&json!("req-1")));
        let insert = out
            .operations
            .iter()
            .position(|op| op.command.ends_with("_insert_appointment"));
        let pos = out
            .operations
            .iter()
            .position(|op| op.command.ends_with("_hold_consume"));
        assert!(
            insert < pos,
            "the appointment is written first; the hold is closed behind it"
        );
    }

    /// Una reserva RECHAZADA no consume nada: la retención sigue viva hasta que caduque o alguien
    /// la suelte, porque la petición vuelve a la bandeja y la persona va a elegir otra hora.
    #[test]
    fn a_refused_request_does_not_consume_its_hold() {
        let out = book_from_request_pure(input(
            request_payload("2026-07-31T11:00:00Z"),
            Some(json!({
                "appointments.appointments.conflicting": [
                    { "id": "apt-0", "staff_id": "s1", "start_datetime": "2026-07-31T11:00:00Z",
                      "end_datetime": "2026-07-31T11:30:00Z", "status": "confirmed" }
                ]
            })),
        ))
        .unwrap();
        assert!(out.operations.is_empty(), "a refusal writes nothing at all");
    }

    /// Mover una cita encima de una franja retenida es venderla igual que crearla ahí, así que
    /// `reschedule` mira las retenciones con la misma regla.
    #[test]
    fn reschedule_refuses_a_slot_another_request_is_holding() {
        let mut inp = reschedule_input(
            move_to("2026-07-31T15:00:00Z", Some(45)),
            booked_row("2026-07-31T11:00:00Z", 60, "confirmed"),
            None,
        );
        inp["context"]["reads"]["appointments.slot_holds.live"] = json!([hold(
            "2026-07-31T15:15:00Z",
            "2026-07-31T16:00:00Z",
            "s1",
            "req-9"
        )]);
        let out = reschedule_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.slot_on_hold")
        );
        assert!(out.operations.is_empty(), "a refusal moves nothing");
    }

    /// `allow_overlapping` apaga la comprobación ENTERA (docs/concepts.md), y una retención es una
    /// cita que todavía no es: un hub que acepta solaparse acepta esto también. Si no, el toggle
    /// dejaría de significar lo que dice en su propia pantalla.
    #[test]
    fn a_hub_that_allows_overlapping_ignores_holds_too() {
        let mut inp = input(item("2026-07-31T10:15:00Z", 30, "s1"), None);
        inp["context"]["reads"]["appointments.settings.get"] = json!([{ "allow_overlapping": 1, "default_duration": 60,
                     "min_booking_notice": 0, "max_advance_booking": 0 }]);
        inp["context"]["reads"]["appointments.slot_holds.live"] = json!([hold(
            "2026-07-31T10:00:00Z",
            "2026-07-31T10:30:00Z",
            "s1",
            "req-9"
        )]);
        assert!(create_appointment_pure(inp).unwrap().error.is_none());
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
    /// code: it left `create` as `Err("overlap: …")`, so `_book_from_request` had to sniff the
    /// prefix to name it. This pins the two halves of the contract that made the sniffing
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

    fn cancel_input(channel: Option<&str>, start: &str, status: &str, settings: Value) -> Value {
        let mut payload = json!({ "appointment_id": "apt-1", "reason": "sick" });
        if let Some(c) = channel {
            payload["channel"] = json!(c);
        }
        let reads = json!({
            "appointments.appointments.get": [
                { "id": "apt-1", "appointment_number": "APT-1", "status": status,
                  "start_datetime": start, "end_datetime": start }
            ],
            "appointments.settings.get": settings,
        });
        input(payload, Some(reads))
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
            vec!["appointments._cancel_row", "appointments._history_cancel"]
        );
        let row = &out.operations[0].params;
        assert_eq!(row.get("appointment_id"), Some(&json!("apt-1")));
        assert_eq!(row.get("reason"), Some(&json!("sick")));
        assert_eq!(
            out.operations[1].params.get("channel"),
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
            out.operations[1].params.get("channel"),
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
    // WHAT IS STILL NOT HERE: the PROFESSIONAL's own working hours. `staff.availability.for_member`
    // needs `:staff_id` and a derived `:date_from`/`:date_to`, and `reads.params` binds literal
    // `payload.<field>` values only — `reschedule` does not even carry a `staff_id`. appointments#98.

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
        // Every move leaves an audit row, like every other transition of this module.
        assert_eq!(ops_named(&out, "_history_reschedule").len(), 2);
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
                "appointments._appointment_overlap_assert",
                "appointments._history_reschedule",
            ]
        );
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

    // ── appointments#38 · a request approved on WhatsApp becomes a REAL appointment ──
    //
    // `whatsapp_inbox` emits `whatsapp_inbox.request.approved` and, until now, nobody listened:
    // the salon clicked «Approve», the row went to `confirmed`, and no appointment was created.
    // The listener is `_book_from_request`, and its whole job is to be the SAME booking as any
    // other — same reads, same refusals, same rows — with one difference that is the point of the
    // issue: it has nobody in front of it, so a refusal has to travel BACK as an event instead of
    // as an error message on a screen.
    //
    // Which is why a business refusal here is `Ok(Output)` carrying the failure event and NOT
    // `Output::error`: the host DISCARDS the operations and the events of an output that carries
    // an error (hub#139). A refusal expressed that way would fail the listener command, the relay
    // would retry it eight times and drop the row in the dead-letter — and the inbox would never
    // hear a thing. That is exactly the silent failure appointments#38 was opened for.

    fn request_payload(start: &str) -> Value {
        json!({
            "request_id": "req-1",
            "customer_id": "c1",
            "service_id": "s-corte",
            "staff_id": "s1",
            "start_datetime": start,
            "duration_minutes": 30,
            "notes": "the same colour as last time"
        })
    }

    fn event<'a>(out: &'a Output, name: &str) -> Option<&'a erplora_guest_sdk::Event> {
        out.events.iter().find(|e| e.name == name)
    }

    #[test]
    fn an_approved_request_books_the_appointment_and_answers_fulfilled() {
        let out =
            book_from_request_pure(input(request_payload("2026-07-31T11:00:00Z"), None)).unwrap();
        assert!(out.error.is_none(), "{:?}", out.error);
        let insert = insert_op(&out);
        assert_eq!(insert.params.get("customer_id"), Some(&json!("c1")));
        assert_eq!(insert.params.get("service_id"), Some(&json!("s-corte")));
        // The snapshot still comes from the CATALOGUE (appointments#11): a listener is not a way
        // in for names the browser — or a language model — chose.
        assert_eq!(insert.params.get("service_name"), Some(&json!("Corte")));

        let answer = event(&out, "appointments.booking_request.fulfilled")
            .expect("the request that produced the booking has to be told so");
        assert_eq!(answer.payload.get("request_id"), Some(&json!("req-1")));
        assert_eq!(answer.payload.get("appointment_id"), Some(&json!("apt-1")));
        assert_eq!(answer.payload.get("module"), Some(&json!("appointments")));
        assert!(event(&out, "appointments.booking_request.failed").is_none());
    }

    /// The listener is not a second door into the agenda: what a booking normally emits, it emits.
    #[test]
    fn a_booking_made_from_a_request_still_announces_the_appointment() {
        let out =
            book_from_request_pure(input(request_payload("2026-07-31T11:00:00Z"), None)).unwrap();
        assert!(
            event(&out, "appointments.appointment.created").is_some(),
            "a listener that books in silence leaves reminders, KPIs and every other subscriber \
             blind to half the appointments in the diary"
        );
    }

    /// The heart of the issue: the LLM read a sentence, not this hub's records. An approval that
    /// nobody bound to a customer, a service and a professional has NOTHING to book — and it must
    /// say so where the person who can fix it is looking.
    #[test]
    fn an_unbound_request_books_nothing_and_answers_failed() {
        let mut payload = request_payload("2026-07-31T11:00:00Z");
        payload["service_id"] = json!("");
        let out = book_from_request_pure(input(payload, None)).unwrap();
        assert!(out.operations.is_empty(), "nothing may be written");
        assert!(
            out.error.is_none(),
            "a refusal carried as `error` makes the host drop the answer event with it"
        );
        let answer = event(&out, "appointments.booking_request.failed").expect("failure answer");
        assert_eq!(answer.payload.get("request_id"), Some(&json!("req-1")));
        assert_eq!(
            answer.payload.get("reason_code"),
            Some(&json!("appointments.request_not_bound"))
        );
    }

    /// The normal case, not the edge case: hours pass between the message and the approval, and
    /// the salon sold the slot over the counter meanwhile. The booking is refused — never forced —
    /// and the refusal travels back with the code `create` produced, so the inbox shows the real
    /// reason and not «something went wrong».
    #[test]
    fn a_slot_taken_since_the_message_answers_failed_with_the_reason() {
        let out = book_from_request_pure(input(
            request_payload("2026-07-31T11:00:00Z"),
            Some(json!({
                "appointments.appointments.conflicting": [
                    { "id": "apt-0", "staff_id": "s1", "start_datetime": "2026-07-31T11:00:00Z",
                      "end_datetime": "2026-07-31T11:30:00Z", "status": "confirmed" }
                ]
            })),
        ))
        .unwrap();
        assert!(out.operations.is_empty(), "an overbooking is never written");
        assert!(out.error.is_none());
        let answer = event(&out, "appointments.booking_request.failed").expect("failure answer");
        assert_eq!(
            answer.payload.get("reason_code"),
            Some(&json!("appointments.overlapping_appointment"))
        );
        assert!(
            answer
                .payload
                .get("reason")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.is_empty()),
            "the inbox paints the sentence, so there has to be one"
        );
    }

    /// A catalogue that could not be read is a refusal like any other — and it has to come back
    /// as one. Before this, an unreadable catalogue inside a listener was an aborted command and a
    /// dead-letter row: the request sat on `confirmed` for ever with no appointment behind it.
    #[test]
    fn an_unreadable_catalogue_answers_failed_instead_of_dead_lettering() {
        let mut inp = input(request_payload("2026-07-31T11:00:00Z"), None);
        inp["context"]["reads"]
            .as_object_mut()
            .unwrap()
            .remove("customers.get");
        let out = book_from_request_pure(inp).unwrap();
        assert!(out.operations.is_empty());
        let answer = event(&out, "appointments.booking_request.failed").expect("failure answer");
        assert_eq!(
            answer.payload.get("reason_code"),
            Some(&json!("appointments.catalog_unavailable"))
        );
    }

    /// Without a request there is nobody to answer, so this one IS a wiring bug and fails loudly:
    /// retrying it is the right behaviour, unlike a business refusal.
    #[test]
    fn a_payload_without_a_request_is_a_wiring_bug_not_a_business_answer() {
        let mut payload = request_payload("2026-07-31T11:00:00Z");
        payload["request_id"] = json!("");
        assert!(book_from_request_pure(input(payload, None)).is_err());
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

    fn hours(dow: i64, from: &str, to: &str) -> Value {
        json!({ "day_of_week": dow, "start_time": from, "end_time": to })
    }

    /// The settings read plus the hub's active timeslots, which is what these four commands see.
    fn with_slots(slots: Value) -> Value {
        let mut reads = lead_time(0, 0);
        reads["appointments.schedules.active_timeslots"] = slots;
        reads
    }

    /// Monday–Friday, 09:00–18:00 — the shape of nearly every salon's week.
    fn weekdays_nine_to_six() -> Value {
        json!([
            hours(0, "09:00", "18:00"),
            hours(1, "09:00", "18:00"),
            hours(2, "09:00", "18:00"),
            hours(3, "09:00", "18:00"),
            hours(4, "09:00", "18:00")
        ])
    }

    /// 2026-07-31 is a FRIDAY (`day_of_week` 4) and the hub closes at 18:00, so 23:00 is shut.
    #[test]
    fn create_refuses_a_booking_outside_the_business_hours() {
        let out = create_appointment_pure(input(
            item("2026-07-31T23:00:00+02:00", 30, "s1"),
            Some(with_slots(weekdays_nine_to_six())),
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
            Some(with_slots(weekdays_nine_to_six())),
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
            Some(with_slots(weekdays_nine_to_six())),
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
            Some(with_slots(weekdays_nine_to_six())),
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
            Some(with_slots(json!([]))),
        ))
        .unwrap();
        assert_eq!(domain_code(&out), None);
        assert!(!out.operations.is_empty());
    }

    /// The read is `required` in the manifest. If it does not arrive the answer is a refusal, not
    /// an open door: a guard whose input is missing must fail CLOSED, like the blocked-times one.
    #[test]
    fn create_refuses_when_the_timeslots_read_is_missing() {
        let mut inp = input(
            item("2026-07-31T15:00:00+02:00", 30, "s1"),
            Some(with_slots(weekdays_nine_to_six())),
        );
        inp["context"]["reads"]
            .as_object_mut()
            .expect("reads is an object")
            .remove("appointments.schedules.active_timeslots");
        let out = create_appointment_pure(inp).unwrap();
        assert_eq!(
            domain_code(&out).as_deref(),
            Some("appointments.availability_unavailable")
        );
        assert!(out.operations.is_empty());
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
            Some(with_slots(json!([hours(6, "09:00", "18:00")]))),
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
            Some(with_slots(json!([hours(6, "09:00", "18:00")]))),
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
            Some(with_slots(weekdays_nine_to_six())),
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
            Some(with_slots(weekdays_nine_to_six())),
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
            Some(with_slots(json!([hours(0, "09:00", "18:00")]))),
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
        let all_week: Vec<Value> = (0..7).map(|d| hours(d, "09:00", "18:00")).collect();
        let out = materialize_recurring_pure(series_input(
            series_payload(),
            json!([template(json!({ "frequency": "daily", "max_occurrences": 2 }))]),
            Some(with_slots(Value::Array(all_week))),
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
}
