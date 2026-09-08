import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
// Vista por profesional: se REUTILIZA el timeline de recursos que OutfitKit ya trae
// (appointments#21) en vez de inventar una rejilla propia — una fila por profesional,
// bloques posicionados por hora, navegación de día incluida.
import '@erplora/outfitkit/ok-scheduler';
// appointments#91 — la vista de SERIES vive aquí dentro, no en una entrada de navegación propia:
// una página de series colgada del menú sería huérfana (ningún producto del sector la tiene), y
// desde la agenda es donde la recepcionista ya está mirando cuando se acuerda de la serie.
import '../erp-appointments-series/erp-appointments-series';
import type { DataTableColumn } from '@erplora/outfitkit';
// i18n (ADR-0055): catálogo `ui` inlineado por esbuild; los textos internos se resuelven
// con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
// appointments#12: el reloj de esta pantalla es el del NEGOCIO (`erplora.timezone`, resuelta por
// el core), nunca el del aparato. Ver `ui/lib/business-time.ts`.
import {
  todayISO,
  addDaysISO,
  dayBounds,
  wallClock,
  formatWallTime,
  toInputValue,
  wallToBusinessIso,
  toInstantMs,
  deviceZoneDiffers,
  businessTimezone,
  InvalidLocalTimeError,
} from '../../lib/business-time';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
  /** Toast del shell (canal de feedback del TPV de sales). Opcional: preview sin SDK. */
  notify?(n: { type: string; message: string }): void;
}

interface Appointment {
  id: string;
  appointment_number: string;
  customer_id: string | null;
  customer_name: string;
  service_id: string | null;
  service_name: string;
  service_price: number;
  staff_id: string | null;
  staff_name: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
  status: string;
  /** Venta nacida de esta cita (ADR-0077), o null si aún no se ha cobrado. La escribe el listener
   *  `_mark_converted` al recibir `sales.sale.created_from_appointment`; sales#89 la saca por fin
   *  en la query para que la agenda pueda contestar «¿esta cita ya se cobró?». */
  converted_sale_id: string | null;
  /** La serie de la que salió esta cita, o `null` si se reservó suelta (appointments#15). Con
   *  ella puesta, mover la cita pregunta el ALCANCE antes de escribir nada. */
  recurring_id: string | null;
  /** El día de PARED que la plantilla generó — la clave de la ocurrencia, no el hueco donde la
   *  cita acabó. Es lo que el corte de «esta y las siguientes» nombra. */
  occurrence_date: string | null;
}

/** Ficha mínima de cliente que necesita el alta (de `customers.list`). */
interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

/** Servicio reservable (de `services.services.list`): aporta duración y precio. */
interface Service {
  id: string;
  name: string;
  price?: number;
  duration_minutes?: number;
  is_bookable?: number;
}

/** Profesional (de `staff.members.list`): solo los `is_bookable` reciben citas. */
interface StaffMember {
  id: string;
  full_name: string;
  status?: string;
  is_bookable?: number;
  color?: string;
}

interface AppointmentSettings {
  calendar_start_hour?: number;
  calendar_end_hour?: number;
  default_duration?: number;
  /** Whether this hub lets two appointments share a slot. `appointments.settings.get` publishes
   *  the flags as JSON booleans (appointments#79); older rows may still answer 0/1. */
  allow_overlapping?: boolean | number;
}

const STATUS_KEYS: Record<string, string> = {
  pending: 'ui.statusPending',
  confirmed: 'ui.statusConfirmed',
  in_progress: 'ui.statusInProgress',
  completed: 'ui.statusCompleted',
  cancelled: 'ui.statusCancelled',
  no_show: 'ui.statusNoShow',
};

/** Color del bloque en el timeline por estado (los tokens del tema, no hex sueltos). */
const STATUS_COLORS: Record<string, string> = {
  pending: 'var(--ion-color-medium, #92949c)',
  confirmed: 'var(--ion-color-primary, #3880ff)',
  in_progress: 'var(--ion-color-warning, #ffc409)',
  completed: 'var(--ion-color-success, #2dd36f)',
  cancelled: 'var(--ion-color-danger, #eb445a)',
  no_show: 'var(--ion-color-danger, #eb445a)',
};

/** Carril del timeline para las citas SIN profesional asignado (filas heredadas). */
const UNASSIGNED = 'unassigned';

/** Detail de `ok-event-move` (OutfitKit#64): la rejilla ha PINTADO el bloque en su destino y
 *  pregunta. `revert()` es cómo este módulo dice «el servidor dijo que no». */
interface SchedulerMoveDetail {
  id: string;
  /** Carril donde cayó el bloque (`HH:MM` locales de pared en `start`/`end`). */
  resourceId: string;
  start: string;
  end: string;
  from: { resourceId: string; start: string; end: string };
  revert(): void;
}

/** Estados que `appointments.appointments.reschedule` acepta (el handler los comprueba contra
 *  la fila leída, y `_reschedule_state_assert.sql` cierra la carrera dentro de la transacción).
 *  La barra pinta la acción DESHABILITADA fuera de estos: el command ya lo rechaza, pero un botón
 *  que se puede pulsar y siempre falla es peor que uno gris. */
const RESCHEDULABLE = ['pending', 'confirmed'];

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

/** The `errors` catalog of `locales/{en,es}.json`, resolved by the active language.
 *
 *  It is NOT reachable through `erplora().t()`: that helper splits the key on dots to walk the
 *  catalog, and this module's `errors` block is FLAT — the whole namespaced code is ONE key
 *  (`"appointments.too_soon"`), which is the shape its contract tests pin and four other modules
 *  ship. So the lookup happens here, with the same fallback `locale → en → nothing`. */
function catalogError(code: string): string {
  for (const lang of [erplora().locale, 'en']) {
    const dict = (CATALOG[lang] as { errors?: Record<string, string> } | undefined)?.errors;
    const text = dict?.[code];
    if (typeof text === 'string' && text) return text;
  }
  return '';
}

/** A business refusal (hub#139) travels as a stable `code` plus the handler's English fallback
 *  sentence: paint the code's TRANSLATION, and keep the sentence for codes the catalog has not
 *  learned yet — same idea as `customers` (`erp-customers-list.ts::domainErrorText`).
 *
 *  appointments#70: until the overlap got its own code, the refusal this screen shows most often
 *  reached it as a Spanish sentence hard-coded in a Rust `format!` — untranslatable by
 *  construction, and different from the sentence the WhatsApp inbox painted for the very same
 *  refusal. Every refusal of the module is a code now, which is what turns the `errors` block from
 *  decoration into the text the receptionist actually reads.
 *
 *  Only OUR codes: another module's (or the core's) is not in this catalog, and its own sentence
 *  beats anything this one could invent for it. */
function domainErrorText(e: unknown, fallbackKey: string): string {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : '';
  if (typeof code === 'string' && code.startsWith('appointments.')) {
    const text = catalogError(code);
    if (text) return text;
  }
  return message || erplora().t(CATALOG, fallbackKey);
}



/** Filas de una query: el motor paginado devuelve `{rows,total,…}`; las simples, un array. */
function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: T[] }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/** Hora de la cita en el reloj del NEGOCIO, en el idioma activo.
 *
 * appointments#12: antes esto pintaba con la hora del APARATO (`toLocaleTimeString` sin zona). Un
 * iPad configurado en otro país listaba el día del salón desplazado — y antes de eso, pintaba
 * directamente en UTC y una cita de las 09:30 en Madrid salía como «07:30». */
const fmtTime = (iso: string): string => formatWallTime(iso, businessTimezone(), erplora().locale);

export class ErpAppointmentsList extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa el resto (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table, .page > ok-scheduler { flex:1 1 auto; min-height:0; }
    /* ALCANCE de la consulta (día + estado) y modo de vista: no son filtros de columna.
       appointments#93 · UNA fila, no tres. Medido a 390 px, este bloque ocupaba ~300 px: era
       flex-wrap:wrap con tres controles a tamaño completo (el input de fecha con etiqueta
       flotante, el select de estado y el segment), y en un móvil cada uno caía a su propia línea,
       así que la primera cita empezaba por debajo del 55 % de la pantalla. nowrap + controles
       que ENCOGEN es lo que hacen Fresha, Vagaro, Square Appointments y Google Calendar: el día
       manda y ocupa el hueco libre, lo secundario se estrecha. Mismo movimiento que tables#64 y
       kitchen#60. */
    .filters { display:flex; gap:.5rem; align-items:center; margin:0 0 .5rem; flex-wrap:nowrap; }
    /* El día: paso atrás · fecha · paso adelante, como una sola pieza. Se queda con el ancho que
       sobre (min-width:0 para que de verdad pueda encoger dentro de un flex). */
    .filters .daynav { display:flex; align-items:center; gap:.15rem; flex:1 1 auto; min-width:0; }
    /* 6.5rem es lo que mide una fecha completa (17/08/2026) en el input nativo: por debajo, el
       navegador la CORTA y la agenda deja de decir qué día está enseñando. El tope de 11rem es lo
       contrario: en un escritorio ancho, un input elástico separaba el paso adelante media
       pantalla del día que iba a cambiar, y dejaban de leerse como un solo mando. */
    .filters .daynav ion-input { flex:1 1 auto; min-width:6.5rem; max-width:11rem; }
    /* 44×44 es el suelo táctil (Ionic lo aplica a sus propios controles y es lo que exige el QA de
       las tres ventanas): un paso de día de 28 px se falla con el pulgar en una tablet de barra. */
    .filters .daynav ion-button { flex:0 0 auto; height:44px; width:44px; --padding-start:.25rem; --padding-end:.25rem; margin:0; }
    .filters ion-select { flex:0 1 9rem; min-width:5.5rem; }
    /* Ionic le da al host de ion-segment un width:100%: a solas, ES una fila entera. */
    .filters ion-segment { flex:0 0 auto; width:auto; margin-left:auto; }
    .filters ion-segment-button { min-height:44px; --padding-start:.5rem; --padding-end:.5rem; text-transform:none; }
    .filters ion-segment-button ion-icon { font-size:1.15rem; }
    /* En un teléfono el texto de la vista lo dice el icono: «Por profesional» son 120 px que
       empujan el día fuera de la fila. El nombre accesible sigue en el aria-label. */
    @media (max-width: 640px) {
      .filters { gap:.25rem; }
      .filters ion-segment-button ion-label { display:none; }
      .filters ion-segment-button { --padding-start:.2rem; --padding-end:.2rem; min-width:2.3rem; }
      /* 40 px de ancho (44 de alto, el suelo táctil se mantiene): son los 8 px que le faltan al
         estado para escribir «Todos» entero en 390 px. */
      .filters .daynav ion-button { width:40px; }
      .filters ion-select { flex:0 1 5.5rem; min-width:4.5rem; }
    }
    /* Formulario del panel de alta (drawer estrecho) → una columna, no en fila. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
    /* Reprogramar: el profesional es contexto (no se edita aquí) y las dos salidas van juntas. */
    .form .ctx { margin:0; font-size:.9rem; color: var(--ion-color-medium, #92949c); }
    .form .actions { display:flex; gap:.5rem; justify-content:flex-end; align-items:center; }
    .form .actions ion-button { align-self:auto; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() items: Appointment[] = [];

  @state() loading = true;

  @state() error = '';

  @state() saving = false;

  @state() day = todayISO();

  @state() statusFilter = '';

  /** `list` = tabla del día · `staff` = timeline por profesional (appointments#21). */
  @state() view: 'list' | 'staff' | 'series' = 'list';

  // Catálogos ligados: la cita se reserva contra registros reales, no contra texto libre.
  @state() customers: Customer[] = [];

  @state() services: Service[] = [];

  @state() staffMembers: StaffMember[] = [];

  @state() settings: AppointmentSettings = {};

  @state() newCustomerId = '';

  @state() newServiceId = '';

  @state() newStaffId = '';

  @state() newStart = '';

  @state() newDuration = '';

  // ── Reprogramar (appointments#42) ──────────────────────────────────────────────────────────
  // El panel es EL MISMO que el del alta: `ok-data-table.open('create')` está pensado para esto
  // («editar abre el form pre-rellenado», ok-data-table.ts:848). Con `rescheduleId` puesto, el
  // hueco `create` pinta el formulario de mover en vez del de alta.
  /** Cita que se está moviendo; `''` = el panel está en modo alta. */
  @state() rescheduleId = '';

  /** Nuevo inicio, en hora LOCAL de pared (`datetime-local`). */
  @state() rescheduleStart = '';

  @state() rescheduleDuration = '';

  /** Solo para enseñarlo: `reschedule` mueve la hora, no cambia de profesional (ver render). */
  @state() rescheduleStaffName = '';

  /** Su profesional, para preguntar el solape contra la agenda correcta (appointments#86). */
  @state() rescheduleStaffId = '';
  /** appointments#15 — la serie de la cita que se está moviendo (`''` = ninguna) y su ocurrencia.
   *  Se copian de la fila al abrir el panel: la agenda ya las tiene, y volver a preguntárselas al
   *  servidor sería una segunda verdad. */
  @state() rescheduleSeriesId = '';
  @state() rescheduleOccurrence = '';
  /** ¿Está la pregunta del alcance en pantalla? Se enciende AL GUARDAR, no al abrir el panel —
   *  Google, Apple y Fresha preguntan al guardar; Outlook pregunta al abrir y es justo la
   *  fricción que la gente reporta (decides el alcance antes de saber qué vas a cambiar). */
  @state() askingSeriesScope = false;
  /** El alcance elegido. `this_only` viene preseleccionado: es el menos destructivo y el default
   *  de Google, Odoo y Apple. `all` NO EXISTE — reescribiría un pasado ya cobrado y sellado. */
  @state() seriesScope: 'this_only' | 'this_and_following' = 'this_only';

  // ── Aviso de SOLAPE (appointments#86) ───────────────────────────────────────────────────────
  /** La frase que dice CON QUÉ choca el hueco; `''` = no hay aviso en pantalla. */
  @state() overlapPrompt = '';

  /** Quien está esperando la respuesta del aviso. `null` = nadie pregunta ahora mismo. */
  private overlapDecision: ((accepted: boolean) => void) | null = null;

  private unsub?: () => void;

  // i18n (ADR-0055): re-renderiza al recibir `erplora:locale-changed`.
  private readonly onLocaleChange = (): void => this.requestUpdate();

  private statusLabel(status: string): string {
    const key = STATUS_KEYS[status];
    return key ? erplora().t(CATALOG, key) : status;
  }

  /** Profesionales que pueden recibir citas: los que el módulo `staff` marca reservables. */
  private get bookableStaff(): StaffMember[] {
    return this.staffMembers.filter((m) => Number(m.is_bookable) === 1 && m.status !== 'terminated');
  }

  private get selectedService(): Service | undefined {
    return this.services.find((s) => s.id === this.newServiceId);
  }

  /** Duración efectiva: la tecleada manda; si no, la del servicio; si no, la de los ajustes. */
  private get effectiveDuration(): number {
    const typed = Number(this.newDuration);
    if (Number.isFinite(typed) && typed >= 1) return typed;
    const fromService = Number(this.selectedService?.duration_minutes);
    if (Number.isFinite(fromService) && fromService >= 1) return fromService;
    const fromSettings = Number(this.settings.default_duration);
    return Number.isFinite(fromSettings) && fromSettings >= 1 ? fromSettings : 60;
  }

  /** appointments#75: elegir servicio PRERRELLENA «Min.» con su duración de catálogo. La
   *  pantalla ya la sabía (viajaba en el payload) pero el campo quedaba VACÍO con el número
   *  solo como placeholder: la recepcionista no veía cuánto iba a durar la reserva, así que
   *  no podía detectar un catálogo mal puesto ni ajustar a ojo. El servicio ES la duración
   *  (Fresha, Vagaro, Square Appointments, Booksy); lo que se teclea es la excepción — y
   *  cambiar de servicio re-llena desde el nuevo, porque la excepción era del anterior. */
  private onServiceChange(serviceId: string): void {
    this.newServiceId = serviceId;
    const fromCatalogue = Number(this.services.find((s) => s.id === serviceId)?.duration_minutes);
    this.newDuration = Number.isFinite(fromCatalogue) && fromCatalogue >= 1 ? String(fromCatalogue) : '';
  }

  // Getters (no campos): se re-evalúan en cada render para seguir el idioma activo.
  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'start_datetime', header: t('ui.colTime'), format: (r) => fmtTime(r.start_datetime as string) },
      { key: 'appointment_number', header: t('ui.colNumber') },
      { key: 'customer_name', header: t('ui.colCustomer') },
      { key: 'service_name', header: t('ui.colService') },
      { key: 'staff_name', header: t('ui.colStaff'), format: (r) => (r.staff_name as string) || '—' },
      {
        key: 'status',
        header: t('ui.colStatus'),
        format: (r) => this.statusLabel(r.status as string),
      },
    ];
  }

  private get rowActions() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      // COBRAR (sales#89): el eslabón que faltaba. La agenda sabía completar una cita y ahí se
      // acababa el camino; en un salón el servicio ES la venta.
      //
      // Una cita ya convertida se pinta DESHABILITADA, no se esconde: cobrar dos veces a la misma
      // clienta es el fallo a evitar, pero un botón que desaparece deja al mostrador sin saber por
      // qué. `converted_sale_id` lo escribe el listener de `sales.sale.created_from_appointment`.
      {
        id: 'charge', label: t('ui.actionCharge'), icon: 'cash-outline', color: 'success',
        disabled: (row: Record<string, unknown>) => !!row.converted_sale_id,
      },
      // REPROGRAMAR (appointments#42): sin este gesto, mover una cita obligaba a cancelarla y
      // crearla de nuevo — la cita perdía su número, su identidad y su historial, y a la clienta
      // le quedaba en la ficha una cancelación que nunca pidió. El command ya existía.
      //
      // Fuera de pending|confirmed se pinta gris: es lo que acepta el handler de `reschedule`.
      {
        id: 'reschedule', label: t('ui.actionReschedule'), icon: 'calendar-outline', color: 'primary',
        disabled: (row: Record<string, unknown>) => !RESCHEDULABLE.includes(String(row.status)),
      },
      { id: 'confirm', label: t('ui.actionConfirm'), icon: 'checkmark-circle-outline', color: 'success' },
      { id: 'start', label: t('ui.actionStart'), icon: 'play-circle-outline', color: 'primary' },
      { id: 'complete', label: t('ui.actionComplete'), icon: 'checkmark-done-outline', color: 'success' },
      // El no-show existía en la API desde el día 1 pero no en la barra: la recepcionista no
      // tenía forma de registrar que la clienta no vino (appointments#21).
      { id: 'no_show', label: t('ui.actionNoShow'), icon: 'person-remove-outline', color: 'warning' },
      { id: 'cancel', label: t('ui.actionCancel'), icon: 'close-circle-outline', color: 'danger' },
      { id: 'delete', label: t('ui.actionDelete'), icon: 'trash-outline', color: 'danger' },
    ];
  }

  /** Carriles del timeline: un profesional reservable por fila + el carril «sin asignar», que
   *  se pinta SIEMPRE para que ninguna cita heredada (sin `staff_id`) quede invisible. */
  private get schedulerResources() {
    return [
      ...this.bookableStaff.map((m) => ({ id: m.id, label: m.full_name })),
      { id: UNASSIGNED, label: erplora().t(CATALOG, 'ui.unassigned') },
    ];
  }

  private get schedulerEvents() {
    return this.items.map((a) => ({
      id: a.id,
      resourceId: a.staff_id || UNASSIGNED,
      start: wallClock(a.start_datetime),
      end: wallClock(a.end_datetime),
      title: [a.customer_name, a.service_name].filter(Boolean).join(' · '),
      color: STATUS_COLORS[a.status],
    }));
  }

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    await this.refresh();
    await this.loadCatalogs();
    try {
            // Una suscripción por evento, con su literal EN la llamada (ADR-0127: el extractor
      // de contratos no sigue arrays; el nombre vive donde se usa).
      const offs = [
        erplora().on('appointments.appointment.created', () => this.refresh()),
        erplora().on('appointments.appointment.updated', () => this.refresh()),
        erplora().on('appointments.appointment.confirmed', () => this.refresh()),
        erplora().on('appointments.appointment.started', () => this.refresh()),
        erplora().on('appointments.appointment.completed', () => this.refresh()),
        erplora().on('appointments.appointment.cancelled', () => this.refresh()),
        erplora().on('appointments.appointment.no_show', () => this.refresh()),
        erplora().on('appointments.appointment.rescheduled', () => this.refresh()),
        erplora().on('appointments.appointment.deleted', () => this.refresh()),
      ];
      this.unsub = () => offs.forEach((off) => off());
    } catch {
      /* sin SDK (preview) → sin reactividad en vivo */
    }
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
    this.unsub?.();
    // Una pregunta sin pantalla no se contesta sola: se resuelve como CANCELADA, que es la salida
    // que no escribe nada. Dejarla colgada filtraría la promesa y el `saving` del panel.
    this.settleOverlap(false);
  }

  /** Catálogos ligados + ajustes. Se cargan una vez: el alta reserva contra registros reales
   *  (`customers` / `services` / `staff`) vía sus queries PÚBLICAS — nunca sus tablas. */
  private async loadCatalogs() {
    try {
      const [customers, services, staffMembers, settings] = await Promise.all([
        erplora().query('customers.list', { limit: 500, sort: 'name', dir: 'asc' }).catch(() => []),
        erplora().query('services.services.list', { limit: 500 }).catch(() => []),
        erplora().query('staff.members.list', { limit: 500 }).catch(() => []),
        erplora().query('appointments.settings.get').catch(() => []),
      ]);
      this.customers = rows<Customer>(customers);
      // Un servicio no reservable (p. ej. interno) no puede recibir una cita.
      this.services = rows<Service>(services).filter((s) => s.is_bookable === undefined || Number(s.is_bookable) === 1);
      this.staffMembers = rows<StaffMember>(staffMembers);
      this.settings = rows<AppointmentSettings>(settings)[0] ?? {};
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errLoadCatalogs');
    }
  }

  /** Un día atrás o adelante (appointments#93). Aritmética de CALENDARIO: el día del salón dura
   *  23, 24 o 25 horas, así que «mañana» es la fecha siguiente, nunca `+24 h`. */
  private stepDay(delta: number): void {
    this.day = addDaysISO(this.day, delta);
    void this.refresh();
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const { day_start, day_end } = dayBounds(this.day);
      const result = await erplora().query('appointments.appointments.list', {
        day_start,
        day_end,
        status: this.statusFilter,
        staff_id: '',
        limit: 100,
      });
      this.items = rows<Appointment>(result);
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errLoad');
    } finally {
      this.loading = false;
    }
  }

  // Referencia al ok-data-table para abrir/cerrar su panel lateral (el «+» de su barra).
  private dataTable(): { open(p?: 'filters' | 'create'): void; close(): void } | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | { open(p?: 'filters' | 'create'): void; close(): void }
      | null;
  }

  private async createAppointment(ev: Event) {
    ev.preventDefault();
    const customer = this.customers.find((c) => c.id === this.newCustomerId);
    const service = this.selectedService;
    const staff = this.bookableStaff.find((m) => m.id === this.newStaffId);
    // El alta exige los tres vínculos (appointments#21): sin ellos la cita no se puede
    // agrupar por profesional, ni comprobar disponibilidad, ni encadenar con la venta.
    if (!customer || !service || !staff || !this.newStart) return;
    this.saving = true;
    this.error = '';
    try {
      // El input datetime-local da 'YYYY-MM-DDTHH:MM'; se normaliza a ISO con la PARED local y
      // su offset (appointments#76): el instante es el elegido y el texto guardado dice la hora
      // que el salón ve en la pared, que es el reloj del motor de disponibilidad.
      const startIso = wallToBusinessIso(this.newStart);
      // appointments#86 — con el solape PERMITIDO, se avisa antes de escribir; cancelar deja el
      // panel como estaba (el `finally` suelta `saving`, así que el botón vuelve a responder).
      if (!(await this.overlapAccepted(startIso, this.effectiveDuration, staff.id))) return;
      await erplora().command('appointments.appointments.create', {
        // Vínculos + su snapshot denormalizado (lo que se reservó, aunque la ficha cambie).
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone ?? '',
        customer_email: customer.email ?? '',
        service_id: service.id,
        service_name: service.name,
        service_price: Number(service.price) || 0,
        staff_id: staff.id,
        staff_name: staff.full_name,
        start_datetime: startIso,
        duration_minutes: this.effectiveDuration,
      });
      this.newCustomerId = '';
      this.newServiceId = '';
      this.newStaffId = '';
      this.newStart = '';
      this.newDuration = '';
      this.dataTable()?.close(); // el panel del «+» taparía la tabla y la cita recién creada
      await this.refresh();
    } catch (e) {
      this.error = domainErrorText(e, 'ui.errCreate');
    } finally {
      this.saving = false;
    }
  }

  // ── Aviso de SOLAPE (appointments#86) ───────────────────────────────────────────────────────
  //
  // Lo que decidió el mercado, y es unánime en las cinco referencias del sector (Phorest, Square
  // Appointments, DaySmart/Salon Iris, Fresha, Vagaro): **el solape se CONFIRMA, no se asume**. Con
  // el toggle apagado el rechazo duro ya existía (`_appointment_overlap_assert.sql`); lo que
  // faltaba era el paso intermedio del caso PERMITIDO, donde hoy la cita se creaba en silencio.
  // ADR-0383 lo dejó fuera del componente a propósito: `ok-scheduler` pinta el solape bien, pero
  // no sabe —ni debe— de reglas de negocio. El aviso es del módulo.
  //
  // 🔴 Lo que NO pregunta, y por qué:
  //  · `appointments._book_from_request` (el listener de `whatsapp_inbox.request.approved`) corre
  //    en el servidor y no tiene a quién preguntar. Su confirmación humana YA ocurrió —alguien
  //    aprobó la petición en la bandeja, sobre huecos que `availability.slots` había ofrecido— así
  //    que reserva directamente, con el mismo gate de servidor que el resto. Un aviso ahí sería
  //    una pregunta sin interlocutor que dejaría la petición aprobada sin cita.
  //  · Mover una SERIE entera (`recurring.update`, alcance «esta y las siguientes») no es un hueco:
  //    son N ocurrencias que el servidor recoloca. Queda fuera con su issue.

  /** ¿Permite este hub dos citas a la vez? El flag viaja como booleano JSON (appointments#79),
   *  pero una fila vieja puede seguir contestando 0/1: las dos formas se leen igual. */
  private get allowsOverlapping(): boolean {
    const flag = this.settings.allow_overlapping;
    return flag === true || Number(flag) === 1;
  }

  /** Citas vivas del mismo profesional que pisan `[start, start+minutes)`.
   *
   *  Se lee la query PÚBLICA del módulo (`appointments.appointments.conflicting`, la misma que el
   *  runtime precarga para el handler de `create`) y no `this.items`: el hueco elegido puede caer
   *  en otro día del que la agenda tiene cargado, y avisar solo de lo que está en pantalla sería
   *  un aviso que falla justo cuando hace falta. El filtrado fino por ventana es de aquí, igual
   *  que en el handler: la query trae el día entero porque `reads.params` solo admite literales. */
  private async overlappingWith(
    startIso: string,
    minutes: number,
    staffId: string,
    excludeId = '',
  ): Promise<Appointment[]> {
    const from = toInstantMs(startIso);
    if (from === null || !Number.isFinite(minutes) || minutes < 1) return [];
    const to = from + minutes * 60_000;
    const found = await erplora().query('appointments.appointments.conflicting', {
      staff_id: staffId,
      start_datetime: startIso,
    });
    return rows<Appointment>(found).filter((a) => {
      if (a.id === excludeId) return false; // una cita no se solapa consigo misma
      const s = toInstantMs(a.start_datetime);
      const e = toInstantMs(a.end_datetime);
      // Bordes que se tocan no solapan: `[start, end)`, la misma convención que el gate.
      return s !== null && e !== null && s < to && e > from;
    });
  }

  /** Pinta el aviso y espera. La promesa la resuelven los botones del `ion-alert`. */
  private askOverlap(conflicts: Appointment[]): Promise<boolean> {
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    const list = conflicts
      .map((a) => `${a.customer_name || t('ui.colCustomer')} · ${fmtTime(a.start_datetime)}`)
      .join(', ');
    return new Promise<boolean>((resolve) => {
      this.overlapPrompt = t('ui.overlapMessage', { conflicts: list });
      this.overlapDecision = resolve;
    });
  }

  /** «Reservar igual». */
  confirmOverlap(): void {
    this.settleOverlap(true);
  }

  /** «Elegir otra hora»: no se escribe nada y lo tecleado sigue en el panel. */
  cancelOverlap(): void {
    this.settleOverlap(false);
  }

  private settleOverlap(accepted: boolean): void {
    const decide = this.overlapDecision;
    this.overlapDecision = null;
    this.overlapPrompt = '';
    decide?.(accepted);
  }

  /** La puerta que cruzan `create`, `reschedule` y el arrastre. `true` = se puede escribir.
   *
   *  Con el toggle APAGADO no pregunta nada: el servidor rechaza, y ofrecer un «reservar igual»
   *  que siempre va a fallar es peor que no ofrecerlo. Si la lectura de la agenda falla, la reserva
   *  NO se pierde —el aviso es consejo, no cerradura— pero el fallo se DICE: una comprobación que
   *  se cae en silencio es la que hace creer que no había solape. */
  private async overlapAccepted(
    startIso: string,
    minutes: number,
    staffId: string,
    excludeId = '',
  ): Promise<boolean> {
    if (!this.allowsOverlapping) return true;
    let conflicts: Appointment[];
    try {
      conflicts = await this.overlappingWith(startIso, minutes, staffId, excludeId);
    } catch {
      erplora().notify?.({ type: 'warning', message: erplora().t(CATALOG, 'ui.errOverlapCheck') });
      return true;
    }
    if (conflicts.length === 0) return true;
    return this.askOverlap(conflicts);
  }

  /** Manda al shell a la pantalla de venta con la cita cargada.
   *
   *  Un Web Component no recibe el router: el único canal de navegación módulo→shell es empujar la
   *  URL y avisar con `popstate`, que es el patrón que ya usa `verifactu`. El id viaja por query
   *  string y el TPV lo consume y lo borra. */
  private goToTill(appointmentId: string): void {
    window.history.pushState({}, '', `/m/sales/pos?appointment_id=${encodeURIComponent(appointmentId)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const id = row.id as string;
    this.error = '';
    try {
      switch (actionId) {
        // ADR-0077: COBRAR es trabajo del TPV, no de la agenda. Aquí no se arma ninguna venta ni
        // se calcula ningún total: se le entrega el id de la cita y el TPV la lee por la query
        // pública de este módulo. `appointments` nunca aprende qué es una venta.
        case 'charge':
          this.goToTill(id);
          return; // navegamos fuera: refrescar la agenda que abandonamos no tiene sentido
        case 'reschedule':
          await this.openReschedule(row);
          return; // abre el panel; no hay nada que refrescar todavía
        case 'confirm':
          await erplora().command('appointments.appointments.confirm', { appointment_id: id });
          break;
        case 'start':
          await erplora().command('appointments.appointments.start', { appointment_id: id });
          break;
        case 'complete':
          await erplora().command('appointments.appointments.complete', { appointment_id: id });
          break;
        case 'no_show':
          await erplora().command('appointments.appointments.no_show', { appointment_id: id });
          break;
        case 'cancel':
          await erplora().command('appointments.appointments.cancel', { appointment_id: id, reason: '' });
          break;
        case 'delete':
          await erplora().command('appointments.appointments.delete', { appointment_id: id });
          break;
      }
      await this.refresh();
    } catch (e) {
      this.error = domainErrorText(e, 'ui.errAction');
    }
  }

  /** Abre el panel en modo ALTA, limpiando cualquier reprogramación a medias.
   *
   *  El «+» de la barra lo despacha el módulo (`primaryAction`) en vez de dejárselo a `addable`,
   *  precisamente por esto: el panel es uno solo y con `addable` la tabla lo abría por su cuenta,
   *  así que cerrar un «reprogramar» con el scrim y pulsar «+» a continuación te devolvía el
   *  formulario de mover la cita anterior. */
  private async openCreate() {
    this.clearReschedule();
    await this.updateComplete;
    this.dataTable()?.open('create');
  }

  private clearReschedule(): void {
    this.rescheduleId = '';
    this.rescheduleStart = '';
    this.rescheduleDuration = '';
    this.rescheduleStaffName = '';
    this.rescheduleStaffId = '';
    this.rescheduleSeriesId = '';
    this.rescheduleOccurrence = '';
    this.askingSeriesScope = false;
    this.seriesScope = 'this_only';
  }

  /** Abre el panel pre-rellenado con la cita que se va a mover. La fila manda: no se re-teclea
   *  nada que ya esté guardado. Fuera de pending|confirmed no se abre — el command lo rechazaría
   *  y el panel habría prometido algo que no puede cumplir. */
  private async openReschedule(row: Record<string, unknown>) {
    if (!RESCHEDULABLE.includes(String(row.status))) return;
    this.rescheduleId = String(row.id ?? '');
    this.rescheduleStart = toInputValue(String(row.start_datetime ?? ''));
    this.rescheduleDuration = String(row.duration_minutes ?? '');
    this.rescheduleStaffName = String(row.staff_name ?? '');
    this.rescheduleStaffId = String(row.staff_id ?? '');
    this.rescheduleSeriesId = String(row.recurring_id ?? '');
    this.rescheduleOccurrence = String(row.occurrence_date ?? '');
    this.error = '';
    this.view = 'list'; // el panel vive en la tabla
    await this.updateComplete;
    this.dataTable()?.open('create');
  }

  /** Bloque del timeline → mismo panel pre-rellenado.
   *
   *  El ARRASTRE (appointments#74, `onEventMove`) es la mitad rápida del gesto; el clic es la
   *  mitad accesible —la ruta de teclado que `ok-scheduler` expone como botón enfocable— y en
   *  una tablet cuesta el mismo toque. Las dos llegan al mismo command. */
  private async onEventClick(ev: CustomEvent<{ id: string }>) {
    const row = this.items.find((a) => a.id === ev.detail.id);
    if (row) await this.openReschedule(row as unknown as Record<string, unknown>);
  }

  /** Arrastre del timeline (appointments#74): `ok-scheduler` pinta el bloque en su destino y
   *  pregunta; EL MÓDULO MANDA. La rejilla ya trae el gesto (outfitkit#64: puntero, y dedo tras
   *  una pulsación mantenida —el estándar del sector contra el arrastre accidental en tablet—,
   *  más las flechas de teclado), pero sin un host que escuche y persista, mover sería mentir.
   *
   *  Lo que NO hace este cableado, a propósito:
   *  · CAMBIAR DE PROFESIONAL. Soltar el bloque en otro carril ES un cambio de profesional, y
   *    `reschedule` mueve la hora nada más (appointments#11 sacó la identidad del profesional
   *    de las manos del llamante). Dejarlo «medio funcionar» guardaría la hora y enseñaría el
   *    carril: una mentira en la agenda. Se rechaza con un aviso claro y `revert()`.
   *  · CONFIRMAR LIGERO al soltar (el diálogo con «avisar a la clienta» de Vagaro/Fresha).
   *    Necesita un canal de notificación que este módulo no tiene; la reprogramación queda
   *    visible en la agenda refrescada y con su historial (`_history_reschedule`).
   *
   *  El rechazo del servidor (solape, bloqueo, antelación, estado terminal) llama `revert()`
   *  —el bloque vuelve a su sitio en vez de quedarse donde el servidor nunca lo aceptó— y el
   *  fallo se ve DOS veces: toast del shell (el arrastre pasa lejos del banner) y el
   *  `ok-inline-feedback` de siempre. */
  private async onEventMove(ev: CustomEvent<SchedulerMoveDetail>) {
    const { id, resourceId, start, revert } = ev.detail;
    const appointment = this.items.find((a) => a.id === id);
    if (!appointment) {
      revert(); // una cita que ya no está en el día cargado: no hay nada que mover
      return;
    }
    const lane = appointment.staff_id || UNASSIGNED;
    if (!RESCHEDULABLE.includes(appointment.status)) {
      revert();
      this.refuseDrag('ui.errDragNotMovable');
      return;
    }
    if (resourceId !== lane) {
      revert();
      this.refuseDrag('ui.errDragStaffChange');
      return;
    }
    try {
      // `start` es `HH:MM` de pared LOCAL del día visible — el mismo idioma que `ok-slot-click`.
      // Se escribe en el reloj del salón (pared + offset, appointments#76): mismo instante, y el
      // texto guardado es el que el motor de disponibilidad compara PARED contra PARED — una
      // pared UTC en una cita movida volvería a tachar la ventana desplazada por el offset.
      const startIso = wallToBusinessIso(`${this.day}T${start}`);
      // appointments#86 — soltar el bloque encima de otra cita pregunta antes de escribir. Si la
      // recepcionista elige otra hora, el bloque vuelve a su sitio: dejarlo donde nadie lo guardó
      // sería una agenda que miente hasta el siguiente refresco.
      if (
        !(await this.overlapAccepted(
          startIso,
          appointment.duration_minutes,
          appointment.staff_id || '',
          id,
        ))
      ) {
        revert();
        return;
      }
      await erplora().command('appointments.appointments.reschedule', {
        appointment_id: id,
        start_datetime: startIso,
        duration_minutes: appointment.duration_minutes,
      });
      await this.refresh(); // la posición optimista se descarta: manda la fila del servidor
    } catch (e) {
      revert();
      this.error = domainErrorText(e, 'ui.errReschedule');
      erplora().notify?.({ type: 'error', message: this.error });
    }
  }

  /** Rechazo local del arrastre: el bloque ya ha vuelto (`revert()`), queda DECIR por qué. */
  private refuseDrag(key: string): void {
    this.error = erplora().t(CATALOG, key);
    erplora().notify?.({ type: 'error', message: this.error });
  }

  /** Mueve la cita. Solo viajan las TRES claves del esquema
   *  (`schemas/appointment_reschedule.json` es `additionalProperties: false`: una clave de más
   *  y el payload entero se rechaza).
   *
   *  `end_datetime` ya NO se manda (appointments#10): el fin es aritmética —inicio + duración— y
   *  la hace el handler. Mandarlo desde aquí era una segunda opinión que podía no cuadrar con la
   *  duración, y nadie podía explicar la fila resultante.
   *
   *  El profesional NO se cambia aquí: mandarle un `staff_id` desde el navegador devolvería la
   *  identidad del profesional al llamante, que es justo lo que appointments#11 le quitó al alta.
   *  El handler lo lee de la fila de la cita. Cambiar de profesional es trabajo aparte. */
  private async submitReschedule(ev: Event) {
    ev.preventDefault();
    if (!this.rescheduleId || !this.rescheduleStart) return;
    const minutes = Math.trunc(Number(this.rescheduleDuration));
    if (!Number.isFinite(minutes) || minutes < 1) return;
    // appointments#15 — una cita de una SERIE no se mueve sin decir a qué alcanza el cambio.
    // Se pregunta aquí, al guardar, y no se escribe NADA hasta que hay respuesta.
    if (this.rescheduleSeriesId && this.rescheduleOccurrence) {
      this.seriesScope = 'this_only';
      this.askingSeriesScope = true;
      return;
    }
    await this.applyReschedule('this_only');
  }

  /** La recepcionista ha contestado la pregunta del alcance. */
  private async confirmSeriesScope(): Promise<void> {
    const scope = this.seriesScope;
    this.askingSeriesScope = false;
    await this.applyReschedule(scope);
  }

  /** Se echa atrás: no se escribe nada y lo tecleado sigue ahí — elige otra vez, no desde cero. */
  private cancelSeriesScope(): void {
    this.askingSeriesScope = false;
  }

  /** Escribe el movimiento con el alcance elegido.
   *
   *  `this_only` mueve UNA cita, que es lo que esta pantalla hacía siempre. `this_and_following`
   *  es otro command: parte la serie en dos y arrastra las ocurrencias futuras — el trabajo vive
   *  en el servidor, porque decidir cuáles se mueven exige saber cuáles están canceladas y cuáles
   *  ya se cobraron, y eso no se le pregunta al navegador. */
  private async applyReschedule(scope: 'this_only' | 'this_and_following'): Promise<void> {
    const minutes = Math.trunc(Number(this.rescheduleDuration));
    this.saving = true;
    this.error = '';
    try {
      if (scope === 'this_and_following') {
        await erplora().command('appointments.recurring.update', {
          recurring_id: this.rescheduleSeriesId,
          scope,
          from_occurrence_date: this.rescheduleOccurrence,
          // HORA DE PARED, no un instante: la hora de una plantilla es una lectura de reloj y no
          // se guarda convertida (appointments#12). El servidor la sitúa en la zona del negocio
          // día a día, que es lo que conserva la hora al cruzar el cambio de hora.
          time: this.rescheduleStart.slice(11, 16),
          duration_minutes: minutes,
        });
      } else {
        // Pared del salón + su offset (appointments#76/#12): mismo instante, y el texto dice la
        // hora que el salón ve en la pared.
        const startIso = wallToBusinessIso(this.rescheduleStart);
        // appointments#86 — mover una cita ENCIMA de otra avisa igual que crearla ahí. La propia
        // cita se excluye: si no, moverla dentro de su hueco preguntaría por sí misma.
        if (
          !(await this.overlapAccepted(startIso, minutes, this.rescheduleStaffId, this.rescheduleId))
        ) {
          return;
        }
        await erplora().command('appointments.appointments.reschedule', {
          appointment_id: this.rescheduleId,
          start_datetime: startIso,
          duration_minutes: minutes,
        });
      }
      this.clearReschedule();
      this.dataTable()?.close();
      await this.refresh();
    } catch (e) {
      // El solape lo rechaza el SERVIDOR (`_appointment_overlap_assert.sql`), y el festivo, la
      // antelación y el estado terminal los rechaza el handler con su código de dominio. El panel
      // se queda abierto con lo tecleado: la recepcionista elige otro hueco sin volver a empezar.
      this.error = domainErrorText(e, 'ui.errReschedule');
    } finally {
      this.saving = false;
    }
  }

  /** Hueco libre del timeline → se pre-rellena el alta con ESE profesional y ESA hora y se
   *  vuelve a la lista, donde vive el panel del «+». Reservar tocando el hueco es el gesto
   *  estándar de una agenda de salón. */
  private async onSlotClick(ev: CustomEvent<{ resourceId: string; time: string }>) {
    const { resourceId, time } = ev.detail;
    this.clearReschedule(); // el hueco vacío es un ALTA, no una mudanza
    if (resourceId !== UNASSIGNED) this.newStaffId = resourceId;
    this.newStart = `${this.day}T${time}`;
    this.view = 'list';
    await this.updateComplete;
    this.dataTable()?.open('create');
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const startHour = Number(this.settings.calendar_start_hour ?? 8);
    const endHour = Number(this.settings.calendar_end_hour ?? 20);
    return html`<div class="page">
        <!-- Día y estado NO son filtros de columna: son el ALCANCE de la consulta (los binds
             day_start/day_end/status de appointments.appointments.list, que no es una lista
             paginada del motor). Deciden QUÉ se carga → viven fuera del embudo de la tabla.
             El conmutador de vista (lista | por profesional) vive aquí por lo mismo: decide
             CÓMO se pinta lo cargado, no filtra columnas. -->
        <div class="filters">
          ${this.view === 'series'
            ? nothing
            : html`<!-- appointments#93 · el día se PASA, no solo se teclea. Es el gesto de toda agenda de
               salón (Fresha, Vagaro, Square, Google Calendar) y además cierra una asimetría que ya
               había: la vista por profesional podía cambiar de día con las flechas de ok-scheduler
               y la lista no. Sin etiqueta flotante: en un móvil son ~20 px de alto para decir
               «Día» encima de una fecha, y el nombre accesible viaja en aria-label. -->
          <div class="daynav">
            <ion-button data-role="prev-day" fill="clear" aria-label=${t('ui.prevDay')} @click=${() => this.stepDay(-1)}>
              <ion-icon slot="icon-only" name="chevron-back-outline"></ion-icon>
            </ion-button>
            <ion-input data-role="day" aria-label=${t('ui.fieldDate')} type="date" .value=${this.day} @ionInput=${(e: any) => {
              this.day = e.target.value;
              this.refresh();
            }}></ion-input>
            <ion-button data-role="next-day" fill="clear" aria-label=${t('ui.nextDay')} @click=${() => this.stepDay(1)}>
              <ion-icon slot="icon-only" name="chevron-forward-outline"></ion-icon>
            </ion-button>
          </div>
          <ion-select data-role="status" aria-label=${t('ui.filterStatus')} placeholder=${t('ui.allStatuses')} .value=${this.statusFilter} @ionChange=${(e: any) => {
              this.statusFilter = e.target.value;
              this.refresh();
            }}>
            <ion-select-option value="">${t('ui.statusAll')}</ion-select-option>
            ${Object.keys(STATUS_KEYS).map((k) => html`<ion-select-option .value=${k}>${this.statusLabel(k)}</ion-select-option>`)}
          </ion-select>`}
          <!-- El día y el estado son el ALCANCE de la consulta de la agenda; en la vista de series
               no filtran nada, así que se retiran en vez de quedarse prometiendo un filtro que no
               existe. El conmutador se queda: es lo único que sigue significando lo mismo. -->
          <ion-segment .value=${this.view} @ionChange=${(e: any) => (this.view = e.target.value)}>
            <ion-segment-button value="list" aria-label=${t('ui.viewList')}>
              <ion-icon name="list-outline"></ion-icon>
              <ion-label>${t('ui.viewList')}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="staff" aria-label=${t('ui.viewStaff')}>
              <ion-icon name="people-outline"></ion-icon>
              <ion-label>${t('ui.viewStaff')}</ion-label>
            </ion-segment-button>
            <!-- appointments#91: la tercera puerta. Sin ella una serie sin ocurrencias
                 materializadas no tiene NINGUNA fila desde la que abrirse. -->
            <ion-segment-button value="series" aria-label=${t('ui.viewSeries')}>
              <ion-icon name="repeat-outline"></ion-icon>
              <ion-label>${t('ui.viewSeries')}</ion-label>
            </ion-segment-button>
          </ion-segment>
        </div>
        <!-- appointments#12: el aparato NO manda, pero tampoco se le engaña en silencio. Si el
             tablet está en otra zona, la agenda sigue pintando el reloj del NEGOCIO y lo dice —
             el patrón que Square acabó adoptando tras años de citas movidas por el huso del
             dispositivo. Con los dos relojes de acuerdo no se pinta nada: un aviso permanente es
             un aviso que nadie lee. -->
        ${deviceZoneDiffers()
          ? html`<ok-inline-feedback tone="warning" icon="globe-outline"
              >${t('ui.deviceZoneNotice')} ${businessTimezone()}</ok-inline-feedback
            >`
          : nothing}
        ${this.error ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>` : nothing}
        <!-- appointments#15 — la pregunta del ALCANCE. Radios en un alert y no una action sheet
             (que es más nativa en móvil) por una razón concreta: la action sheet no puede llevar
             el AVISO de qué se va a pisar, y ese aviso es el contrato entero de la decisión. El
             botón primario nombra la acción; «OK» no dice qué va a pasar. -->
        ${this.askingSeriesScope
          ? html`<ion-alert
              .isOpen=${true}
              .header=${t('ui.seriesScopeTitle')}
              .message=${`${t('ui.seriesScopeMessage')} ${t('ui.seriesScopeMoved')} ${t('ui.seriesScopeCancelledKept')}`}
              .inputs=${[
                {
                  type: 'radio',
                  label: t('ui.seriesScopeThisOnly'),
                  value: 'this_only',
                  checked: this.seriesScope === 'this_only',
                  handler: () => (this.seriesScope = 'this_only'),
                },
                {
                  type: 'radio',
                  label: t('ui.seriesScopeFollowing'),
                  value: 'this_and_following',
                  checked: this.seriesScope === 'this_and_following',
                  handler: () => (this.seriesScope = 'this_and_following'),
                },
              ]}
              .buttons=${[
                { text: t('ui.cancelReschedule'), role: 'cancel', handler: () => this.cancelSeriesScope() },
                { text: t('ui.seriesScopeConfirm'), handler: () => this.confirmSeriesScope() },
              ]}
              @ionAlertDidDismiss=${() => this.cancelSeriesScope()}
            ></ion-alert>`
          : nothing}
        <!-- appointments#86 — el aviso de SOLAPE. Alert y no toast: un toast se va solo, y esto es
             una decisión que hay que tomar antes de escribir. El botón primario NOMBRA lo que va a
             pasar («Reservar igual»), y el de salida ofrece la alternativa real («Elegir otra
             hora») en vez de un «Cancelar» que no dice qué queda después. -->
        ${this.overlapPrompt
          ? html`<ion-alert
              data-role="overlap-confirm"
              .isOpen=${true}
              .header=${t('ui.overlapTitle')}
              .message=${this.overlapPrompt}
              .buttons=${[
                { text: t('ui.overlapCancel'), role: 'cancel', handler: () => this.cancelOverlap() },
                { text: t('ui.overlapConfirm'), handler: () => this.confirmOverlap() },
              ]}
              @ionAlertDidDismiss=${() => this.cancelOverlap()}
            ></ion-alert>`
          : nothing}
        ${this.view === 'series'
          ? html`<erp-appointments-series></erp-appointments-series>`
          : this.view === 'staff'
          ? html`<ok-scheduler
              .date=${this.day}
              .startHour=${startHour}
              .endHour=${endHour}
              .locale=${erplora().locale || 'es'}
              .resources=${this.schedulerResources}
              .events=${this.schedulerEvents}
              movable
              snap-minutes="15"
              .labels=${{ prevDay: t('ui.prevDay'), nextDay: t('ui.nextDay'), empty: t('ui.noStaff') }}
              @ok-nav=${(e: CustomEvent<{ date: string }>) => {
                this.day = e.detail.date;
                this.refresh();
              }}
              @ok-slot-click=${(e: CustomEvent<{ resourceId: string; time: string }>) => this.onSlotClick(e)}
              @ok-event-click=${(e: CustomEvent<{ id: string }>) => this.onEventClick(e)}
              @ok-event-move=${(e: CustomEvent<SchedulerMoveDetail>) => this.onEventMove(e)}
            ></ok-scheduler>`
          : html`<ok-data-table .fill=${true} .primaryAction=${{ label: t('ui.addAppointment'), icon: 'add' }} @primaryAction=${() => this.openCreate()} .labels=${this.rescheduleId ? { newRecord: t('ui.rescheduleTitle') } : {}} .views=${true} .cardTitle=${(row: Record<string, unknown>) => String(row.appointment_number ?? row.customer_name ?? '')} .columns=${this.columns} .rows=${this.items as unknown as Record<string, unknown>[]} .searchKeys=${['appointment_number', 'customer_name', 'service_name', 'staff_name']} .searchPlaceholder=${t('ui.searchPlaceholder')} .actions=${this.rowActions} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} .emptyMessage=${this.loading ? t('ui.loading') : t('ui.empty')}>
          <!-- El panel es UNO: alta si no hay cita en curso, mover si la hay (appointments#42). -->
          ${this.rescheduleId ? this.renderRescheduleForm(t) : this.renderCreateForm(t)}
        </ok-data-table>`}
      </div>`;
  }

  /** Mover la cita: solo el hueco. Cliente y servicio no se pintan porque `reschedule` no los
   *  toca — enseñarlos editables prometería un cambio que el command descarta. */
  private renderRescheduleForm(t: (k: string) => string) {
    return html`<form slot="create" data-mode="reschedule" class="form" @submit=${(e: Event) => this.submitReschedule(e)}>
      <ok-inline-feedback tone="info" icon="information-circle-outline">${t('ui.rescheduleHint')}</ok-inline-feedback>
      <p class="ctx">${t('ui.fieldStaff')}: <strong>${this.rescheduleStaffName || '—'}</strong></p>
      <ion-input data-role="reschedule-start" fill="outline" label-placement="floating" label=${t('ui.fieldStart')} type="datetime-local" .value=${this.rescheduleStart} @ionInput=${(e: any) => (this.rescheduleStart = e.target.value)}></ion-input>
      <ion-input data-role="reschedule-duration" fill="outline" label-placement="floating" label=${t('ui.fieldMinutes')} type="number" min="1" .value=${this.rescheduleDuration} @ionInput=${(e: any) => (this.rescheduleDuration = e.target.value)}></ion-input>
      <div class="actions">
        <ion-button type="button" size="small" fill="clear" @click=${() => { this.clearReschedule(); this.dataTable()?.close(); }}>${t('ui.cancelReschedule')}</ion-button>
        <ion-button type="submit" size="small" ?disabled=${this.saving || !this.rescheduleStart || !this.rescheduleDuration}>${this.saving ? t('ui.saving') : t('ui.confirmReschedule')}</ion-button>
      </div>
    </form>`;
  }

  /** Alta de cita: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se pintara
   *  al abrirlo, el «+» desplegaría un panel vacío en el primer clic.
   *  Cliente, servicio y profesional se ELIGEN de sus módulos (appointments#21): con
   *  texto libre la cita no se podía agrupar por profesional, ni casar con la
   *  disponibilidad, ni pasar a la venta sin re-teclear. */
  private renderCreateForm(t: (k: string) => string) {
    return html`<form slot="create" data-mode="create" class="form" @submit=${(e: Event) => this.createAppointment(e)}>
            <ion-select data-role="customer" fill="outline" label-placement="floating" label=${t('ui.fieldCustomer')} placeholder=${t('ui.pickCustomer')} .value=${this.newCustomerId} @ionChange=${(e: any) => (this.newCustomerId = e.target.value)}>
              ${this.customers.map((c) => html`<ion-select-option .value=${c.id}>${c.name}</ion-select-option>`)}
            </ion-select>
            <ion-select data-role="service" fill="outline" label-placement="floating" label=${t('ui.fieldService')} placeholder=${t('ui.pickService')} .value=${this.newServiceId} @ionChange=${(e: any) => this.onServiceChange(e.target.value)}>
              ${this.services.map((s) => html`<ion-select-option .value=${s.id}>${s.name}</ion-select-option>`)}
            </ion-select>
            <ion-select data-role="staff" fill="outline" label-placement="floating" label=${t('ui.fieldStaff')} placeholder=${t('ui.pickStaff')} .value=${this.newStaffId} @ionChange=${(e: any) => (this.newStaffId = e.target.value)}>
              ${this.bookableStaff.map((m) => html`<ion-select-option .value=${m.id}>${m.full_name}</ion-select-option>`)}
            </ion-select>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldStart')} type="datetime-local" .value=${this.newStart} @ionInput=${(e: any) => (this.newStart = e.target.value)}></ion-input>
            <!-- Minutos se PRERRELLENA al elegir servicio (appointments#75): la duración que la
                 reserva va a tener tiene que estar EN PANTALLA; se teclea solo para excepciones
                 (una clienta que necesita más tiempo). -->
            <ion-input data-role="duration" fill="outline" label-placement="floating" label=${t('ui.fieldMinutes')} type="number" min="1" .value=${this.newDuration} @ionInput=${(e: any) => (this.newDuration = e.target.value)}></ion-input>
            <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCustomerId || !this.newServiceId || !this.newStaffId || !this.newStart}>${this.saving ? t('ui.saving') : t('ui.addAppointment')}</ion-button>
          </form>`;
  }
}

define('erp-appointments-list', ErpAppointmentsList);
