import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-data-table';
import type { DataTableColumn } from '@erplora/outfitkit';

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  on(event: string, cb: (payload: unknown) => void): () => void;
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

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  in_progress: 'En curso',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No-show',
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

export class ErpAppointmentsList extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ink, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .filters { display:flex; gap:.5rem; align-items:end; margin:.25rem 0 1rem; flex-wrap:wrap; }
    .form { display:flex; gap:.5rem; flex-wrap:wrap; align-items:end; margin:.5rem 0 1rem; }
    .form ion-input, .form ion-select, .filters ion-input, .filters ion-select {
      --background:var(--surface-2,#f7f4ec); border:1px solid var(--line,#e7e2d6);
      border-radius:8px; min-width:8rem;
    }
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

  private columns: DataTableColumn[] = [
    { key: 'start_datetime', header: 'Hora', format: (r) => fmtTime(r.start_datetime as string) },
    { key: 'appointment_number', header: 'Nº' },
    { key: 'customer_name', header: 'Cliente' },
    { key: 'service_name', header: 'Servicio' },
    { key: 'staff_name', header: 'Personal', format: (r) => (r.staff_name as string) || '—' },
    {
      key: 'status',
      header: 'Estado',
      format: (r) => STATUS_LABELS[r.status as string] ?? (r.status as string),
    },
  ];

  private rowActions = [
    { id: 'confirm', label: 'Confirmar', icon: 'checkmark-circle-outline', color: 'success' },
    { id: 'start', label: 'Iniciar', icon: 'play-circle-outline', color: 'primary' },
    { id: 'complete', label: 'Completar', icon: 'checkmark-done-outline', color: 'success' },
    { id: 'cancel', label: 'Cancelar', icon: 'close-circle-outline', color: 'danger' },
    { id: 'delete', label: 'Borrar', icon: 'trash-outline', color: 'danger' },
  ];

  // TODO-LIT: componentWillLoad → connectedCallback. Recuerda: connectedCallback se dispara
  // en CADA reconexión al DOM (no solo en el primer montaje). Si la init debe correr una
  // sola vez tras el primer render, considera firstUpdated() en su lugar.
  async connectedCallback() {
    super.connectedCallback();
    await this.refresh();
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
      this.error = e instanceof Error ? e.message : 'Error cargando citas';
    } finally {
      this.loading = false;
    }
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
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'No se pudo crear la cita';
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
      this.error = e instanceof Error ? e.message : 'No se pudo ejecutar la acción';
    }
  }

  render() {
    return html`<div>
        <header>
          <h2>Citas</h2>
        </header>
        <div class="filters">
          <ion-input type="date" .value=${this.day} @ionInput=${(e: any) => {
              this.day = e.target.value;
              this.refresh();
            }}></ion-input>
          <ion-select placeholder="Todos los estados" .value=${this.statusFilter} @ionChange=${(e: any) => {
              this.statusFilter = e.target.value;
              this.refresh();
            }}>
            <ion-select-option value="">Todos</ion-select-option>
            ${Object.entries(STATUS_LABELS).map(([k, v]) => html`<ion-select-option .value=${k}>${v}</ion-select-option>`)}
          </ion-select>
        </div>
        <form class="form" @submit=${(e) => this.createAppointment(e)}>
          <ion-input placeholder="Cliente" .value=${this.newCustomer} @ionInput=${(e: any) => (this.newCustomer = e.target.value)}></ion-input>
          <ion-input placeholder="Teléfono" .value=${this.newPhone} @ionInput=${(e: any) => (this.newPhone = e.target.value)}></ion-input>
          <ion-input placeholder="Servicio" .value=${this.newService} @ionInput=${(e: any) => (this.newService = e.target.value)}></ion-input>
          <ion-input type="datetime-local" .value=${this.newStart} @ionInput=${(e: any) => (this.newStart = e.target.value)}></ion-input>
          <ion-input type="number" min="1" placeholder="Min." .value=${this.newDuration} @ionInput=${(e: any) => (this.newDuration = e.target.value)}></ion-input>
          <ion-button type="submit" size="small" ?disabled=${this.saving || !this.newCustomer || !this.newStart}>${this.saving ? 'Guardando…' : 'Añadir cita'}</ion-button>
        </form>
        ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
        <ok-data-table .columns=${this.columns} .rows=${this.items as unknown as Record<string, unknown>[]} .searchKeys=${['appointment_number', 'customer_name', 'service_name', 'staff_name']} .searchPlaceholder=${"Buscar nº, cliente o servicio…"} .actions=${this.rowActions} @rowAction=${(e: CustomEvent) => this.onRowAction(e)} .emptyMessage=${this.loading ? 'Cargando…' : 'Sin citas para este día.'}></ok-data-table>
      </div>`;
  }
}

define('erp-appointments-list', ErpAppointmentsList);
