//! Handler WASM (Tier 2) del módulo `appointments` — alta de citas, lotes y
//! materialización de recurrencias. Portado de old_modules/m_appointments
//! (AppointmentService.create/bulk_create/bulk_delete + RecurringAppointment.
//! get_next_occurrence). Lógica pura, sin BD: recibe `{payload, context}` y
//! devuelve **intenciones** (commands SQL del propio módulo) que el host valida
//! y ejecuta en una transacción (WASM-TODO piezas 1, 2, 3 y 6).
//!
//! Contrato real del host (crates/runtime/src/commands.rs): el guest solo recibe
//! `payload` + `context{hub_id, current_user_id, now, new_ids}` — el runtime NO
//! precarga lecturas. Por eso las lecturas que la validación necesita las aporta
//! el **caller** dentro del payload (la UI/SDK las obtiene con las queries del
//! módulo antes de invocar el command):
//!   - `settings`                — fila de `appointments.settings.get` (para
//!                                 `allow_overlapping` / `default_duration`).
//!   - `existing_appointments`   — citas candidatas a solape (de
//!                                 `appointments.appointments.list` del día).
//!   - `service`                 — `{name, price}` resuelto vía el contrato
//!                                 público del módulo `services` (cross-módulo).
//! Si faltan, el handler no puede validar solape y lo trata como permitido (la
//! disponibilidad autoritativa se consulta con `appointments.availability.*`).
//!
//! Nº de cita `APT-YYYYMMDD-NNNN`: contador atómico por hub+día (patrón de
//! `sales`): el handler emite `_bump_counter` (UPSERT) y `_insert_appointment`
//! calcula el número leyendo el contador en la MISMA transacción. El guest solo
//! aporta `:day`; nunca lee el contador (sin read-back).
//!
//! Ids: el host pasa `context.new_ids` (autoridad de ids); el guest solo los
//! reparte (`appointment_id`). El id de cada fila de historial lo pone el host
//! (`:new_id` fresco por operación).

use erplora_guest_sdk::{Operation, Output};
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
pub fn materialize_recurring(input: Json<erplora_guest_sdk::Input>) -> FnResult<Json<Output>> {
    guest_result(materialize_recurring_pure(input.into_inner().into_value()))
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

fn as_f64(v: &Value, d: f64) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(d),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(d),
        _ => d,
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

/// Lee un importe **en céntimos** (`i64`): entero, string de entero, o (robustez) decimal
/// como céntimos ya escalados (round half-to-even). ADR-0007: el dinero viaja en céntimos.
fn cents(v: &Value, d: i64) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|x| {
            let fl = x.floor();
            let diff = x - fl;
            (if (diff - 0.5).abs() < 1e-9 {
                if (fl as i64) % 2 == 0 { fl } else { fl + 1.0 }
            } else { x.round() }) as i64
        })).unwrap_or(d),
        Value::String(s) => s.trim().parse::<i64>().unwrap_or(d),
        _ => d,
    }
}

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
    if s.is_empty() { d.to_string() } else { s }
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
        2 => if is_leap(y) { 29 } else { 28 },
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
        days_from_civil(self.y, self.mo, self.d) * 86_400
            + self.h * 3_600
            + self.mi * 60
            + self.s
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
    let mut dt = Dt { y, mo, d, h: 0, mi: 0, s: 0, offset_min: 0, has_offset: false };
    if rest.is_empty() {
        return Some(dt);
    }
    let sep = rest.chars().next()?;
    if sep != 'T' && sep != 't' && sep != ' ' {
        return None;
    }
    let rest = &rest[1..];

    // Separa hora y offset ('Z' o '±HH[:]MM'; la hora solo contiene dígitos, ':' y '.').
    let off_pos = rest.char_indices().find_map(|(i, c)| {
        matches!(c, 'Z' | 'z' | '+' | '-').then_some(i)
    });
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
            let digits: String = off_part[1..].chars().filter(|c| c.is_ascii_digit()).collect();
            let (oh, om) = match digits.len() {
                2 => (digits.parse::<i64>().ok()?, 0),
                4 => (digits[..2].parse::<i64>().ok()?, digits[2..].parse::<i64>().ok()?),
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
    Ok(HostCtx { now, new_ids })
}

/// Cita candidata a solape (lectura aportada por el caller en el payload).
struct Candidate {
    start: Dt,
    end: Dt,
    label: String,
}

/// Extrae las citas vivas de `existing_appointments` (ignora cancelled/no_show/borradas).
fn candidates_from(payload: &Value) -> Vec<Candidate> {
    let empty: Vec<Value> = Vec::new();
    payload
        .get("existing_appointments")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty)
        .iter()
        .filter_map(|row| {
            let status = as_str(row.get("status").unwrap_or(&Value::Null));
            if status == "cancelled" || status == "no_show" {
                return None;
            }
            if row.get("is_deleted").map(as_bool).unwrap_or(false) {
                return None;
            }
            let start = parse_dt(&as_str(row.get("start_datetime")?))?;
            let end = parse_dt(&as_str(row.get("end_datetime")?))?;
            let number = str_or(row, "appointment_number", "(sin número)");
            Some(Candidate { start, end, label: number })
        })
        .collect()
}

/// `allow_overlapping` de los settings aportados por el caller (default BD: false).
fn allow_overlapping(payload: &Value) -> bool {
    payload
        .get("settings")
        .and_then(|s| s.get("allow_overlapping"))
        .map(as_bool)
        .unwrap_or(false)
}

fn default_duration(payload: &Value) -> i64 {
    payload
        .get("settings")
        .and_then(|s| s.get("default_duration"))
        .map(|v| as_i64(v, 60))
        .filter(|d| *d >= 1)
        .unwrap_or(60)
}

// ───────────────────────────── núcleo: una cita → intenciones ─────────────────────────────

/// Valida un ítem de cita y devuelve sus 3 intenciones (`_bump_counter` +
/// `_insert_appointment` + `_insert_history`). Añade la cita aceptada a
/// `candidates` para que el solape también se valide dentro del lote.
#[allow(clippy::too_many_arguments)]
fn prepare_appointment(
    item: &Value,
    fallback_service: Option<&Value>,
    candidates: &mut Vec<Candidate>,
    allow_overlap: bool,
    default_dur: i64,
    now: &Dt,
    appointment_id: &str,
    history_description: &str,
) -> Result<Vec<Operation>, String> {
    let customer_name = str_or(item, "customer_name", "");
    if customer_name.is_empty() {
        return Err("invalid_payload: customer_name es obligatorio".to_string());
    }

    let raw_start = as_str(item.get("start_datetime").unwrap_or(&Value::Null));
    let start = parse_dt(&raw_start).ok_or_else(|| {
        format!("invalid_start: fecha/hora inválida `{raw_start}` (esperado ISO 8601)")
    })?;
    if cmp_secs(&start, now) < 0 {
        return Err("invalid_start: la cita no puede empezar en el pasado".to_string());
    }

    let duration = item
        .get("duration_minutes")
        .map(|v| as_i64(v, default_dur))
        .filter(|d| *d >= 1)
        .unwrap_or(default_dur);
    let end = start.add_minutes(duration);

    if !allow_overlap {
        if let Some(c) = candidates
            .iter()
            .find(|c| cmp_secs(&c.start, &end) < 0 && cmp_secs(&c.end, &start) > 0)
        {
            return Err(format!(
                "overlap: se solapa con la cita {} ({} – {})",
                c.label,
                c.start.iso(),
                c.end.iso()
            ));
        }
    }

    // Resolución de servicio: nombre/precio del ítem, con fallback a la lectura
    // `service` {name, price} aportada por el caller (contrato público de `services`).
    let mut service_name = str_or(item, "service_name", "");
    // service_price en CÉNTIMOS (ADR-0007): del ítem o, si 0, del catálogo `services` (cents).
    let mut service_price = cents(item.get("service_price").unwrap_or(&Value::Null), 0);
    if let Some(svc) = fallback_service {
        if service_name.is_empty() {
            service_name = str_or(svc, "name", "");
        }
        if service_price == 0 {
            service_price = cents(svc.get("price").unwrap_or(&Value::Null), 0);
        }
    }

    let day = now.day_key();
    let mut ops: Vec<Operation> = Vec::with_capacity(3);

    let mut bump = Map::new();
    bump.insert("day".into(), json!(day));
    ops.push(Operation::sql("appointments._bump_counter", bump));

    let mut p = Map::new();
    p.insert("appointment_id".into(), json!(appointment_id));
    p.insert("day".into(), json!(day));
    p.insert("customer_id".into(), item.get("customer_id").cloned().unwrap_or(Value::Null));
    p.insert("customer_name".into(), json!(customer_name.clone()));
    p.insert("customer_phone".into(), json!(str_or(item, "customer_phone", "")));
    p.insert("customer_email".into(), json!(str_or(item, "customer_email", "")));
    p.insert("staff_id".into(), item.get("staff_id").cloned().unwrap_or(Value::Null));
    p.insert("staff_name".into(), json!(str_or(item, "staff_name", "")));
    p.insert("service_id".into(), item.get("service_id").cloned().unwrap_or(Value::Null));
    p.insert("service_name".into(), json!(service_name.clone()));
    p.insert("service_price".into(), json!(service_price));
    p.insert("start_datetime".into(), json!(start.iso()));
    p.insert("end_datetime".into(), json!(end.iso()));
    p.insert("duration_minutes".into(), json!(duration));
    p.insert("status".into(), json!("pending"));
    p.insert("notes".into(), json!(str_or(item, "notes", "")));
    p.insert("internal_notes".into(), json!(str_or(item, "internal_notes", "")));
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

    candidates.push(Candidate { start, end, label: format!("(nueva {})", start.iso()) });
    Ok(ops)
}

// ───────────────────────────── funciones puras por command ─────────────────────────────

/// `appointments.appointments.create` — WASM-TODO pieza 1.
pub fn create_appointment_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let appointment_id = ctx
        .new_ids
        .first()
        .cloned()
        .ok_or_else(|| "context.new_ids vacío (lo inyecta el host)".to_string())?;

    let mut candidates = candidates_from(&payload);
    let ops = prepare_appointment(
        &payload,
        payload.get("service"),
        &mut candidates,
        allow_overlapping(&payload),
        default_duration(&payload),
        &ctx.now,
        &appointment_id,
        "Cita creada",
    )?;
    Ok(Output { operations: ops, events: vec![] })
}

/// `appointments.appointments.bulk_create` — WASM-TODO pieza 2 (máx. 50 ítems).
/// Acumula errores por índice sin abortar el lote; el contador avanza dentro del
/// lote (un `_bump_counter` por cita, ejecutados en orden en la misma tx). Si
/// NINGÚN ítem es válido, falla con el detalle de todos los errores.
pub fn bulk_create_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let empty: Vec<Value> = Vec::new();
    let items = payload.get("appointments").and_then(|v| v.as_array()).unwrap_or(&empty);
    if items.is_empty() {
        return Err("invalid_payload: `appointments` vacío".to_string());
    }
    if items.len() > 50 {
        return Err(format!("invalid_payload: máximo 50 citas por lote (recibidas {})", items.len()));
    }

    let allow_overlap = allow_overlapping(&payload);
    let default_dur = default_duration(&payload);
    let mut candidates = candidates_from(&payload);
    let mut ops: Vec<Operation> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut created = 0usize;

    for (i, item) in items.iter().enumerate() {
        let Some(id) = ctx.new_ids.get(created) else {
            errors.push(format!("[{i}] sin id disponible (new_ids agotados)"));
            continue;
        };
        match prepare_appointment(
            item,
            payload.get("service"),
            &mut candidates,
            allow_overlap,
            default_dur,
            &ctx.now,
            id,
            "Cita creada (lote)",
        ) {
            Ok(item_ops) => {
                ops.extend(item_ops);
                created += 1;
            }
            Err(e) => errors.push(format!("[{i}] {e}")),
        }
    }

    if created == 0 {
        return Err(format!("bulk_create: 0 citas válidas — {}", errors.join("; ")));
    }
    Ok(Output { operations: ops, events: vec![] })
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
        return Err(format!("invalid_payload: máximo 50 ids por lote (recibidos {})", ids.len()));
    }

    let ops = ids
        .iter()
        .map(|id| {
            let mut p = Map::new();
            p.insert("appointment_id".into(), json!(id));
            Operation::sql("appointments.appointments.delete", p)
        })
        .collect();
    Ok(Output { operations: ops, events: vec![] })
}

/// `appointments.recurring.materialize` — WASM-TODO pieza 6.
/// El caller aporta la plantilla (`recurring`, fila de `appointments.recurring.list`)
/// y opcionalmente la ventana `from`/`to` (YYYY-MM-DD). Genera las ocurrencias
/// (daily/weekly/biweekly/monthly) respetando `end_date`/`max_occurrences`, salta
/// las pasadas y materializa máx. 50 citas por invocación.
pub fn materialize_recurring_pure(input: Value) -> Result<Output, String> {
    let payload = input.get("payload").cloned().unwrap_or(Value::Null);
    let ctx = host_ctx(&input)?;
    let r = payload
        .get("recurring")
        .cloned()
        .ok_or_else(|| "invalid_payload: falta `recurring` (la plantilla)".to_string())?;

    if !r.get("is_active").map(as_bool).unwrap_or(true) {
        return Err("inactive: la plantilla recurrente está desactivada".to_string());
    }
    let frequency = str_or(&r, "frequency", "");
    if !matches!(frequency.as_str(), "daily" | "weekly" | "biweekly" | "monthly") {
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
    let max_occurrences = r.get("max_occurrences").map(|v| as_i64(v, 0)).filter(|n| *n > 0);
    let duration = r
        .get("duration_minutes")
        .map(|v| as_i64(v, 0))
        .filter(|d| *d >= 1)
        .unwrap_or_else(|| default_duration(&payload));

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
    let advance_days = payload
        .get("settings")
        .and_then(|s| s.get("max_advance_booking"))
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
                match r.get("day_of_week").map(|v| as_i64(v, -1)).filter(|v| (0..=6).contains(v)) {
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

    let allow_overlap = allow_overlapping(&payload);
    let mut candidates = candidates_from(&payload);
    let mut ops: Vec<Operation> = Vec::new();
    let mut created = 0usize;

    // Ítem base materializado desde la plantilla (denormalizados de cliente/servicio/staff).
    for days in occurrence_days {
        if created >= 50 {
            break; // tope por invocación (mismo límite que bulk_create)
        }
        let (y, mo, d) = civil_from_days(days);
        let start_iso = format!("{y:04}-{mo:02}-{d:02}T{th:02}:{tm:02}:00");
        let item = json!({
            "customer_id": r.get("customer_id").cloned().unwrap_or(Value::Null),
            "customer_name": str_or(&r, "customer_name", ""),
            "service_id": r.get("service_id").cloned().unwrap_or(Value::Null),
            "service_name": str_or(&r, "service_name", ""),
            "staff_id": r.get("staff_id").cloned().unwrap_or(Value::Null),
            "staff_name": str_or(&r, "staff_name", ""),
            "start_datetime": start_iso,
            "duration_minutes": duration,
            "notes": str_or(&r, "notes", ""),
            "booked_online": false,
        });
        let Some(id) = ctx.new_ids.get(created) else { break };
        let desc = format!(
            "Cita materializada de la plantilla recurrente {}",
            str_or(&r, "id", "(sin id)")
        );
        match prepare_appointment(
            &item,
            payload.get("service"),
            &mut candidates,
            allow_overlap,
            duration,
            &ctx.now,
            id,
            &desc,
        ) {
            Ok(item_ops) => {
                ops.extend(item_ops);
                created += 1;
            }
            // Ocurrencias pasadas (hoy ya empezadas) o solapadas: se saltan, no abortan.
            Err(_) => continue,
        }
    }

    if created == 0 {
        return Err(
            "no_occurrences: todas las ocurrencias de la ventana están en el pasado o solapadas"
                .to_string(),
        );
    }
    Ok(Output { operations: ops, events: vec![] })
}

/// Parsea `HH:MM` (o `HH:MM:SS`) → (hora, minuto).
fn parse_hhmm(s: &str) -> Option<(i64, i64)> {
    let mut it = s.trim().split(':');
    let h: i64 = it.next()?.parse().ok()?;
    let m: i64 = it.next()?.parse().ok()?;
    ((0..24).contains(&h) && (0..60).contains(&m)).then_some((h, m))
}
