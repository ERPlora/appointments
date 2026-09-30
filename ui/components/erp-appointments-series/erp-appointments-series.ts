import { LitElement, html, css, nothing } from 'lit';
import type { PropertyValues } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
// appointments#217 — the same inline calendar the agenda's date fields use (#205): the hub shell
// does not register `ion-datetime`, so the module bundles `ok-calendar` itself.
import '@erplora/outfitkit/ok-calendar';
import type { DataTableColumn } from '@erplora/outfitkit';
import { dataTableLabels } from '@erplora/module-sdk';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
import { todayISO } from '../../lib/business-time';
// appointments#204/#209: a start typed or pasted as one string is read in the active language's
// day/month order and split into the Day + Time fields, the same helper the new-appointment and
// reschedule panels of `erp-appointments-list` use.
// appointments#217: and the dates/times are painted in the hub's language by the same helpers.
import { parseTypedStart, formatTypedDate, formatTypedTime, type TypedStart } from '../../lib/typed-start';

const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

// erp-appointments-series — LAS SERIES RECURRENTES, vistas como lo que son (appointments#91).
//
// Antes de esta pantalla el único gesto que llegaba a una serie entraba por la agenda, encima de
// una ocurrencia concreta. Tres consecuencias reales: una serie cuyas ocurrencias aún no se han
// materializado (o cuya ventana ya pasó) no tenía NINGUNA fila desde la que abrirse; una serie
// partida (`split_from_id`) no se podía ver como las dos mitades encadenadas que es; y desactivar,
// borrar o materializar una serie no tenía puerta de entrada aunque los commands existieran.
//
// POR QUÉ NO ES UNA ENTRADA DE NAVEGACIÓN: ninguno de los productos del sector cuelga una «página
// de series» del menú. Fresha pone la repetición EN la cita y materializa hasta 12 meses por
// delante; Vagaro deja editar la serie entera desde la cita; Google Calendar la parte al cambiar
// la regla. La serie se gestiona DONDE se vive la agenda, así que esto es una vista más del módulo
// —al lado de «Lista» y «Por profesional»—, no una página huérfana con su propio icono.
//
// Y es AQUÍ donde vive el cambio de PAUTA (appointments#90): el panel de reprogramar mueve un
// hueco, y meter un selector de frecuencia en él sería pedirle a la recepcionista que redefina la
// serie mientras arrastra una cita.
//
// appointments#209 — the ADD button. Until now a repeating appointment could only be EDITED from
// here; this view now also CREATES one, with the existing `appointments.recurring.create` command,
// and books its window right away with `appointments.recurring.materialize` — the same two-step
// chain `submitEdit` already uses for a pattern change.

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
  notify?(n: { type: string; message: string }): void;
}

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK not initialised by the shell');
  return c;
}

/** Global Ionic overlay appended to `document.body` (same pattern as the sales module's void
 *  dialog): an inline `<ion-alert>` in this shadow root loses its styles once Ionic teleports it
 *  (hub#2162). */
interface IonicAlertElement extends HTMLElement {
  header: string;
  message: string;
  buttons: Array<{ text: string; role?: string; handler?: () => boolean | void }>;
  isOpen: boolean;
  present?: () => Promise<void>;
}

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: T[] }).rows)) {
    return (r as { rows: T[] }).rows;
  }
  return [];
}

/** appointments#238 — what `appointments.recurring.materialize` answers: how many occurrences it
 *  booked, how many were already on the agenda, and every date it skipped with the refusal code. */
interface SeriesBookingReport {
  booked: number;
  already_booked: number;
  skipped: { occurrence_date: string; code: string }[];
}

/** The short reason painted next to each skipped date; any other code reads as «could not be booked». */
const SKIP_REASON_KEYS: Record<string, string> = {
  'appointments.outside_staff_hours': 'ui.seriesSkipStaffHours',
  'appointments.outside_schedule': 'ui.seriesSkipClosed',
  'appointments.blocked': 'ui.seriesSkipBlocked',
  'appointments.overlapping_appointment': 'ui.seriesSkipTaken',
  'appointments.invalid_start': 'ui.seriesSkipPast',
  'appointments.too_soon': 'ui.seriesSkipTooSoon',
  'appointments.too_far': 'ui.seriesSkipTooFar',
};

/** appointments#236 — the reasons of an occurrence a series edit could NOT move. The move is judged
 *  like a single reschedule, so the codes are the booking ones, plus the occurrence whose
 *  professional's hours were not read (handed by hand to another one); anything else still reads
 *  as «could not be moved», never as «could not be booked». */
export const NOT_MOVED_REASON_KEYS: Record<string, string> = {
  ...SKIP_REASON_KEYS,
  'appointments.staff_hours_unavailable': 'ui.seriesSkipStaffUnknown',
};

/** `erplora().command` resolves to the dispatcher's `data`; the handler's own answer (the report)
 *  travels in its `result`. */
export function handlerAnswer(answer: unknown): Record<string, unknown> | null {
  const result = answer && typeof answer === 'object' ? (answer as Record<string, unknown>).result : null;
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
}

export function skippedDates(a: Record<string, unknown>): { occurrence_date: string; code: string }[] {
  return (a.skipped as Record<string, unknown>[]).map((s) => ({
    occurrence_date: String(s?.occurrence_date ?? ''),
    code: String(s?.code ?? ''),
  }));
}

function bookingReport(answer: unknown): SeriesBookingReport | null {
  const a = handlerAnswer(answer);
  if (!a || !Array.isArray(a.skipped)) return null;
  return {
    booked: Number(a.booked ?? 0),
    already_booked: Number(a.already_booked ?? 0),
    skipped: skippedDates(a),
  };
}

/** appointments#236 — what `appointments.recurring.update` answers about the occurrences it moved
 *  and the ones it left on their own slot. */
interface SeriesMoveReport {
  moved: number;
  /** appointments#248 — the professional they were handed to, when the edit changed it. */
  staff?: string;
  skipped: { occurrence_date: string; code: string }[];
}

/** Una plantilla como la pinta `appointments.recurring.list`. */
interface Series {
  id: string;
  customer_name: string;
  service_name: string;
  staff_name: string;
  frequency: string;
  day_of_week: number | null;
  time: string;
  duration_minutes: number;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  is_active: number;
}

/** …y como la devuelve `appointments.recurring.get`, que sí trae los tres ids. */
interface SeriesTemplate extends Series {
  customer_id: string | null;
  service_id: string | null;
  staff_id: string | null;
  split_from_id?: string | null;
}

interface Occurrence {
  id: string;
  occurrence_date: string;
  status: string;
  converted_sale_id: string | null;
}

/** appointments#209 — the catalogs the NEW-series form books against, the same shapes
 *  `erp-appointments-list` reads from their public queries. */
interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

/** A bookable service (`services.services.list`): brings the duration to prefill. */
interface Service {
  id: string;
  name: string;
  price?: number;
  duration_minutes?: number;
  is_bookable?: number;
}

/** A professional (`staff.members.list`): only the `is_bookable` ones can be picked. */
interface StaffMember {
  id: string;
  full_name: string;
  status?: string;
  is_bookable?: number;
}

/** appointments#246 — the links `materialize` books with, and what the screen says when one is
 *  missing; the professional first, the one a series created by the assistant most often lacks. */
const MISSING_LINK_KEYS: readonly (readonly ['staff_id' | 'customer_id' | 'service_id', string])[] = [
  ['staff_id', 'ui.seriesNoStaff'],
  ['customer_id', 'ui.seriesNoCustomer'],
  ['service_id', 'ui.seriesNoService'],
];

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'] as const;
const FREQUENCY_KEYS: Record<string, string> = {
  daily: 'ui.freqDaily',
  weekly: 'ui.freqWeekly',
  biweekly: 'ui.freqBiweekly',
  monthly: 'ui.freqMonthly',
};
/** 0 = lunes … 6 = domingo, la convención del módulo en todas partes (docs/concepts.md). */
const WEEKDAY_KEYS = [
  'ui.dayMonday',
  'ui.dayTuesday',
  'ui.dayWednesday',
  'ui.dayThursday',
  'ui.dayFriday',
  'ui.daySaturday',
  'ui.daySunday',
];
/** El día de la semana solo alinea las pautas que avanzan por semanas. */
const ALIGNS_TO_WEEKDAY = ['weekly', 'biweekly'];

export class ErpAppointmentsSeries extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; min-height:0; flex:1 1 auto;
            font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    .page { display:flex; flex-direction:column; gap:.5rem; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    .form { display:flex; flex-direction:column; gap:.75rem; padding:.25rem 0; container-type:inline-size; }
    /* Two columns only when the FORM (the table's side panel) has room: on a wide screen that panel
       is ~360 px, so a viewport media query would cut every field in half. */
    .grid { display:grid; grid-template-columns:1fr; gap:.75rem; }
    @container (min-width: 540px) { .grid { grid-template-columns:1fr 1fr; } }
    .skipped { margin:.25rem 0 0; padding-left:1.25rem; }
    .ctx { margin:0; font-size:.9rem; color: var(--ion-color-medium, #8b897f); }
    .ctx strong { color: var(--ion-text-color, #1c1b18); }
    .loading, .empty { color: var(--ion-color-medium, #8b897f); font-size:.9rem; margin:.25rem 0; }
    /* appointments#217 — the inline ok-calendar of a date field, painted right where it opens (an
       overlay would teleport out of the shadow root and lose its styles, hub#2162), full width. */
    .field-calendar { grid-column: 1 / -1; display:flex; justify-content:flex-start; }
    /* appointments#223 — the compact date picker of OutfitKit: never wider than its 20rem. */
    ok-calendar { flex: 1 1 auto; max-width: 20rem; }
  `;

  @state() series: Series[] = [];
  @state() loading = true;
  @state() error = '';
  /** appointments#238 — the dates the last booking left out; painted until the next action. */
  @state() bookingReport: SeriesBookingReport | null = null;
  /** appointments#236 — the dates a series edit left on their own slot, with the reason. */
  @state() moveReport: SeriesMoveReport | null = null;
  @state() saving = false;
  /** Series whose status toggle has a command in flight ('' = none). While it lasts the toggles
   *  render disabled and a second tap fires nothing — that is the toggle's loading state. */
  @state() busySeriesId = '';

  /** La serie abierta en el panel (vacío = el panel no está editando nada). */
  @state() editingId = '';

  /** Ticket of the latest «edit» opening (pm#459). */
  private editSeq = 0;
  @state() template: SeriesTemplate | null = null;
  @state() occurrences: Occurrence[] = [];
  /** El corte: la primera ocurrencia que aún no ha pasado. El servidor lo adelanta a hoy igual. */
  @state() fromOccurrence = '';

  @state() editFrequency = '';
  /** `''` = sin día fijo. Se guarda como texto porque es lo que devuelve `ion-select`. */
  @state() editDayOfWeek = '';
  @state() editTime = '';
  @state() editDuration = '';
  /** appointments#248 — who does the series from the cut on; starts as its current professional. */
  @state() editStaffId = '';

  // ── appointments#209 — the NEW-series form ──────────────────────────────────────────────────
  // Linked catalogs: a series is booked against real records, same as erp-appointments-list.
  @state() customers: Customer[] = [];
  @state() services: Service[] = [];
  @state() staffMembers: StaffMember[] = [];

  @state() newCustomerId = '';
  @state() newServiceId = '';
  @state() newStaffId = '';
  @state() newFrequency = 'weekly';
  /** `''` = no fixed weekday, same as `editDayOfWeek`. */
  @state() newDayOfWeek = '';
  @state() newStartDate = '';
  @state() newStartTime = '';
  @state() newDuration = '';
  @state() newEndDate = '';
  @state() newOccurrences = '';
  /** A refusal painted NEXT TO the submit button — `error` lives in the list template, and the
   *  panel covers it whole (same reasoning as `formError` in `erp-appointments-list`). */
  @state() createError = '';

  /** pm#513 — the same for the EDIT form: a refused change to a series is painted inside that form.
   *  It used to go to `error`, the page banner, and on a phone the full-screen sheet covered it:
   *  the receptionist pressed «Save» and saw nothing at all. Row actions keep using `error`. */
  @state() editError = '';

  /** appointments#217 — the raw text of a date field while it is being typed; `null` otherwise, so
   *  the field paints `formatTypedDate(iso, locale)` in the hub's day/month order (a native `date`
   *  input paints the BROWSER's). A half-typed date stays on screen without becoming a date. */
  @state() private dateDraft: Record<'start' | 'end', string | null> = { start: null, end: null };

  /** appointments#217 — the same for the two TIME fields (new series, edit): `null` paints
   *  `formatTypedTime(time, locale)`, the hub clock instead of the browser's. */
  @state() private timeDraft: Record<'new' | 'edit', string | null> = { new: null, edit: null };

  /** appointments#217 — which date field has its inline `ok-calendar` open; `''` = none. One at a
   *  time: two open calendars would be two answers to "what day is this". */
  @state() private calendarOpen: '' | 'start' | 'end' = '';

  private offLocale: (() => void) | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    // i18n (ADR-0055): al cambiar de idioma se repinta, como el resto de vistas del módulo.
    this.offLocale = erplora().on('erplora:locale-changed', () => this.requestUpdate());
    // appointments#209: the series list and the NEW-series catalogs do not depend on each other,
    // the same way `erp-appointments-list` loads its own catalogs alongside the day's agenda.
    await Promise.all([this.refresh(), this.loadCatalogs()]);
  }

  disconnectedCallback(): void {
    this.offLocale?.();
    this.offLocale = null;
    super.disconnectedCallback();
  }

  /** appointments#209 — the links a NEW series books against, read from their public queries
   *  (never another module's tables), exactly like the create panel of `erp-appointments-list`. */
  private async loadCatalogs(): Promise<void> {
    const [customers, services, staffMembers] = await Promise.all([
      erplora().query('customers.list', { limit: 500, sort: 'name', dir: 'asc' }).catch(() => []),
      erplora().query('services.services.list', { limit: 500 }).catch(() => []),
      erplora().query('staff.members.list', { limit: 500 }).catch(() => []),
    ]);
    this.customers = rows<Customer>(customers);
    // A non-bookable service (e.g. internal) cannot receive an appointment.
    this.services = rows<Service>(services).filter((s) => s.is_bookable === undefined || Number(s.is_bookable) === 1);
    this.staffMembers = rows<StaffMember>(staffMembers);
  }

  /** Professionals that can receive appointments: the ones the `staff` module marks bookable. */
  private get bookableStaff(): StaffMember[] {
    return this.staffMembers.filter((m) => Number(m.is_bookable) === 1 && m.status !== 'terminated');
  }

  /** appointments#248 — who the edit panel offers: the bookable professionals and, when she no
   *  longer is one (she left, or stopped taking appointments), the series' current professional, so
   *  the field still says who does it today instead of showing up empty. */
  private get editStaffOptions(): { id: string; name: string }[] {
    const options = this.bookableStaff.map((m) => ({ id: m.id, name: m.full_name }));
    const tmpl = this.template;
    if (tmpl?.staff_id && !options.some((o) => o.id === tmpl.staff_id)) {
      options.unshift({ id: tmpl.staff_id, name: tmpl.staff_name || tmpl.staff_id });
    }
    return options;
  }

  /** appointments#248 — the professional picked in the edit panel when it is not the series' one. */
  private get staffChange(): { id: string; name: string } | null {
    const tmpl = this.template;
    if (!tmpl || !this.editStaffId || this.editStaffId === (tmpl.staff_id ?? '')) return null;
    const picked = this.editStaffOptions.find((o) => o.id === this.editStaffId);
    return { id: this.editStaffId, name: picked?.name ?? this.editStaffId };
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    this.bookingReport = null;
    this.moveReport = null;
    try {
      this.series = rows<Series>(await erplora().query('appointments.recurring.list'));
    } catch (e) {
      // Un fallo que no se ve no existe: la pantalla vacía y la pantalla rota se parecen
      // demasiado, y sin este aviso la recepcionista concluye que no tiene series.
      this.series = [];
      this.error = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesLoadError');
    } finally {
      this.loading = false;
    }
  }

  private dataTable(): (HTMLElement & { open(mode: string, opts?: { title?: string }): void; close(): void }) | null {
    return this.renderRoot.querySelector('ok-data-table') as
      | (HTMLElement & { open(mode: string, opts?: { title?: string }): void; close(): void })
      | null;
  }

  /** appointments#209 — `.addable` makes `ok-data-table` paint its OWN toolbar button
   *  (`data-testid="appointments-series-table-add"`), which just toggles its `panel` and emits no
   *  event: there is nothing to listen for on the table itself. Caught here with a NATIVE listener
   *  on `renderRoot` instead of a `@click` in the template — a testid guard forbids the latter on a
   *  testid'd element, and `ok-data-table` recreates its own toolbar across renders while
   *  `renderRoot` is the one thing that survives all of them. */
  firstUpdated(): void {
    this.renderRoot.addEventListener('click', (e) => this.onTableAddClick(e));
    // appointments#211: closing the panel (X, backdrop, Escape — outfitkit#195, ≥0.1.97) retires the
    // edit still loading, so its late reply neither reopens the panel nor fills the form. Older
    // shells never emit it and keep today's behaviour.
    this.renderRoot.addEventListener('panelClose', () => this.editSeq++);
  }

  /** pm#513: a refusal appears ABOVE the button that was pressed, at the foot of a form that can be
   *  taller than a phone — bring it into view once it has painted itself: scrolled before, the
   *  banner still measures 0 px and ends up under the tab bar. */
  updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (changed.has('editError') && this.editError) void this.revealRefusal('[data-testid="appointments-series-form-error"]');
    if (changed.has('createError') && this.createError) void this.revealRefusal('[data-testid="appointments-series-create-error"]');
  }

  private async revealRefusal(selector: string): Promise<void> {
    const banner = this.renderRoot.querySelector(selector) as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
    await banner?.updateComplete;
    banner?.scrollIntoView?.({ block: 'center' });
  }

  private onTableAddClick(e: Event): void {
    const tappedAdd = e
      .composedPath()
      .some((node) => (node as { getAttribute?: (name: string) => string | null }).getAttribute?.('data-testid') === 'appointments-series-table-add');
    if (!tappedAdd) return;
    // pm#459: invalidates an «edit» opening still loading — `openSeries` already checks
    // `seq !== this.editSeq` right after its await, so a late reply can never turn the fresh
    // NEW-series form into the edit it was loading.
    this.editSeq++;
    if (this.editingId) {
      // Clear the edit state WITHOUT closing the panel: `ok-data-table` already opened (or kept
      // open) the one Add just asked for — `closePanel()` would close it right back.
      this.editingId = '';
      this.template = null;
      this.occurrences = [];
    }
    // With no edit in progress, the create draft being typed is left exactly as it was.
  }

  /** Carga la plantilla AUTORITATIVA de la serie (la lista no trae los tres ids) y lo que ya está
   *  reservado, que es lo que decide dónde cae el corte y lo que hay que avisar antes de guardar. */
  private async loadTemplate(recurringId: string): Promise<SeriesTemplate | null> {
    const tmpl = rows<SeriesTemplate>(
      await erplora().query('appointments.recurring.get', { recurring_id: recurringId }),
    )[0];
    return tmpl ?? null;
  }

  async openSeries(row: Record<string, unknown>): Promise<void> {
    const id = String(row.id ?? '');
    if (!id) return;
    // pm#459: two «edit» taps in a row — only the LAST opening may fill the form. A late reply
    // (or failure) for an earlier tap is dropped, or a submit would rewrite the wrong series.
    const seq = ++this.editSeq;
    this.error = '';
    this.editError = '';
    try {
      const [tmpl, occ] = await Promise.all([
        this.loadTemplate(id),
        erplora().query('appointments.recurring.occurrences', { recurring_id: id }),
      ]);
      if (seq !== this.editSeq) return;
      if (!tmpl) {
        this.error = erplora().t(CATALOG, 'ui.seriesNotFound');
        return;
      }
      this.template = tmpl;
      this.occurrences = rows<Occurrence>(occ);
      this.editingId = id;
      this.editFrequency = tmpl.frequency ?? '';
      this.editDayOfWeek = tmpl.day_of_week === null || tmpl.day_of_week === undefined ? '' : String(tmpl.day_of_week);
      this.editTime = tmpl.time ?? '';
      this.timeDraft = { ...this.timeDraft, edit: null };
      this.editDuration = String(tmpl.duration_minutes ?? '');
      this.editStaffId = tmpl.staff_id ?? '';
      // EL PASADO ESTÁ CONGELADO: el corte nunca apunta a una ocurrencia ya servida. Si no queda
      // ninguna futura reservada, se corta hoy — que es lo que el servidor haría de todos modos.
      const today = todayISO();
      this.fromOccurrence =
        this.occurrences.map((o) => o.occurrence_date).find((d) => d >= today) ?? today;
      await this.updateComplete;
      // pm#450: «edit» mode + its own title (also the dialog's aria-label). The `.labels.newRecord`
      // override in render() stays as the fallback for OutfitKit < 0.1.94, which ignores the title.
      this.dataTable()?.open('edit', { title: erplora().t(CATALOG, 'ui.seriesEditTitle') });
    } catch (e) {
      if (seq !== this.editSeq) return;
      this.error = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesLoadError');
    }
  }

  private closePanel(): void {
    this.editingId = '';
    this.template = null;
    this.occurrences = [];
    this.dataTable()?.close();
  }

  /** Lo que de verdad cambió. Se manda SOLO eso: `recurring.update` compara contra la plantilla
   *  para decidir si la pauta cambió, y reenviar lo idéntico no aporta nada; mandar el payload
   *  entero además haría que un campo que la pantalla no supo leer pisara el valor guardado. */
  private changedFields(): Record<string, unknown> {
    const tmpl = this.template;
    if (!tmpl) return {};
    const changed: Record<string, unknown> = {};
    if (this.editTime && this.editTime !== tmpl.time) changed.time = this.editTime;
    const minutes = Math.trunc(Number(this.editDuration));
    if (Number.isFinite(minutes) && minutes >= 1 && minutes !== tmpl.duration_minutes) {
      changed.duration_minutes = minutes;
    }
    if (this.editFrequency && this.editFrequency !== tmpl.frequency) {
      changed.frequency = this.editFrequency;
    }
    // El día vacío es un valor, no una ausencia: viaja como `null` explícito y BORRA el día fijo.
    const dow = this.editDayOfWeek === '' ? null : Math.trunc(Number(this.editDayOfWeek));
    const current = tmpl.day_of_week === undefined ? null : tmpl.day_of_week;
    if (dow !== current) changed.day_of_week = dow;
    return changed;
  }

  /** Cuántas citas ya reservadas alcanza el cambio: las que quedan por delante del corte y siguen
   *  siendo un plan. Las ya cobradas se nombran aparte porque NO se van a tocar. */
  private get affected(): { upcoming: number; invoiced: number } {
    const from = this.fromOccurrence;
    let upcoming = 0;
    let invoiced = 0;
    for (const o of this.occurrences) {
      if (!from || o.occurrence_date < from) continue;
      if (o.status !== 'pending' && o.status !== 'confirmed') continue;
      if (o.converted_sale_id) invoiced += 1;
      else upcoming += 1;
    }
    return { upcoming, invoiced };
  }

  async submitEdit(ev: Event): Promise<void> {
    ev.preventDefault?.();
    const tmpl = this.template;
    if (!tmpl || this.saving) return;
    const changed = this.changedFields();
    const staffChange = this.staffChange;
    // Guardar sin tocar nada no escribe: el command lo rechazaría («nada que cambiar») y el panel
    // habría prometido algo que no ocurrió.
    if (Object.keys(changed).length === 0 && !staffChange) {
      this.closePanel();
      return;
    }
    this.saving = true;
    this.editError = '';
    this.error = ''; // a save is the next thing the person did: an older row refusal is stale
    try {
      const result = handlerAnswer(
        await erplora().command('appointments.recurring.update', {
          recurring_id: this.editingId,
          // appointments#236: the series' professional as SELECTOR (the handler refuses another
          // one) — every occurrence it moves is judged on HER agenda and working days.
          // appointments#248: on a change of professional the current one travels as
          // `current_staff_id` (the selector), the new one as `staff_id` and the service, which
          // decides whether she can take it; the moved occurrences are judged on HER agenda.
          ...(staffChange
            ? { current_staff_id: tmpl.staff_id ?? '', staff_id: staffChange.id, service_id: tmpl.service_id ?? '' }
            : { staff_id: tmpl.staff_id ?? '' }),
          scope: 'this_and_following',
          from_occurrence_date: this.fromOccurrence,
          ...changed,
        }),
      );

      // CAMBIO DE PAUTA → hay que RESERVAR. El command mueve lo que sigue cabiendo y cancela lo
      // que no, pero no reserva los días nuevos: eso es `materialize`, que es quien tiene las
      // reads de catálogo y disponibilidad. Sin este paso la clienta se queda sin nada en el día
      // nuevo, que es la mitad del gesto que ella pidió.
      // appointments#248: a series that had no professional had nothing booked — getting one is
      // what makes it bookable, so saving books it (with her: the new template's selector).
      let report: SeriesBookingReport | null = null;
      const gotItsFirstProfessional = !tmpl.staff_id && !!staffChange;
      if (result?.pattern_changed === true || gotItsFirstProfessional) {
        const booked = staffChange ? { ...tmpl, staff_id: staffChange.id } : tmpl;
        report = await this.bookWindow(String(result?.recurring_id ?? this.editingId), booked);
      }
      const notMoved = result && Array.isArray(result.skipped) ? skippedDates(result) : [];
      // Nothing of it was booked before: «0 moved · 0 cancelled» would say nothing happened.
      if (!gotItsFirstProfessional) this.notifyOutcome(result, notMoved.length > 0);
      this.closePanel();
      await this.refresh();
      // After refresh(), which clears them: the dates left on their slot and the new days that
      // could not be booked are said.
      this.moveReport =
        notMoved.length > 0
          ? {
              moved: Number(result?.moved ?? 0),
              skipped: notMoved,
              ...(staffChange && result?.staff_changed === true ? { staff: staffChange.name } : {}),
            }
          : null;
      if (!this.showSkipped(report) && gotItsFirstProfessional) {
        erplora().notify?.({ type: 'success', message: erplora().t(CATALOG, 'ui.seriesMaterialized') });
      }
    } catch (e) {
      this.editError = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesSaveError');
    } finally {
      this.saving = false;
    }
  }

  /** Lo que NO se movió se DICE. Callarlo es el fallo nº1 que reportan los foros de este gesto. */
  private notifyOutcome(result: Record<string, unknown> | null, leftBehind: boolean): void {
    if (!result) return;
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    const message = t('ui.seriesUpdateOutcome', {
      moved: Number(result.moved ?? 0),
      cancelled: Number(result.cancelled_pattern_change ?? 0),
      locked: Number(result.locked_invoiced ?? 0),
    });
    // Some date stayed where it was: the move did not do all it was asked, so it is not a success.
    erplora().notify?.({ type: leftBehind ? 'warning' : 'success', message });
  }

  private async bookWindow(recurringId: string, tmpl: SeriesTemplate): Promise<SeriesBookingReport | null> {
    // appointments#246 — a series saved without one of its links (the assistant and the API could
    // create it before `recurring.create` required them) can never be booked: `materialize`
    // refuses an empty id. Say what is missing instead of sending a command bound to fail.
    const missing = MISSING_LINK_KEYS.find(([field]) => !tmpl[field]);
    if (missing) throw new Error(erplora().t(CATALOG, missing[1]));
    // Los tres ids son SELECTOR, no fuente (appointments#54): el handler los contrasta con la
    // plantilla que carga el runtime y rechaza si no coinciden.
    return bookingReport(
      await erplora().command('appointments.recurring.materialize', {
        recurring_id: recurringId,
        customer_id: tmpl.customer_id,
        service_id: tmpl.service_id,
        staff_id: tmpl.staff_id,
      }),
    );
  }

  /** appointments#238 — keeps the report on screen when some date was left out; returns whether
   *  it did, so the caller only toasts «booked» when everything was. */
  private showSkipped(report: SeriesBookingReport | null): boolean {
    this.bookingReport = report && report.skipped.length > 0 ? report : null;
    return this.bookingReport !== null;
  }

  /** Materializar la ventana desde la lista: la serie ya existe, lo que falta son sus citas. */
  async materializeSeries(row: Record<string, unknown>): Promise<void> {
    const id = String(row.id ?? '');
    if (!id) return;
    this.error = '';
    this.bookingReport = null;
    this.moveReport = null;
    try {
      const tmpl = await this.loadTemplate(id);
      if (!tmpl) {
        this.error = erplora().t(CATALOG, 'ui.seriesNotFound');
        return;
      }
      if (!this.showSkipped(await this.bookWindow(id, tmpl))) {
        erplora().notify?.({ type: 'success', message: erplora().t(CATALOG, 'ui.seriesMaterialized') });
      }
    } catch (e) {
      this.error = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesMaterializeError');
    }
  }

  /** appointments#207 — deleting a series asks first, like every appointment book of the sector
   *  (Fresha, Vagaro, Odoo, Square); it is a GLOBAL Ionic overlay appended to `document.body`
   *  (same as the void dialog of the sales module) because an inline `<ion-alert>` in this shadow
   *  root loses its styles when Ionic teleports it (hub#2162). */
  async confirmDeleteSeries(row: Record<string, unknown>): Promise<void> {
    const id = String(row.id ?? '');
    if (!id) return;
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    const alert = document.createElement('ion-alert') as IonicAlertElement;
    alert.header = t('ui.seriesDeleteTitle', { name: String(row.customer_name ?? '') });
    alert.message = t('ui.seriesDeleteMessage');
    alert.buttons = [
      { text: t('ui.cancelReschedule'), role: 'cancel' },
      {
        text: t('ui.actionDelete'),
        role: 'destructive',
        handler: () => {
          void this.deleteSeries(row);
        },
      },
    ];
    alert.setAttribute('data-testid', 'appointments-series-delete-confirm');
    // Ionic moves the teleported overlay back to its original parent right AFTER emitting
    // ionAlertDidDismiss: remove it on the next task or a hidden alert is left on every delete.
    alert.addEventListener('ionAlertDidDismiss', () => setTimeout(() => alert.remove(), 0), { once: true });
    document.body.appendChild(alert);
    try {
      if (typeof alert.present === 'function') await alert.present();
      else alert.isOpen = true;
    } catch {
      alert.remove();
    }
  }

  async deleteSeries(row: Record<string, unknown>): Promise<void> {
    const id = String(row.id ?? '');
    if (!id) return;
    this.error = '';
    try {
      await erplora().command('appointments.recurring.delete', { recurring_id: id });
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesDeleteError');
    }
  }

  /** Desactiva/reactiva una serie sin borrarla (appointments#110). Una desactivada SIGUE en la
   *  lista (`recurring_list.sql` ya no la filtra) — solo deja de ofrecerse para materializar
   *  citas nuevas hasta que se reactiva. */
  async toggleSeriesActive(
    row: Record<string, unknown>,
    nextActive: boolean,
    toggle?: { checked: boolean },
  ): Promise<void> {
    const id = String(row.id ?? '');
    if (!id || this.busySeriesId) return;
    this.busySeriesId = id;
    this.error = '';
    try {
      // El nombre del command tiene que ser un LITERAL en la llamada (ADR-0127: el contrato de
      // interoperabilidad lo descubre por análisis estático, no en runtime).
      if (nextActive) {
        await erplora().command('appointments.recurring.activate', { recurring_id: id });
      } else {
        await erplora().command('appointments.recurring.deactivate', { recurring_id: id });
      }
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesToggleActiveError');
      // The `ion-toggle` already flipped itself on tap and the row did not change (Lit does not
      // touch `?checked` again when the value is the same): without this the switch stays «off»
      // over a series that is still active. A visible error is not enough if the control lies.
      if (toggle) toggle.checked = !nextActive;
    } finally {
      this.busySeriesId = '';
    }
  }

  private onRowAction(ev: CustomEvent): void {
    // ok-data-table emits `{ actionId, row }` (it never sent `action`: with it no row button did anything).
    const { actionId: action, row } = (ev.detail ?? {}) as { actionId?: string; row?: Record<string, unknown> };
    if (!row) return;
    if (action === 'edit') void this.openSeries(row);
    else if (action === 'materialize') void this.materializeSeries(row);
    else if (action === 'delete') void this.confirmDeleteSeries(row);
  }

  /** La pauta en una frase, que es como la lee una recepcionista («Cada semana · lunes · 11:00»). */
  private patternLabel(row: Series): string {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const parts = [t(FREQUENCY_KEYS[row.frequency] ?? row.frequency)];
    if (ALIGNS_TO_WEEKDAY.includes(row.frequency) && row.day_of_week !== null && row.day_of_week !== undefined) {
      parts.push(t(WEEKDAY_KEYS[row.day_of_week] ?? String(row.day_of_week)));
    }
    // appointments#217: in the hub clock («02:30 PM» in English), like the Time field shows it.
    if (row.time) parts.push(formatTypedTime(row.time, erplora().locale) || row.time);
    return parts.join(' · ');
  }

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'customer_name', header: t('ui.colCustomer') },
      { key: 'service_name', header: t('ui.colService') },
      { key: 'staff_name', header: t('ui.colStaff'), format: (r) => (r.staff_name as string) || '—' },
      { key: 'frequency', header: t('ui.colPattern'), format: (r) => this.patternLabel(r as unknown as Series) },
      // appointments#217: dates in the hub's day/month order, not raw ISO.
      { key: 'start_date', header: t('ui.colStarts'), format: (r) => this.shownDate(r.start_date) },
      { key: 'end_date', header: t('ui.colEnds'), format: (r) => this.endsLabel(r as unknown as Series) },
      {
        key: 'is_active',
        header: t('ui.colStatus'),
        // Inline toggle (the `erp-inventory-products` pattern for an `is_active` flag): the list
        // already brings active AND inactive rows, so the row is painted and switched without
        // opening anything. Disabled while a change is in flight: that is its loading state.
        render: (r) => html`
          <ion-toggle
            data-testid=${`appointments-series-active-${String(r.id)}`}
            aria-label=${t('ui.seriesActive')}
            ?checked=${!!r.is_active}
            ?disabled=${!!this.busySeriesId}
            @ionChange=${(e: Event) =>
              this.toggleSeriesActive(r, (e.target as HTMLInputElement).checked, e.target as HTMLInputElement)}
          ></ion-toggle>
        `,
      },
    ];
  }

  /**
   * When the series stops (appointments#254): its end date, «After N appointments» when it has a
   * fixed number of them, both when it has both (it stops at whichever comes first), and «No end»
   * only with neither.
   */
  private endsLabel(row: Series): string {
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    const parts: string[] = [];
    const date = this.shownDate(row.end_date);
    if (date) parts.push(date);
    const count = Math.trunc(Number(row.max_occurrences));
    if (Number.isFinite(count) && count >= 1) {
      const plural = new Intl.PluralRules(erplora().locale).select(count);
      parts.push(t(plural === 'one' ? 'ui.seriesEndsAfterOne' : 'ui.seriesEndsAfter', { n: count }));
    }
    return parts.join(' · ') || t('ui.seriesNoEnd');
  }

  /** A stored `YYYY-MM-DD` as the hub language writes it; anything unreadable is shown as stored. */
  private shownDate(value: unknown): string {
    const iso = typeof value === 'string' ? value : '';
    return formatTypedDate(iso, erplora().locale) || iso;
  }

  private get rowActions() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { id: 'edit', label: t('ui.actionEditSeries'), icon: 'create-outline', color: 'primary' },
      { id: 'materialize', label: t('ui.actionMaterialize'), icon: 'calendar-number-outline', color: 'success' },
      { id: 'delete', label: t('ui.actionDelete'), icon: 'trash-outline', color: 'danger' },
    ];
  }

  render() {
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    return html`<div class="page">
      ${this.error
        ? html`<ok-inline-feedback data-testid="appointments-series-error" tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>`
        : nothing}
      ${this.moveReport ? this.renderMoveReport(this.moveReport, t) : nothing}
      ${this.bookingReport ? this.renderBookingReport(this.bookingReport, t) : nothing}
      <ok-data-table
        testid="appointments-series-table"
        .fill=${true}
        .views=${true}
        .addable=${true}
        .cardTitle=${(row: Record<string, unknown>) => String(row.customer_name ?? '')}
        .columns=${this.columns}
        .rows=${this.series as unknown as Record<string, unknown>[]}
        .searchKeys=${['customer_name', 'service_name', 'staff_name']}
        .searchPlaceholder=${t('ui.seriesSearchPlaceholder')}
        .actions=${this.rowActions}
        @rowAction=${(e: CustomEvent) => this.onRowAction(e)}
        .labels=${{ ...dataTableLabels(erplora().locale), newRecord: this.editingId ? t('ui.seriesEditTitle') : t('ui.seriesNewTitle') }}
        .emptyMessage=${this.loading ? t('ui.loading') : t('ui.seriesEmpty')}
      >
        ${this.editingId ? this.renderEditForm(t) : this.renderCreateForm(t)}
      </ok-data-table>
    </div>`;
  }

  /** appointments#238 — «N booked · M could not be booked:» and one line per date with its reason,
   *  as Fresha or Square say it when a repeating booking leaves dates out. */
  private renderBookingReport(report: SeriesBookingReport, t: (k: string, p?: Record<string, unknown>) => string) {
    return html`<ok-inline-feedback data-testid="appointments-series-skipped" tone="warning" icon="alert-circle-outline">
      <strong>${t('ui.seriesBookedSkipped', {
        // What a previous run already booked is on the agenda too: a retry must not read «0 booked».
        booked: report.booked + report.already_booked,
        skipped: report.skipped.length,
      })}</strong>
      <ul class="skipped">
        ${report.skipped.map(
          (s) => html`<li data-testid=${`appointments-series-skipped-${s.occurrence_date}`}>
            ${this.shownDate(s.occurrence_date)} — ${t(SKIP_REASON_KEYS[s.code] ?? 'ui.seriesSkipOther')}
          </li>`,
        )}
      </ul>
    </ok-inline-feedback>`;
  }

  /** appointments#236 — «N moved · M could not be moved and keep their time:» and one line per date
   *  with its reason, as Mindbody or SimplyBook.me say it when a repeating edit leaves dates out. */
  private renderMoveReport(report: SeriesMoveReport, t: (k: string, p?: Record<string, unknown>) => string) {
    return html`<ok-inline-feedback data-testid="appointments-series-not-moved" tone="warning" icon="alert-circle-outline">
      <strong
        >${report.staff
          ? t('ui.seriesReassignedSkipped', { moved: report.moved, skipped: report.skipped.length, staff: report.staff })
          : t('ui.seriesMovedSkipped', { moved: report.moved, skipped: report.skipped.length })}</strong
      >
      <ul class="skipped">
        ${report.skipped.map(
          (s) => html`<li data-testid=${`appointments-series-not-moved-${s.occurrence_date}`}>
            ${this.shownDate(s.occurrence_date)} — ${t(NOT_MOVED_REASON_KEYS[s.code] ?? 'ui.seriesMoveSkipOther')}
          </li>`,
        )}
      </ul>
    </ok-inline-feedback>`;
  }

  private renderEditForm(t: (k: string, p?: Record<string, unknown>) => string) {
    const tmpl = this.template;
    if (!tmpl) return nothing;
    const { upcoming, invoiced } = this.affected;
    const booked = this.occurrences.length;
    const staffChange = this.staffChange;
    return html`<form slot="create" data-testid="appointments-series-form" data-mode="series-edit" class="form" @submit=${(e: Event) => this.submitEdit(e)}>
      <p class="ctx" data-role="series-context">
        <strong>${tmpl.customer_name}</strong> · ${tmpl.service_name} · ${tmpl.staff_name || '—'}
      </p>
      <!-- Una serie PARTIDA son dos mitades encadenadas, y decirlo es la mitad de poder entenderla:
           sin esto, la mitad nueva parece una serie que apareció de la nada. -->
      ${tmpl.split_from_id
        ? html`<ok-inline-feedback data-testid="appointments-series-split-from" data-role="split-from" tone="info" icon="git-branch-outline"
            >${t('ui.seriesSplitFrom', { id: tmpl.split_from_id })}</ok-inline-feedback
          >`
        : nothing}
      <p class="ctx" data-role="series-counts">
        ${t('ui.seriesBookedCount', { booked, from: this.shownDate(this.fromOccurrence), upcoming })}
      </p>
      <!-- EL RECUENTO ANTES DE CONFIRMAR. Mover el día de una serie le cambia TODAS las citas a la
           clienta; un aviso genérico no basta, y lo que ya está cobrado no se toca — se nombra. -->
      ${invoiced > 0
        ? html`<ok-inline-feedback data-testid="appointments-series-locked" data-role="series-locked" tone="warning" icon="lock-closed-outline"
            >${t('ui.seriesLockedInvoiced', { invoiced })}</ok-inline-feedback
          >`
        : nothing}
      <div class="grid">
        <!-- appointments#248: the professional of the series, for this and the following dates —
             the front desk hands a series to someone else without deleting it (Fresha, Square). -->
        <ion-select
          data-testid="appointments-series-staff"
          data-role="series-staff"
          fill="outline"
          mode="md"
          label=${t('ui.fieldStaff')}
          placeholder=${t('ui.pickStaff')}
          label-placement="floating"
          .value=${this.editStaffId}
          @ionChange=${(e: any) => (this.editStaffId = e.target.value ?? '')}
        >
          ${this.editStaffOptions.map((o) => html`<ion-select-option .value=${o.id}>${o.name}</ion-select-option>`)}
        </ion-select>
        <ion-select
          data-testid="appointments-series-frequency"
          fill="outline"
          mode="md"
          data-role="series-frequency"
          label=${t('ui.fieldFrequency')}
          label-placement="floating"
          .value=${this.editFrequency}
          @ionChange=${(e: any) => (this.editFrequency = e.target.value)}
        >
          ${FREQUENCIES.map((f) => html`<ion-select-option .value=${f}>${t(FREQUENCY_KEYS[f])}</ion-select-option>`)}
        </ion-select>
        ${ALIGNS_TO_WEEKDAY.includes(this.editFrequency)
          ? html`<ion-select
              data-testid="appointments-series-day"
              fill="outline"
              mode="md"
              data-role="series-day"
              label=${t('ui.fieldWeekday')}
              label-placement="floating"
              .value=${this.editDayOfWeek}
              @ionChange=${(e: any) => (this.editDayOfWeek = e.target.value)}
            >
              <ion-select-option value="">${t('ui.weekdayAny')}</ion-select-option>
              ${WEEKDAY_KEYS.map((k, i) => html`<ion-select-option .value=${String(i)}>${t(k)}</ion-select-option>`)}
            </ion-select>`
          : nothing}
        <!-- appointments#217: text in the hub clock, not the native time input (browser clock). -->
        <ion-input
          data-testid="appointments-series-time"
          fill="outline"
          mode="md"
          data-role="series-time"
          label=${t('ui.fieldTime')}
          label-placement="floating"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder=${t('ui.timePlaceholder')}
          .value=${this.timeFieldValue('edit')}
          @ionInput=${(e: any) => this.onTimeFieldInput('edit', e.target.value ?? '')}
          @ionChange=${() => this.commitTimeDraft('edit')}
        ></ion-input>
        <ion-input
          data-testid="appointments-series-duration"
          fill="outline"
          mode="md"
          data-role="series-duration"
          label=${t('ui.fieldMinutes')}
          label-placement="floating"
          type="number"
          min="1"
          .value=${this.editDuration}
          @ionInput=${(e: any) => (this.editDuration = e.target.value)}
        ></ion-input>
      </div>
      ${!tmpl.staff_id && !staffChange
        ? html`<ok-inline-feedback data-testid="appointments-series-no-staff" tone="warning" icon="person-outline"
            >${t('ui.seriesPickStaffToBook')}</ok-inline-feedback
          >`
        : nothing}
      ${staffChange && tmpl.staff_id
        ? html`<ok-inline-feedback data-testid="appointments-series-staff-hint" tone="info" icon="swap-horizontal-outline"
            >${t('ui.seriesStaffChangeHint', { from: this.shownDate(this.fromOccurrence), upcoming, staff: staffChange.name })}</ok-inline-feedback
          >`
        : nothing}
      <ok-inline-feedback data-testid="appointments-series-scope-hint" tone="info" icon="information-circle-outline"
        >${t('ui.seriesScopeHint', { from: this.shownDate(this.fromOccurrence) })}</ok-inline-feedback
      >
      <!-- pm#513: the refusal travels WITH the form — on a phone the panel is a full-screen sheet
           and a banner on the page underneath it is never seen. -->
      ${this.editError
        ? html`<ok-inline-feedback data-testid="appointments-series-form-error" tone="danger" icon="alert-circle-outline">${this.editError}</ok-inline-feedback>`
        : nothing}
      <!-- A half-typed time is not a time: saving would silently keep the old one (appointments#217). -->
      <ion-button data-testid="appointments-series-submit" type="submit" expand="block" .disabled=${this.saving || !this.editTime}>${t('ui.seriesSave')}</ion-button>
    </form>`;
  }

  /** appointments#209 — chosen service PRE-FILLS «Min.» with its catalog duration: the receptionist
   *  needs to SEE how long the series is going to book before saving, and re-picking the service
   *  re-fills from the new one because the typed exception belonged to the old one. */
  private onCreateServiceChange(serviceId: string): void {
    this.newServiceId = serviceId;
    const service = this.services.find((s) => s.id === serviceId);
    const m = Number(service?.duration_minutes);
    this.newDuration = Number.isFinite(m) && m >= 1 ? String(m) : '';
  }

  /** appointments#204/#209 — same trap as the new-appointment panel: the `date` field's year
   *  segment eats the caret, so a space/comma/`t` typed right after a full date hands the focus to
   *  the time field instead of doing nothing. */
  private onCreateStartDateKeydown(e: KeyboardEvent): void {
    if (e.key !== ' ' && e.key !== ',' && e.key !== 't' && e.key !== 'T') return;
    const value = (e.target as { value?: unknown }).value;
    // appointments#217: a text field now — only a COMPLETE day hands the caret over.
    if (typeof value !== 'string' || !parseTypedStart(value, erplora().locale)?.date) return;
    e.preventDefault();
    const timeField = this.renderRoot.querySelector('ion-input[data-role="series-start-time"]') as
      | (HTMLElement & { setFocus?: () => Promise<void> })
      | null;
    void timeField?.setFocus?.();
  }

  /** appointments#204/#209 — native `date`/`time` inputs ignore pasted text: read the clipboard as
   *  a whole start and fill whichever halves `parseTypedStart` recognizes. */
  private onCreateStartPaste(e: Event): void {
    const text = (e as ClipboardEvent).clipboardData?.getData('text') ?? '';
    const parsed: TypedStart | null = parseTypedStart(text, erplora().locale);
    if (!parsed) return;
    e.preventDefault();
    if (parsed.date) {
      this.newStartDate = parsed.date;
      this.dateDraft = { ...this.dateDraft, start: null };
    }
    if (parsed.time) {
      this.newStartTime = parsed.time;
      this.timeDraft = { ...this.timeDraft, new: null };
    }
  }

  /** appointments#217 — what a date field shows: the raw text while it is being typed, the date in
   *  the hub's day/month order otherwise. */
  private dateFieldValue(field: 'start' | 'end'): string {
    return this.dateDraft[field] ?? formatTypedDate(field === 'start' ? this.newStartDate : this.newEndDate, erplora().locale);
  }

  /** appointments#217 — `ionInput` on a date field: the text is kept as the draft and the ISO date
   *  follows it exactly, back to `''` while it is not (yet) a date — a half-typed day never keeps
   *  the last valid one. */
  private onDateFieldInput(field: 'start' | 'end', text: string): void {
    this.dateDraft = { ...this.dateDraft, [field]: text };
    const iso = parseTypedStart(text, erplora().locale)?.date ?? '';
    if (field === 'start') this.newStartDate = iso;
    else this.newEndDate = iso;
  }

  /** appointments#217 — blur/Enter on a date field: forget the draft so it repaints the committed date. */
  private commitDateDraft(field: 'start' | 'end'): void {
    this.dateDraft = { ...this.dateDraft, [field]: null };
  }

  /** appointments#217 — what a time field shows: the draft while typing, the hub clock otherwise. */
  private timeFieldValue(form: 'new' | 'edit'): string {
    return this.timeDraft[form] ?? formatTypedTime(form === 'new' ? this.newStartTime : this.editTime, erplora().locale);
  }

  /** appointments#217 — `ionInput` on a time field: the time follows the text exactly, `''` while it
   *  is not (yet) a time. */
  private onTimeFieldInput(form: 'new' | 'edit', text: string): void {
    this.timeDraft = { ...this.timeDraft, [form]: text };
    const time = parseTypedStart(text, erplora().locale)?.time ?? '';
    if (form === 'new') this.newStartTime = time;
    else this.editTime = time;
  }

  /** appointments#217 — blur/Enter on a time field: repaint the committed time in the hub clock. */
  private commitTimeDraft(form: 'new' | 'edit'): void {
    this.timeDraft = { ...this.timeDraft, [form]: null };
  }

  private toggleDateCalendar(field: 'start' | 'end'): void {
    this.calendarOpen = this.calendarOpen === field ? '' : field;
  }

  /** appointments#217 — `ok-date-select` of an inline `ok-calendar`: applies the tapped day like a
   *  typed one, forgets the draft and closes the calendar. */
  private onDateCalendarPick(field: 'start' | 'end', iso: string): void {
    if (field === 'start') this.newStartDate = iso;
    else this.newEndDate = iso;
    this.dateDraft = { ...this.dateDraft, [field]: null };
    this.calendarOpen = '';
  }

  /** `ok-calendar`'s labels default to English only: hand it the module's own catalog keys. */
  private calendarLabels(t: (k: string) => string): Record<string, string> {
    return {
      month: t('ui.calendarMonth'),
      agenda: t('ui.calendarAgenda'),
      agendaEmpty: t('ui.calendarAgendaEmpty'),
      more: t('ui.calendarMore'),
      prevMonth: t('ui.calendarPrevMonth'),
      nextMonth: t('ui.calendarNextMonth'),
    };
  }

  /** An «Until» typed but not (yet) a date: submitting would create a series with NO end. */
  private get endDateIncomplete(): boolean {
    return !this.newEndDate && !!this.dateDraft.end?.trim();
  }

  /** Everything the NEW-series draft holds, back to a blank form (appointments#209). */
  private resetCreateDraft(): void {
    this.newCustomerId = '';
    this.newServiceId = '';
    this.newStaffId = '';
    this.newFrequency = 'weekly';
    this.newDayOfWeek = '';
    this.newStartDate = '';
    this.newStartTime = '';
    this.newDuration = '';
    this.newEndDate = '';
    this.newOccurrences = '';
    this.createError = '';
    this.dateDraft = { start: null, end: null };
    this.timeDraft = { ...this.timeDraft, new: null };
    this.calendarOpen = '';
  }

  private renderCreateForm(t: (k: string, p?: Record<string, unknown>) => string) {
    const customer = this.customers.find((c) => c.id === this.newCustomerId);
    const service = this.services.find((s) => s.id === this.newServiceId);
    const staff = this.bookableStaff.find((m) => m.id === this.newStaffId);
    const duration = Math.trunc(Number(this.newDuration));
    const canSubmit =
      !this.saving &&
      !!customer &&
      !!service &&
      !!staff &&
      !!this.newStartDate &&
      !!this.newStartTime &&
      !this.endDateIncomplete &&
      Number.isFinite(duration) &&
      duration >= 1;
    return html`<form slot="create" data-testid="appointments-series-create-form" data-mode="series-create" class="form" @submit=${(e: Event) => this.createSeries(e)}>
      <div class="grid">
        <ion-select
          data-testid="appointments-series-create-customer"
          data-role="series-create-customer"
          fill="outline"
          mode="md"
          label=${t('ui.fieldCustomer')}
          placeholder=${t('ui.pickCustomer')}
          label-placement="floating"
          .value=${this.newCustomerId}
          @ionChange=${(e: any) => (this.newCustomerId = e.target.value ?? '')}
        >
          ${this.customers.map((c) => html`<ion-select-option .value=${c.id}>${c.name}</ion-select-option>`)}
        </ion-select>
        <ion-select
          data-testid="appointments-series-create-service"
          data-role="series-create-service"
          fill="outline"
          mode="md"
          label=${t('ui.fieldService')}
          placeholder=${t('ui.pickService')}
          label-placement="floating"
          .value=${this.newServiceId}
          @ionChange=${(e: any) => this.onCreateServiceChange(e.target.value ?? '')}
        >
          ${this.services.map((s) => html`<ion-select-option .value=${s.id}>${s.name}</ion-select-option>`)}
        </ion-select>
        <ion-select
          data-testid="appointments-series-create-staff"
          data-role="series-create-staff"
          fill="outline"
          mode="md"
          label=${t('ui.fieldStaff')}
          placeholder=${t('ui.pickStaff')}
          label-placement="floating"
          .value=${this.newStaffId}
          @ionChange=${(e: any) => (this.newStaffId = e.target.value ?? '')}
        >
          ${this.bookableStaff.map((m) => html`<ion-select-option .value=${m.id}>${m.full_name}</ion-select-option>`)}
        </ion-select>
        <ion-select
          data-testid="appointments-series-create-frequency"
          data-role="series-create-frequency"
          fill="outline"
          mode="md"
          label=${t('ui.fieldFrequency')}
          label-placement="floating"
          .value=${this.newFrequency}
          @ionChange=${(e: any) => (this.newFrequency = e.target.value)}
        >
          ${FREQUENCIES.map((f) => html`<ion-select-option .value=${f}>${t(FREQUENCY_KEYS[f])}</ion-select-option>`)}
        </ion-select>
        ${ALIGNS_TO_WEEKDAY.includes(this.newFrequency)
          ? html`<ion-select
              data-testid="appointments-series-create-day"
              data-role="series-create-day"
              fill="outline"
              mode="md"
              label=${t('ui.fieldWeekday')}
              label-placement="floating"
              .value=${this.newDayOfWeek}
              @ionChange=${(e: any) => (this.newDayOfWeek = e.target.value)}
            >
              <ion-select-option value="">${t('ui.weekdayAny')}</ion-select-option>
              ${WEEKDAY_KEYS.map((k, i) => html`<ion-select-option .value=${String(i)}>${t(k)}</ion-select-option>`)}
            </ion-select>`
          : nothing}
        <ion-input
          data-testid="appointments-series-create-start"
          data-role="series-start-date"
          fill="outline"
          mode="md"
          label=${t('ui.fieldDate')}
          label-placement="floating"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder=${t('ui.datePlaceholder')}
          .value=${this.dateFieldValue('start')}
          @ionInput=${(e: any) => this.onDateFieldInput('start', e.target.value ?? '')}
          @ionChange=${() => this.commitDateDraft('start')}
          @keydown=${(e: KeyboardEvent) => this.onCreateStartDateKeydown(e)}
          @paste=${(e: Event) => this.onCreateStartPaste(e)}
        >
          <ion-button slot="end" type="button" fill="clear" size="small" data-testid="appointments-series-create-start-calendar" aria-label=${t('ui.openCalendar')} @click=${() => this.toggleDateCalendar('start')}>
            <ion-icon slot="icon-only" name="calendar-outline"></ion-icon>
          </ion-button>
        </ion-input>
        ${this.calendarOpen === 'start'
          ? html`<div class="field-calendar">
              <ok-calendar
                data-testid="appointments-series-create-start-calendar-picker"
                picker
                locale=${erplora().locale || 'es'}
                .value=${this.newStartDate || todayISO()}
                .labels=${this.calendarLabels(t)}
                @ok-date-select=${(e: CustomEvent<{ date: string }>) => this.onDateCalendarPick('start', e.detail.date)}
              ></ok-calendar>
            </div>`
          : nothing}
        <ion-input
          data-testid="appointments-series-create-start-time"
          data-role="series-start-time"
          fill="outline"
          mode="md"
          label=${t('ui.fieldTime')}
          label-placement="floating"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder=${t('ui.timePlaceholder')}
          .value=${this.timeFieldValue('new')}
          @ionInput=${(e: any) => this.onTimeFieldInput('new', e.target.value ?? '')}
          @ionChange=${() => this.commitTimeDraft('new')}
          @paste=${(e: Event) => this.onCreateStartPaste(e)}
        ></ion-input>
        <ion-input
          data-testid="appointments-series-create-duration"
          data-role="series-create-duration"
          fill="outline"
          mode="md"
          label=${t('ui.fieldMinutes')}
          label-placement="floating"
          type="number"
          min="1"
          .value=${this.newDuration}
          @ionInput=${(e: any) => (this.newDuration = e.target.value)}
        ></ion-input>
        <ion-input
          data-testid="appointments-series-create-end"
          data-role="series-create-end"
          fill="outline"
          mode="md"
          label=${t('ui.fieldEndDate')}
          label-placement="floating"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder=${t('ui.datePlaceholder')}
          .value=${this.dateFieldValue('end')}
          @ionInput=${(e: any) => this.onDateFieldInput('end', e.target.value ?? '')}
          @ionChange=${() => this.commitDateDraft('end')}
        >
          <ion-button slot="end" type="button" fill="clear" size="small" data-testid="appointments-series-create-end-calendar" aria-label=${t('ui.openCalendar')} @click=${() => this.toggleDateCalendar('end')}>
            <ion-icon slot="icon-only" name="calendar-outline"></ion-icon>
          </ion-button>
        </ion-input>
        ${this.calendarOpen === 'end'
          ? html`<div class="field-calendar">
              <!-- Before an «Until» is picked, the calendar opens on the series' first day. -->
              <ok-calendar
                data-testid="appointments-series-create-end-calendar-picker"
                picker
                locale=${erplora().locale || 'es'}
                .value=${this.newEndDate || this.newStartDate || todayISO()}
                .labels=${this.calendarLabels(t)}
                @ok-date-select=${(e: CustomEvent<{ date: string }>) => this.onDateCalendarPick('end', e.detail.date)}
              ></ok-calendar>
            </div>`
          : nothing}
        <ion-input
          data-testid="appointments-series-create-occurrences"
          data-role="series-create-occurrences"
          fill="outline"
          mode="md"
          label=${t('ui.fieldOccurrences')}
          label-placement="floating"
          type="number"
          min="1"
          .value=${this.newOccurrences}
          @ionInput=${(e: any) => (this.newOccurrences = e.target.value)}
        ></ion-input>
      </div>
      ${this.createError
        ? html`<ok-inline-feedback data-testid="appointments-series-create-error" tone="danger" icon="alert-circle-outline">${this.createError}</ok-inline-feedback>`
        : nothing}
      <ion-button data-testid="appointments-series-create-submit" type="submit" expand="block" ?disabled=${!canSubmit}
        >${this.saving ? t('ui.saving') : t('ui.seriesCreate')}</ion-button
      >
    </form>`;
  }

  /** appointments#209 — creates the series with the existing `appointments.recurring.create`
   *  command and books its window right away with `appointments.recurring.materialize`, the same
   *  two-step chain `submitEdit` already runs for a pattern change: a repeating appointment that
   *  is created but never booked would land on nobody's agenda. */
  async createSeries(ev: Event): Promise<void> {
    ev.preventDefault?.();
    if (this.saving) return;
    const customer = this.customers.find((c) => c.id === this.newCustomerId);
    const service = this.services.find((s) => s.id === this.newServiceId);
    const staff = this.bookableStaff.find((m) => m.id === this.newStaffId);
    const duration = Math.trunc(Number(this.newDuration));
    if (
      !customer ||
      !service ||
      !staff ||
      !this.newStartDate ||
      !this.newStartTime ||
      this.endDateIncomplete ||
      !Number.isFinite(duration) ||
      duration < 1
    ) {
      return;
    }
    this.saving = true;
    this.createError = '';
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    try {
      const occurrences = Math.trunc(Number(this.newOccurrences));
      // The command name must be a LITERAL in the call (ADR-0127: the interop contract finds it by
      // static analysis, not at runtime).
      const result = (await erplora().command('appointments.recurring.create', {
        customer_id: customer.id,
        customer_name: customer.name,
        service_id: service.id,
        service_name: service.name,
        staff_id: staff.id,
        staff_name: staff.full_name,
        frequency: this.newFrequency,
        // The weekday only aligns patterns that advance by weeks (see ALIGNS_TO_WEEKDAY).
        day_of_week:
          ALIGNS_TO_WEEKDAY.includes(this.newFrequency) && this.newDayOfWeek !== ''
            ? Math.trunc(Number(this.newDayOfWeek))
            : null,
        time: this.newStartTime,
        duration_minutes: duration,
        start_date: this.newStartDate,
        end_date: this.newEndDate || null,
        max_occurrences: Number.isFinite(occurrences) && occurrences >= 1 ? occurrences : null,
      })) as { new_ids?: string[] } | undefined;
      const newId = String(result?.new_ids?.[0] ?? '');
      this.resetCreateDraft();
      // The open panel would cover the table and the series just created.
      this.dataTable()?.close();
      // A NEW repeating appointment lands on the agenda right away, like Fresha or Square: the
      // three ids travel as SELECTOR, not source (appointments#54) — the handler contrasts them
      // against the template it just wrote and refuses if they do not match.
      let notBooked = false;
      let report: SeriesBookingReport | null = null;
      try {
        report = bookingReport(
          await erplora().command('appointments.recurring.materialize', {
            recurring_id: newId,
            customer_id: customer.id,
            service_id: service.id,
            staff_id: staff.id,
          }),
        );
      } catch {
        notBooked = true;
      }
      await this.refresh();
      if (notBooked) {
        // Set AFTER refresh(): refresh() clears `error` at the start, and a booking failure that
        // does not survive it would leave the front desk believing the series booked fine.
        this.error = t('ui.seriesCreatedNotBooked');
      } else if (!this.showSkipped(report)) {
        // appointments#238: «created and booked» only when no date was left out.
        erplora().notify?.({ type: 'success', message: t('ui.seriesCreated') });
      }
    } catch (e) {
      this.createError = e instanceof Error && e.message ? e.message : t('ui.seriesSaveError');
    } finally {
      this.saving = false;
    }
  }
}

define('erp-appointments-series', ErpAppointmentsSeries);

declare global {
  interface HTMLElementTagNameMap {
    'erp-appointments-series': ErpAppointmentsSeries;
  }
}
