import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

// erp-appointments-request-booking — the panel that turns a request somebody wrote in a chat into
// a booking against THIS hub's records (appointments#38). Filler of the
// `whatsapp_inbox.request.booking` slot (ADR-0043 §3bis).
//
// WHY IT LIVES HERE. The inbox has the message; it does not have the diary. Picking a service, a
// professional and a time that is genuinely free is this module's job, and `whatsapp_inbox` must
// never learn it — a shop that sells by WhatsApp and keeps no agenda has to keep working. So the
// host resolves this component by slot name, tells it WHICH request is open with a `CustomEvent`,
// and gets back the request bound to real ids. Neither module imports the other.
//
// WHY IT EXISTS AT ALL. What the model stored is free text: a service NAME, «tomorrow at ten», a
// first name. `appointments.appointments.create` resolves customer/service/professional against
// the hub's records and fails closed (appointments#11/#10), so approving free text can only ever
// be refused. The binding IS the feature.
//
// THE SHAPE IS THE MARKET'S, not ours. Square Messages composes the appointment in the normal
// sheet (`+ → Appointment`, «Add customer» → search or create); Zenoti's Requests tab offers
// Confirm / Modify / Decline and refuses to confirm until a therapist is chosen; Vagaro, Birdeye
// and Acuity all park the request until a person commits it. The two products that book from free
// text with nobody watching (Podium, Booksy via Google) replaced the human with LIVE availability
// — never with confidence in the parse. Hence the two rules this panel obeys:
//
//   1. it never decides who the customer is. Auto-creating one per phone number is how Vagaro
//      ended up shipping a duplicate-merge engine with match scores, and how salons collect fake
//      bookings from unverified numbers. Creating a record is an explicit act, prefilled;
//   2. the time comes from `appointments.availability.slots`, so only slots that are free RIGHT
//      NOW can be picked. The message is hours old; the diary is not.
//
// Touch first: one column, 44px targets, no typing beyond the customer search.

interface ErploraLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  hasPermission?(permission: string): boolean;
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

/** What the host tells us when it mounts the panel: which request is open, and what it says. */
interface OpenRequest {
  request_id: string;
  request_type: string;
  customer_id: string;
  contact_name: string;
  contact_phone: string;
  raw_summary: string;
}

interface Customer { id: string; name: string; phone?: string }
interface Service { id: string; name: string; duration_minutes?: number; is_bookable?: number }
interface StaffMember { id: string; full_name: string; status?: string; is_bookable?: number }
interface Slot { slot_start: string; start_time: string; end_time: string }

function erplora(): ErploraLike {
  const c = (globalThis as { erplora?: ErploraLike }).erplora;
  if (!c) throw new Error('erplora SDK not initialised by the shell');
  return c;
}

function can(permission: string): boolean {
  const client = erplora();
  return typeof client.hasPermission === 'function' ? client.hasPermission(permission) : true;
}

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: T[] }).rows)) return (r as { rows: T[] }).rows;
  return [];
}

/** Today as `YYYY-MM-DD`, the shape `appointments.availability.slots` binds. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class ErpAppointmentsRequestBooking extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    .panel { display:flex; flex-direction:column; gap:.6rem; padding:.6rem 0; }
    label { display:block; font-size:.8rem; font-weight:600; margin-bottom:.2rem; }
    select, input { width:100%; min-height:44px; box-sizing:border-box; padding:.4rem .5rem;
      border:1px solid var(--ion-color-step-200, #d8d5d0); border-radius:.4rem;
      background: var(--ion-background-color, #fff); color: inherit; font: inherit; }
    .actions { display:flex; gap:.4rem; align-items:center; flex-wrap:wrap; }
    .slots { display:flex; flex-wrap:wrap; gap:.35rem; }
    .slot { min-height:44px; min-width:72px; padding:0 .7rem; border-radius:.4rem; cursor:pointer;
      border:1px solid var(--ion-color-step-200, #d8d5d0); background: var(--ion-background-color, #fff);
      color: inherit; font: inherit; }
    .slot[aria-pressed='true'] { border-color: var(--ion-color-primary, #3880ff); font-weight:700; }
    .matches { display:flex; flex-direction:column; gap:.25rem; margin-top:.3rem; }
    .match { text-align:left; min-height:44px; padding:.3rem .5rem; border-radius:.4rem; cursor:pointer;
      border:1px solid var(--ion-color-step-150, #e5e3df); background:none; color:inherit; font:inherit; }
    .match[aria-pressed='true'] { border-color: var(--ion-color-primary, #3880ff); font-weight:700; }
    .said { margin:0; color: var(--ion-color-step-600, #5b5852); font-style: italic; }
    .go { margin-top:.2rem; }
    ion-button { --min-height: 44px; }
  `;

  @state() private open: OpenRequest | null = null;

  @state() private services: Service[] = [];

  @state() private staffMembers: StaffMember[] = [];

  @state() private matches: Customer[] = [];

  @state() private search = '';

  @state() private customerId = '';

  @state() private customerLabel = '';

  @state() private serviceId = '';

  @state() private staffId = '';

  @state() private date = today();

  @state() private slots: Slot[] = [];

  @state() private startDatetime = '';

  @state() private busy = false;

  @state() private error = '';

  private catalogsLoaded = false;

  private readonly onLocaleChange = (): void => this.requestUpdate();

  /** The host tells us which request is open. Same contract as `customers.detail`: an event on
   *  the element, never a prop and never a call — and it is re-announced on every host re-render,
   *  so opening the SAME request again must not wipe what the operator has already picked. */
  private readonly onOpen = (ev: Event): void => {
    const detail = (ev as CustomEvent<Partial<OpenRequest>>).detail ?? {};
    const request: OpenRequest = {
      request_id: String(detail.request_id ?? ''),
      request_type: String(detail.request_type ?? ''),
      customer_id: String(detail.customer_id ?? ''),
      contact_name: String(detail.contact_name ?? ''),
      contact_phone: String(detail.contact_phone ?? ''),
      raw_summary: String(detail.raw_summary ?? ''),
    };
    if (this.open?.request_id === request.request_id) return;
    this.open = request;
    this.error = '';
    this.startDatetime = '';
    this.slots = [];
    this.customerId = request.customer_id;
    this.customerLabel = request.customer_id ? request.contact_name : '';
    // The phone is the strongest hint the chat gives: the same person wrote from the same number.
    // The NAME is only a fallback — two «Marta» are two Martas until somebody says otherwise.
    this.search = request.contact_phone || request.contact_name;
    void this.loadCatalogs();
    if (!this.customerId) void this.searchCustomers();
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    this.addEventListener('erp:whatsapp-request', this.onOpen);
  }

  disconnectedCallback(): void {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    this.removeEventListener('erp:whatsapp-request', this.onOpen);
    super.disconnectedCallback();
  }

  /** The catalogues, through their PUBLIC queries — never another module's tables. */
  private async loadCatalogs(): Promise<void> {
    if (this.catalogsLoaded) return;
    this.catalogsLoaded = true;
    try {
      const [services, staffMembers] = await Promise.all([
        erplora().query('services.services.list', { limit: 500 }).catch(() => []),
        erplora().query('staff.members.list', { limit: 500 }).catch(() => []),
      ]);
      // A service that is not bookable (an internal one) cannot receive an appointment, and a
      // professional who is off the rota cannot take one: neither may be offered here.
      this.services = rows<Service>(services).filter(
        (s) => s.is_bookable === undefined || Number(s.is_bookable) === 1,
      );
      this.staffMembers = rows<StaffMember>(staffMembers).filter(
        (s) => (s.status ?? 'active') === 'active' && (s.is_bookable === undefined || Number(s.is_bookable) === 1),
      );
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errLoadCatalogs');
    }
  }

  private async searchCustomers(): Promise<void> {
    const term = this.search.trim();
    if (!term) { this.matches = []; return; }
    try {
      const result = await erplora().query('customers.list', { search: term, limit: 8 });
      this.matches = rows<Customer>(result);
    } catch {
      this.matches = [];
    }
  }

  /** Creating the customer is an EXPLICIT act, prefilled — never a side effect of approving. */
  private async createCustomer(): Promise<void> {
    if (!this.open || !can('customers.add_customer')) return;
    this.busy = true;
    this.error = '';
    try {
      const name = this.open.contact_name || this.open.contact_phone;
      await erplora().command('customers.create', { name, phone: this.open.contact_phone });
      this.search = this.open.contact_phone || name;
      await this.searchCustomers();
      const created = this.matches.find((c) => c.name === name);
      if (created) this.pickCustomer(created);
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errCreateCustomer');
    } finally {
      this.busy = false;
    }
  }

  private pickCustomer(c: Customer): void {
    this.customerId = c.id;
    this.customerLabel = c.name;
  }

  /** Free slots RIGHT NOW, from the hub's own availability engine. The market's hard rule: what a
   *  person can pick has to be free at the moment they pick it, not when the message arrived. */
  private async loadSlots(): Promise<void> {
    this.startDatetime = '';
    if (!this.date) { this.slots = []; return; }
    const service = this.services.find((s) => s.id === this.serviceId);
    try {
      const result = await erplora().query('appointments.availability.slots', {
        date: this.date,
        staff_id: this.staffId,
        duration_minutes: service?.duration_minutes,
      });
      this.slots = rows<Slot>(result);
    } catch (e) {
      this.slots = [];
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errLoadSlots');
    }
  }

  private get ready(): boolean {
    return Boolean(this.customerId && this.serviceId && this.staffId && this.startDatetime);
  }

  /** Hands the BOUND request back to the host. Approving is the inbox's command, not ours: this
   *  module does not know how a request is approved, only what a booking needs. And it does NOT
   *  book here either — the appointment is created by the listener on the approval event, so the
   *  booking happens exactly once no matter which door the approval came through. */
  private confirm(): void {
    if (!this.open || !this.ready) return;
    const service = this.services.find((s) => s.id === this.serviceId);
    this.dispatchEvent(new CustomEvent('erp:booking-resolved', {
      detail: {
        request_id: this.open.request_id,
        customer_id: this.customerId,
        service_id: this.serviceId,
        staff_id: this.staffId,
        start_datetime: this.startDatetime,
        duration_minutes: service?.duration_minutes,
        notes: this.open.raw_summary,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('erp:booking-cancelled', { bubbles: true, composed: true }));
  }

  private renderCustomer() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    if (this.customerId) {
      return html`<div>
        <label>${t('ui.bookingCustomer')}</label>
        <div class="actions">
          <strong>${this.customerLabel || this.customerId}</strong>
          <ion-button size="small" fill="clear"
            @click=${() => { this.customerId = ''; this.customerLabel = ''; void this.searchCustomers(); }}>
            ${t('ui.bookingChange')}
          </ion-button>
        </div>
      </div>`;
    }
    return html`<div>
      <label for="cust">${t('ui.bookingCustomer')}</label>
      <input id="cust" .value=${this.search} placeholder=${t('ui.bookingCustomerSearch')}
        @input=${(e: Event) => { this.search = (e.target as HTMLInputElement).value; void this.searchCustomers(); }} />
      <div class="matches">
        ${this.matches.map((c) => html`<button type="button" class="match"
          aria-pressed=${this.customerId === c.id ? 'true' : 'false'}
          @click=${() => this.pickCustomer(c)}>${c.name}${c.phone ? html` · ${c.phone}` : nothing}</button>`)}
      </div>
      ${can('customers.add_customer') ? html`<ion-button size="small" fill="outline" ?disabled=${this.busy}
        @click=${() => this.createCustomer()}>${t('ui.bookingCreateCustomer')}</ion-button>` : nothing}
    </div>`;
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    if (!this.open) return nothing;
    return html`<div class="panel">
      ${this.open.raw_summary ? html`<p class="said">“${this.open.raw_summary}”</p>` : nothing}
      ${this.error ? html`<ok-inline-feedback tone="danger">${this.error}</ok-inline-feedback>` : nothing}

      ${this.renderCustomer()}

      <div>
        <label for="svc">${t('ui.bookingService')}</label>
        <select id="svc"
          @change=${(e: Event) => { this.serviceId = (e.target as HTMLSelectElement).value; void this.loadSlots(); }}>
          <option value="">${t('ui.bookingPick')}</option>
          ${this.services.map((s) => html`<option value=${s.id} ?selected=${s.id === this.serviceId}>${s.name}</option>`)}
        </select>
      </div>

      <div>
        <label for="stf">${t('ui.bookingStaff')}</label>
        <select id="stf"
          @change=${(e: Event) => { this.staffId = (e.target as HTMLSelectElement).value; void this.loadSlots(); }}>
          <option value="">${t('ui.bookingPick')}</option>
          ${this.staffMembers.map((s) => html`<option value=${s.id} ?selected=${s.id === this.staffId}>${s.full_name}</option>`)}
        </select>
      </div>

      <div>
        <label for="day">${t('ui.bookingDay')}</label>
        <input id="day" type="date" .value=${this.date}
          @change=${(e: Event) => { this.date = (e.target as HTMLInputElement).value; void this.loadSlots(); }} />
      </div>

      <div>
        <label>${t('ui.bookingSlot')}</label>
        ${this.slots.length === 0
          ? html`<p class="said">${t('ui.bookingNoSlots')}</p>`
          : html`<div class="slots">
              ${this.slots.map((s) => html`<button type="button" class="slot"
                aria-pressed=${this.startDatetime === s.slot_start ? 'true' : 'false'}
                @click=${() => { this.startDatetime = s.slot_start; }}>${s.start_time}</button>`)}
            </div>`}
      </div>

      <div class="actions go">
        <ion-button ?disabled=${!this.ready || this.busy} @click=${() => this.confirm()}>
          ${t('ui.bookingConfirm')}
        </ion-button>
        <ion-button fill="clear" color="medium" @click=${() => this.cancel()}>${t('ui.bookingCancel')}</ion-button>
      </div>
    </div>`;
  }
}

define('erp-appointments-request-booking', ErpAppointmentsRequestBooking);
