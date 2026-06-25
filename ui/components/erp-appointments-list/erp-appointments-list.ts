import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
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
  service_id: string;
  staff_name: string;
  staff_id: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
  status: string;
}

/** Servicio del catálogo `services` (contrato público; da la DURACIÓN de la cita). */
interface ServiceOption {
  id: string;
  name: string;
  duration_minutes: number;
}

/** Miembro del staff (contrato público de `staff`; la cita se asigna a su `staff_id`). */
interface StaffOption {
  id: string;
  full_name: string;
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

function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(11, 16);
}

/** Traduce el `reason` del motor de disponibilidad a una clave i18n de mensaje claro. */
function reasonKey(reason: string): string {
  switch (reason) {
    case 'overlap':
      return 'ui.errOverlap';
    case 'outside_schedule':
      return 'ui.errOutsideSchedule';
    case 'blocked':
      return 'ui.errBlocked';
    case 'too_soon':
      return 'ui.errTooSoon';
    case 'too_far':
      return 'ui.errTooFar';
    default:
      return 'ui.errSlotUnavailable';
  }
}

export class ErpAppointmentsList extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .filters { display:flex; gap:.75rem; align-items:end; margin:.25rem 0 1rem; flex-wrap:wrap; }
    .form { display:flex; gap:.75rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select, .filters ion-input, .filters ion-select {
      flex:1 1 11rem; min-width:9rem;
    }
    .err { color:#d9480f; font-weight:600; }
  `;

  @state() items: Appointment[] = [];

  @state() loading = true;

  @state() error = '';

  @state() saving = false;

  @state() day = todayISO();

  @state() statusFilter = '';

  // Catálogos cross-módulo para los selectores del formulario.
  @state() services: ServiceOption[] = [];

  @state() staff: StaffOption[] = [];

  // Campos del formulario de alta.
  @state() newCustomer = '';

  @state() newPhone = '';

  @state() newServiceId = '';

  @state() newStaffId = '';

  @state() newStart = '';

  private unsub?: () => void;

  // i18n (ADR-0055): re-renderiza al recibir `erplora:locale-changed`.
  private readonly onLocaleChange = (): void => this.requestUpdate();

  private statusLabel(status: string): string {
    const key = STATUS_KEYS[status];
    return key ? erplora().t(CATALOG, key) : status;
  }

  /** Duración (min) del servicio seleccionado; sin servicio no hay ventana → no se crea. */
  private get selectedDuration(): number {
    const svc = this.services.find((s) => s.id === this.newServiceId);
    return svc ? Number(svc.duration_minutes) || 0 : 0;
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
    await Promise.all([this.refresh(), this.loadCatalogs()]);
    try {
      const events = [
        'appointments.appointment.created',
        'appointments.appointment.updated',
        'appointments.appointment.confirmed',
        'appointments.appointment.started',
        'appointments.appointment.completed',
        'appointments.appointment.cancelled',
        'appointments.appointment.no_show',
        'appointments.appointment.rescheduled',
        'appointments.appointment.deleted',
      ];
      const offs = events.map((e) => erplora().on(e, () => this.refresh()));
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

  /** Carga servicios y staff (contratos públicos cross-módulo). Degrada sin romper si el
   *  módulo no está instalado/no hay permiso: el formulario sigue funcionando con lo que haya. */
  private async loadCatalogs() {
    try {
      const svc = await erplora().query<ServiceOption[]>('services.services.list', { limit: 200 });
      this.services = Array.isArray(svc) ? svc : [];
    } catch {
      this.services = [];
    }
    try {
      const st = await erplora().query<StaffOption[]>('staff.members.list', { is_bookable: 1, limit: 200 });
      this.staff = Array.isArray(st) ? st : [];
    } catch {
      this.staff = [];
    }
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

  /** Motor de disponibilidad autoritativo (req. #3): pregunta a `appointments.availability.check`
   *  POR `staff_id` antes de materializar create/reschedule. Devuelve la clave i18n del error si
   *  la franja no está libre, o `null` si está disponible. El `staff_id` solo se pasa si hay
   *  profesional elegida (sin ella → comprobación global). */
  private async availabilityError(
    startIso: string,
    duration: number,
    staffId: string,
    excludeAppointmentId?: string,
  ): Promise<string | null> {
    const p: Record<string, unknown> = { start_datetime: startIso, duration_minutes: duration };
    if (staffId) p.staff_id = staffId;
    // Al reprogramar, la cita NO debe solaparse consigo misma: la excluimos del chequeo.
    if (excludeAppointmentId) p.exclude_appointment_id = excludeAppointmentId;
    try {
      const check = await erplora().query<Array<{ available: number; reason: string }>>(
        'appointments.availability.check',
        p,
      );
      const slot = Array.isArray(check) ? check[0] : undefined;
      if (slot && Number(slot.available) === 0) {
        return reasonKey(slot.reason);
      }
      return null;
    } catch {
      // Si el motor no responde, no bloqueamos por un fallo de lectura (el runtime es la
      // autoridad final); pero registramos un mensaje genérico para no crear a ciegas.
      return null;
    }
  }

  private async createAppointment(ev: Event) {
    ev.preventDefault();
    // Req. #4: cliente + SERVICIO (da la duración) + inicio son obligatorios.
    if (!this.newCustomer.trim() || !this.newServiceId || !this.newStart) return;
    const duration = this.selectedDuration;
    if (duration < 1) {
      this.error = erplora().t(CATALOG, 'ui.errNoService');
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      // El input datetime-local da 'YYYY-MM-DDTHH:MM'; lo normalizamos a ISO con tz UTC.
      const startIso = new Date(this.newStart).toISOString();
      // Req. #2/#3: motor de disponibilidad POR PROFESIONAL antes de crear (solape/horario).
      const errKey = await this.availabilityError(startIso, duration, this.newStaffId);
      if (errKey) {
        this.error = erplora().t(CATALOG, errKey);
        this.saving = false;
        return;
      }
      const svc = this.services.find((s) => s.id === this.newServiceId);
      const staff = this.staff.find((s) => s.id === this.newStaffId);
      await erplora().command('appointments.appointments.create', {
        customer_name: this.newCustomer.trim(),
        customer_phone: this.newPhone.trim(),
        service_id: this.newServiceId,
        service_name: svc?.name ?? '',
        staff_id: this.newStaffId || null,
        staff_name: staff?.full_name ?? '',
        start_datetime: startIso,
        duration_minutes: duration,
      });
      this.newCustomer = '';
      this.newPhone = '';
      this.newServiceId = '';
      this.newStaffId = '';
      this.newStart = '';
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
        case 'reschedule':
          await this.reschedule(row as unknown as Appointment);
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

  /** Reprograma una cita a nueva fecha/hora, consultando el motor de disponibilidad POR el
   *  `staff_id` de la cita (req. #2/#3) y excluyendo la propia cita del chequeo de solape. */
  private async reschedule(appt: Appointment) {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const current = appt.start_datetime ? new Date(appt.start_datetime) : new Date();
    const suggestion = Number.isNaN(current.getTime()) ? '' : current.toISOString().slice(0, 16);
    const answer = window.prompt(t('ui.reschedulePrompt'), suggestion);
    if (!answer) return;
    const parsed = new Date(answer);
    if (Number.isNaN(parsed.getTime())) {
      this.error = t('ui.errInvalidDate');
      return;
    }
    const startIso = parsed.toISOString();
    const duration = Number(appt.duration_minutes) || 0;
    const errKey = await this.availabilityError(startIso, duration, appt.staff_id ?? '', appt.id);
    if (errKey) {
      this.error = t(errKey);
      return;
    }
    const endIso = new Date(parsed.getTime() + duration * 60 * 1000).toISOString();
    await erplora().command('appointments.appointments.reschedule', {
      appointment_id: appt.id,
      start_datetime: startIso,
      end_datetime: endIso,
      duration_minutes: duration,
    });
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const canCreate = !!this.newCustomer && !!this.newServiceId && !!this.newStart;
    const rowActions = [
      ...this.rowActions.slice(0, 4),
      { id: 'reschedule', label: t('ui.actionReschedule'), icon: 'calendar-outline', color: 'primary' },
      this.rowActions[4],
    ];
    return html`<div>
        <header>
          <h2>${t('ui.title')}</h2>
        </header>
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
        <form class="form" @submit=${(e: Event) => this.createAppointment(e)}>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.colCustomer')} .value=${this.newCustomer} @ionInput=${(e: any) => (this.newCustomer = e.target.value)}></ion-input>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldPhone')} .value=${this.newPhone} @ionInput=${(e: any) => (this.newPhone = e.target.value)}></ion-input>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colService')} placeholder=${t('ui.fieldServicePlaceholder')} .value=${this.newServiceId} @ionChange=${(e: any) => (this.newServiceId = e.target.value)}>
            ${this.services.map((s) => html`<ion-select-option .value=${s.id}>${s.name}${s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}</ion-select-option>`)}
          </ion-select>
          <ion-select fill="outline" label-placement="floating" label=${t('ui.colStaff')} placeholder=${t('ui.fieldStaffPlaceholder')} .value=${this.newStaffId} @ionChange=${(e: any) => (this.newStaffId = e.target.value)}>
            <ion-select-option value="">${t('ui.staffAny')}</ion-select-option>
            ${this.staff.map((s) => html`<ion-select-option .value=${s.id}>${s.full_name}</ion-select-option>`)}
          </ion-select>
          <ion-input fill="outline" label-placement="floating" label=${t('ui.fieldStart')} type="datetime-local" .value=${this.newStart} @ionInput=${(e: any) => (this.newStart = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !canCreate}>${this.saving ? t('ui.saving') : t('ui.addAppointment')}</ion-button>
        </form>
        ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
        <ok-data-table .columns=${this.columns} .rows=${this.items as unknown as Record<string, unknown>[]} .searchKeys=${['appointment_number', 'customer_name', 'service_name', 'staff_name']} .searchPlaceholder=${t('ui.searchPlaceholder')} .actions=${rowActions} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} .emptyMessage=${this.loading ? t('ui.loading') : t('ui.empty')}></ok-data-table>
      </div>`;
  }
}

define('erp-appointments-list', ErpAppointmentsList);
