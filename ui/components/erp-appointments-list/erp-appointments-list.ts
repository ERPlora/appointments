import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';
// i18n (ADR-0055): catálogo `ui` inlineado por esbuild; los textos internos se resuelven
// con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

interface Appointment {
  id: string;
  appointment_number: string;
  customer_name: string;
  customer_phone: string;
  service_name: string;
  staff_name: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
  status: string;
}

const STATUS_KEYS: Record<string, string> = {
  pending: 'ui.statusPending',
  confirmed: 'ui.statusConfirmed',
  in_progress: 'ui.statusInProgress',
  completed: 'ui.statusCompleted',
  cancelled: 'ui.statusCancelled',
  no_show: 'ui.statusNoShow',
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayBounds(day: string): { day_start: string; day_end: string } {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { day_start: start.toISOString(), day_end: end.toISOString() };
}

/** Hora de la cita EN LOCAL. La cita se guarda en UTC (el alta hace `new Date(local).toISOString()`),
 *  así que pintarla con `toISOString()` la devolvía en UTC: una cita de las 09:30 en Madrid (07:30Z)
 *  se listaba como «07:30» — el salón parecía lleno dos horas antes de abrir. */
function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString(erplora().locale || 'es', { hour: '2-digit', minute: '2-digit' });
}

export class ErpAppointmentsList extends LitElement {
  static styles = css`
    :host { display:flex; flex-direction:column; height:100%; min-height:0; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    /* La vista llena el alto: el data-table ocupa el resto (scroll interno, pie fijo). */
    .page { display:flex; flex-direction:column; min-height:0; flex:1 1 auto; }
    .page > ok-data-table { flex:1 1 auto; min-height:0; }
    /* ALCANCE de la consulta (día + estado), no filtros de columna: se queda fuera de la tabla. */
    .filters { display:flex; gap:.75rem; align-items:end; margin:0 0 .75rem; flex-wrap:wrap; }
    .filters ion-input, .filters ion-select { flex:1 1 11rem; min-width:9rem; }
    /* Formulario del panel de alta (drawer estrecho) → una columna, no en fila. */
    .form { display:flex; flex-direction:column; gap:.7rem; }
    .form ion-button { align-self:flex-end; }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() items: Appointment[] = [];

  @state() loading = true;

  @state() error = '';

  @state() saving = false;

  @state() day = todayISO();

  @state() statusFilter = '';

  @state() newCustomer = '';

  @state() newPhone = '';

  @state() newService = '';

  @state() newStart = '';

  @state() newDuration = '60';

  private unsub?: () => void;

  // i18n (ADR-0055): re-renderiza al recibir `erplora:locale-changed`.
  private readonly onLocaleChange = (): void => this.requestUpdate();

  private statusLabel(status: string): string {
    const key = STATUS_KEYS[status];
    return key ? erplora().t(CATALOG, key) : status;
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
      { id: 'confirm', label: t('ui.actionConfirm'), icon: 'checkmark-circle-outline', color: 'success' },
      { id: 'start', label: t('ui.actionStart'), icon: 'play-circle-outline', color: 'primary' },
      { id: 'complete', label: t('ui.actionComplete'), icon: 'checkmark-done-outline', color: 'success' },
      { id: 'cancel', label: t('ui.actionCancel'), icon: 'close-circle-outline', color: 'danger' },
      { id: 'delete', label: t('ui.actionDelete'), icon: 'trash-outline', color: 'danger' },
    ];
  }

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    await this.refresh();
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
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const { day_start, day_end } = dayBounds(this.day);
      const rows = await erplora().query<Appointment[]>('appointments.appointments.list', {
        day_start,
        day_end,
        status: this.statusFilter,
        staff_id: '',
        limit: 100,
      });
      this.items = rows ?? [];
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
    if (!this.newCustomer.trim() || !this.newStart) return;
    this.saving = true;
    this.error = '';
    try {
      // El input datetime-local da 'YYYY-MM-DDTHH:MM'; lo normalizamos a ISO con tz UTC.
      const startIso = new Date(this.newStart).toISOString();
      await erplora().command('appointments.appointments.create', {
        customer_name: this.newCustomer.trim(),
        customer_phone: this.newPhone.trim(),
        service_name: this.newService.trim(),
        start_datetime: startIso,
        duration_minutes: Number(this.newDuration) || 60,
      });
      this.newCustomer = '';
      this.newPhone = '';
      this.newService = '';
      this.newStart = '';
      this.newDuration = '60';
      this.dataTable()?.close(); // el panel del «+» taparía la tabla y la cita recién creada
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreate');
    } finally {
      this.saving = false;
    }
  }

  private async onRowAction(ev: CustomEvent<{ actionId: string; row: Record<string, unknown> }>) {
    const { actionId, row } = ev.detail;
    const id = row.id as string;
    this.error = '';
    try {
      switch (actionId) {
        case 'confirm':
          await erplora().command('appointments.appointments.confirm', { appointment_id: id });
          break;
        case 'start':
          await erplora().command('appointments.appointments.start', { appointment_id: id });
          break;
        case 'complete':
          await erplora().command('appointments.appointments.complete', { appointment_id: id });
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
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errAction');
    }
  }

  // El título de la vista lo pinta el topbar del shell: repetirlo aquí lo duplicaba en pantalla.
  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<div class="page">
        <!-- Día y estado NO son filtros de columna: son el ALCANCE de la consulta (los binds
             day_start/day_end/status de appointments.appointments.list, que no es una lista
             paginada del motor). Deciden QUÉ se carga → viven fuera del embudo de la tabla. -->
        <div class="filters">
          <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldDate')} type="date" .value=${this.day} @ionInput=${(e: any) => {
              this.day = e.target.value;
              this.refresh();
            }}></ion-input>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colStatus')} placeholder=${t('ui.allStatuses')} .value=${this.statusFilter} @ionChange=${(e: any) => {
              this.statusFilter = e.target.value;
              this.refresh();
            }}>
            <ion-select-option value="">${t('ui.statusAll')}</ion-select-option>
            ${Object.keys(STATUS_KEYS).map((k) => html`<ion-select-option .value=${k}>${this.statusLabel(k)}</ion-select-option>`)}
          </ion-select>
        </div>
        ${this.error ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>` : nothing}
        <ok-data-table .fill=${true} .addable=${true} .columns=${this.columns} .rows=${this.items as unknown as Record<string, unknown>[]} .searchKeys=${['appointment_number', 'customer_name', 'service_name', 'staff_name']} .searchPlaceholder=${t('ui.searchPlaceholder')} .actions=${this.rowActions} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} .emptyMessage=${this.loading ? t('ui.loading') : t('ui.empty')}>
          <!-- Alta de cita: se proyecta SIEMPRE (aunque el panel esté cerrado); si solo se pintara
               al abrirlo, el «+» desplegaría un panel vacío en el primer clic. -->
          <form slot="create" class="form" @submit=${(e: Event) => this.createAppointment(e)}>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colCustomer')} .value=${this.newCustomer} @ionInput=${(e: any) => (this.newCustomer = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldPhone')} .value=${this.newPhone} @ionInput=${(e: any) => (this.newPhone = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.colService')} .value=${this.newService} @ionInput=${(e: any) => (this.newService = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldStart')} type="datetime-local" .value=${this.newStart} @ionInput=${(e: any) => (this.newStart = e.target.value)}></ion-input>
            <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldMinutes')} type="number" min="1" .value=${this.newDuration} @ionInput=${(e: any) => (this.newDuration = e.target.value)}></ion-input>
            <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCustomer || !this.newStart}>${this.saving ? t('ui.saving') : t('ui.addAppointment')}</ion-button>
          </form>
        </ok-data-table>
      </div>`;
  }
}

define('erp-appointments-list', ErpAppointmentsList);
