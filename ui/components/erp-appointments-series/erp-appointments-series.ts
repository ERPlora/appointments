import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
import { dataTableLabels } from '@erplora/module-sdk';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
import { todayISO } from '../../lib/business-time';
// appointments#204/#209: a start typed or pasted as one string is read in the active language's
// day/month order and split into the Day + Time fields, the same helper the new-appointment and
// reschedule panels of `erp-appointments-list` use.
import { parseTypedStart, type TypedStart } from '../../lib/typed-start';

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
    .ctx { margin:0; font-size:.9rem; color: var(--ion-color-medium, #8b897f); }
    .ctx strong { color: var(--ion-text-color, #1c1b18); }
    .loading, .empty { color: var(--ion-color-medium, #8b897f); font-size:.9rem; margin:.25rem 0; }
  `;

  @state() series: Series[] = [];
  @state() loading = true;
  @state() error = '';
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

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
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
      this.editDuration = String(tmpl.duration_minutes ?? '');
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
    // Guardar sin tocar nada no escribe: el command lo rechazaría («nada que cambiar») y el panel
    // habría prometido algo que no ocurrió.
    if (Object.keys(changed).length === 0) {
      this.closePanel();
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const result = (await erplora().command('appointments.recurring.update', {
        recurring_id: this.editingId,
        scope: 'this_and_following',
        from_occurrence_date: this.fromOccurrence,
        ...changed,
      })) as Record<string, unknown> | undefined;

      // CAMBIO DE PAUTA → hay que RESERVAR. El command mueve lo que sigue cabiendo y cancela lo
      // que no, pero no reserva los días nuevos: eso es `materialize`, que es quien tiene las
      // reads de catálogo y disponibilidad. Sin este paso la clienta se queda sin nada en el día
      // nuevo, que es la mitad del gesto que ella pidió.
      if (result?.pattern_changed === true) {
        await this.bookWindow(String(result.recurring_id ?? this.editingId), tmpl);
      }
      this.notifyOutcome(result);
      this.closePanel();
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error && e.message ? e.message : erplora().t(CATALOG, 'ui.seriesSaveError');
    } finally {
      this.saving = false;
    }
  }

  /** Lo que NO se movió se DICE. Callarlo es el fallo nº1 que reportan los foros de este gesto. */
  private notifyOutcome(result: Record<string, unknown> | undefined): void {
    if (!result) return;
    const t = (k: string, p?: Record<string, unknown>): string => erplora().t(CATALOG, k, p);
    const message = t('ui.seriesUpdateOutcome', {
      moved: Number(result.moved ?? 0),
      cancelled: Number(result.cancelled_pattern_change ?? 0),
      locked: Number(result.locked_invoiced ?? 0),
    });
    erplora().notify?.({ type: 'success', message });
  }

  private async bookWindow(recurringId: string, tmpl: SeriesTemplate): Promise<void> {
    // Los tres ids son SELECTOR, no fuente (appointments#54): el handler los contrasta con la
    // plantilla que carga el runtime y rechaza si no coinciden.
    await erplora().command('appointments.recurring.materialize', {
      recurring_id: recurringId,
      customer_id: tmpl.customer_id ?? '',
      service_id: tmpl.service_id ?? '',
      staff_id: tmpl.staff_id ?? '',
    });
  }

  /** Materializar la ventana desde la lista: la serie ya existe, lo que falta son sus citas. */
  async materializeSeries(row: Record<string, unknown>): Promise<void> {
    const id = String(row.id ?? '');
    if (!id) return;
    this.error = '';
    try {
      const tmpl = await this.loadTemplate(id);
      if (!tmpl) {
        this.error = erplora().t(CATALOG, 'ui.seriesNotFound');
        return;
      }
      await this.bookWindow(id, tmpl);
      erplora().notify?.({ type: 'success', message: erplora().t(CATALOG, 'ui.seriesMaterialized') });
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
    if (row.time) parts.push(row.time);
    return parts.join(' · ');
  }

  private get columns(): DataTableColumn[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return [
      { key: 'customer_name', header: t('ui.colCustomer') },
      { key: 'service_name', header: t('ui.colService') },
      { key: 'staff_name', header: t('ui.colStaff'), format: (r) => (r.staff_name as string) || '—' },
      { key: 'frequency', header: t('ui.colPattern'), format: (r) => this.patternLabel(r as unknown as Series) },
      { key: 'start_date', header: t('ui.colStarts') },
      { key: 'end_date', header: t('ui.colEnds'), format: (r) => (r.end_date as string) || t('ui.seriesNoEnd') },
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

  private renderEditForm(t: (k: string, p?: Record<string, unknown>) => string) {
    const tmpl = this.template;
    if (!tmpl) return nothing;
    const { upcoming, invoiced } = this.affected;
    const booked = this.occurrences.length;
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
        ${t('ui.seriesBookedCount', { booked, from: this.fromOccurrence, upcoming })}
      </p>
      <!-- EL RECUENTO ANTES DE CONFIRMAR. Mover el día de una serie le cambia TODAS las citas a la
           clienta; un aviso genérico no basta, y lo que ya está cobrado no se toca — se nombra. -->
      ${invoiced > 0
        ? html`<ok-inline-feedback data-testid="appointments-series-locked" data-role="series-locked" tone="warning" icon="lock-closed-outline"
            >${t('ui.seriesLockedInvoiced', { invoiced })}</ok-inline-feedback
          >`
        : nothing}
      <div class="grid">
        <ion-select
          data-testid="appointments-series-frequency"
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
        <ion-input
          data-testid="appointments-series-time"
          data-role="series-time"
          label=${t('ui.fieldTime')}
          label-placement="floating"
          type="time"
          .value=${this.editTime}
          @ionInput=${(e: any) => (this.editTime = e.target.value)}
        ></ion-input>
        <ion-input
          data-testid="appointments-series-duration"
          data-role="series-duration"
          label=${t('ui.fieldMinutes')}
          label-placement="floating"
          type="number"
          min="1"
          .value=${this.editDuration}
          @ionInput=${(e: any) => (this.editDuration = e.target.value)}
        ></ion-input>
      </div>
      <ok-inline-feedback data-testid="appointments-series-scope-hint" tone="info" icon="information-circle-outline"
        >${t('ui.seriesScopeHint', { from: this.fromOccurrence })}</ok-inline-feedback
      >
      <ion-button data-testid="appointments-series-submit" type="submit" expand="block" .disabled=${this.saving}>${t('ui.seriesSave')}</ion-button>
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
    if (typeof value !== 'string' || !value) return;
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
    if (parsed.date) this.newStartDate = parsed.date;
    if (parsed.time) this.newStartTime = parsed.time;
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
          type="date"
          .value=${this.newStartDate}
          @ionInput=${(e: any) => (this.newStartDate = e.target.value ?? '')}
          @keydown=${(e: KeyboardEvent) => this.onCreateStartDateKeydown(e)}
          @paste=${(e: Event) => this.onCreateStartPaste(e)}
        ></ion-input>
        <ion-input
          data-testid="appointments-series-create-start-time"
          data-role="series-start-time"
          fill="outline"
          mode="md"
          label=${t('ui.fieldTime')}
          label-placement="floating"
          type="time"
          .value=${this.newStartTime}
          @ionInput=${(e: any) => (this.newStartTime = e.target.value ?? '')}
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
          type="date"
          .value=${this.newEndDate}
          @ionInput=${(e: any) => (this.newEndDate = e.target.value ?? '')}
        ></ion-input>
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
      try {
        await erplora().command('appointments.recurring.materialize', {
          recurring_id: newId,
          customer_id: customer.id,
          service_id: service.id,
          staff_id: staff.id,
        });
      } catch {
        notBooked = true;
      }
      await this.refresh();
      if (notBooked) {
        // Set AFTER refresh(): refresh() clears `error` at the start, and a booking failure that
        // does not survive it would leave the front desk believing the series booked fine.
        this.error = t('ui.seriesCreatedNotBooked');
      } else {
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
