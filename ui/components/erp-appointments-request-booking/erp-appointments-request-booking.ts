import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
import { todayISO } from '../../lib/business-time';

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
interface Slot { slot_start: string; slot_end: string; start_time: string; end_time: string }

/** One stretch the business is open on a date, in minutes from THAT date's own midnight — the unit
 *  `appointments.availability.day_opening` answers in, breaks already carved out. */
interface OpenSpan { start_minute: number; end_minute: number }

function erplora(): ErploraLike {
  const c = (globalThis as { erplora?: ErploraLike }).erplora;
  if (!c) throw new Error('erplora SDK not initialised by the shell');
  return c;
}

function can(permission: string): boolean {
  const client = erplora();
  return typeof client.hasPermission === 'function' ? client.hasPermission(permission) : true;
}

/** `HH:MM` — the shape `availability.slots` returns — as minutes from midnight. `null` when it
 *  cannot be read: a time we are unable to place must not quietly count as 00:00. Slot candidates
 *  are always generated INSIDE the requested date (`availability_slots.sql` walks the hub's
 *  calendar hours), so there is no day to cross and this number is directly comparable. */
function minuteOfDay(hhmm: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof hhmm === 'string' ? hhmm : '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Does the WHOLE slot fit inside one open stretch? Straddling an edge is out, and that is the
 *  door's own rule, not a stricter one invented here: `create` needs the appointment to end before
 *  closing time, so half a slot is no slot. */
function insideOpening(slot: Slot, spans: OpenSpan[]): boolean {
  const start = minuteOfDay(slot.start_time);
  const end = minuteOfDay(slot.end_time);
  if (start === null || end === null) return false;
  return spans.some((s) => Number(s.start_minute) <= start && end <= Number(s.end_minute));
}

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: T[] }).rows)) return (r as { rows: T[] }).rows;
  return [];
}

/** Today as `YYYY-MM-DD`, the shape `appointments.availability.slots` binds.
 *  pm#93: the LOCAL day, not the UTC one — at 00:30 in Madrid the UTC day is still yesterday's. */
const today = todayISO;

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
    .hold { margin:.1rem 0 .3rem; font-size:.8rem; font-weight:600;
      color: var(--ion-color-primary, #3880ff); }
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

  /** The AUTHORITY says the business is shut on `this.date`. Not the same statement as «no free
   *  time»: a diary that filled up is fixed by another professional, a Sunday is not, and telling
   *  somebody to keep hunting on a closed day wastes their afternoon. */
  @state() private dayClosed = false;

  /** The opening hours could not be read at all, so the list below may be offering hours the door
   *  will turn down. Said out loud: a screen that goes back to being optimistic in silence is the
   *  exact defect appointments#105 is about. */
  @state() private openingUnknown = false;

  @state() private startDatetime = '';

  @state() private busy = false;

  @state() private error = '';

  /** appointments#69 — when the slot this panel set aside stops being ours (epoch ms), or 0 when
   *  nothing is held. Display only: the authority is `appointments_slot_hold.expires_at`, written
   *  server-side. It is shown because a hold nobody can see is indistinguishable from a bug — the
   *  complaint Square's own support article has to answer about its 15-minute hold. Timify shows
   *  the countdown to the customer AND to the desk for the same reason. */
  @state() private holdUntil = 0;

  @state() private holdLeft = 0;

  /** True once a hold lapsed with the panel still open, so the screen can say so instead of
   *  quietly dropping the chosen time. */
  @state() private holdExpired = false;

  /** How long a hold lasts here, from the hub's settings (`hold_minutes`, 15 by default, 0 = off). */
  private holdMinutes = 15;

  private holdTicker: ReturnType<typeof setInterval> | null = null;

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
    this.holdUntil = 0;
    this.holdExpired = false;
    this.stopHoldClock();
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
    this.stopHoldClock();
    super.disconnectedCallback();
  }

  /** The catalogues, through their PUBLIC queries — never another module's tables. */
  private async loadCatalogs(): Promise<void> {
    if (this.catalogsLoaded) return;
    this.catalogsLoaded = true;
    try {
      const [services, staffMembers, settings] = await Promise.all([
        erplora().query('services.services.list', { limit: 500 }).catch(() => []),
        erplora().query('staff.members.list', { limit: 500 }).catch(() => []),
        erplora().query('appointments.settings.get').catch(() => []),
      ]);
      // A hub that never opened the Settings tab has no row: the DB default (15) stands, which is
      // the same number the SQL falls back to. Reading it here is only so the countdown on screen
      // matches the clock the server is actually running.
      const cfg = rows<{ hold_minutes?: number }>(settings)[0];
      if (cfg && cfg.hold_minutes !== undefined && cfg.hold_minutes !== null) {
        this.holdMinutes = Number(cfg.hold_minutes) || 0;
      }
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

  /**
   * The stretches the business is open on `this.date`, asked of THE DOOR ITSELF (appointments#105).
   *
   * Since appointments#102 the authority over the business's hours is `schedules`, and the gate
   * (`appointments.appointments.create`) resolves the date through its precedence (ADR-0392).
   * `availability_slots.sql` cannot follow: a module's query may only name that module's tables,
   * so `schedules_*` is closed to it by contract. For the hub that has already moved its hours the
   * list was therefore OPTIMISTIC — it offered 10:00 to a salon that opens at 11:00 and `create`
   * refused it one click later with `appointments.outside_schedule`.
   *
   * This does NOT re-implement that precedence in TypeScript. A second authority is the disease,
   * not the cure: it asks `appointments.availability.day_opening`, which runs the very function
   * the gate runs, and filters by what comes back. Read-only, so it writes nothing.
   *
   * Returns the spans to filter by, or `null` for «do not filter»:
   *   * `[]` — the authority resolved the date and the business is SHUT. Zero slots, on purpose;
   *   * `null` — either the authority carries no rule reaching the date (`source: "own"`, and the
   *     SQL has already applied the module's own timetable, so filtering again would erase the
   *     whole day for a hub that has not migrated), or it could not be asked at all.
   */
  private async askDayOpening(): Promise<OpenSpan[] | null> {
    this.openingUnknown = false;
    // A role that cannot read the schedule books exactly as it did before. Asking first is not
    // security — the runtime re-checks — it just keeps a legitimate role from generating a refusal.
    if (!can('appointments.view_schedule')) return null;
    try {
      const answer = await erplora().command<{ source?: string; spans?: OpenSpan[] } | null>(
        'appointments.availability.day_opening',
        { date: this.date },
      );
      if (!answer || answer.source !== 'schedules') return null;
      return Array.isArray(answer.spans) ? answer.spans : [];
    } catch (e) {
      // `permission_denied` is a ROLE, not a fault (an API key, a custom role): degrade quietly.
      // Anything else IS a fault, and the operator has to know the list stopped being checked —
      // booking still works, so this warns and never blocks.
      if ((e as { code?: string } | null)?.code !== 'permission_denied') this.openingUnknown = true;
      return null;
    }
  }

  /** Free slots RIGHT NOW, from the hub's own availability engine, narrowed to what the door will
   *  actually accept. The market's hard rule: what a person can pick has to be free at the moment
   *  they pick it, not when the message arrived — and it has to be bookable, not just free. */
  private async loadSlots(): Promise<void> {
    this.startDatetime = '';
    if (!this.date) { this.slots = []; this.dayClosed = false; this.openingUnknown = false; return; }
    const service = this.services.find((s) => s.id === this.serviceId);
    // The door answers FIRST: what it says decides both what to ask the engine and what to keep.
    const opening = await this.askDayOpening();
    this.dayClosed = opening !== null && opening.length === 0;
    try {
      const result = await erplora().query('appointments.availability.slots', {
        date: this.date,
        staff_id: this.staffId,
        duration_minutes: service?.duration_minutes,
        // appointments#69: every hold hides its slot from this list — ours would hide the very
        // time we just took, which is the one moment a hold must NOT block anyone. Same role as
        // `exclude_appointment_id` when moving an appointment off its own slot.
        exclude_hold_ref: this.open?.request_id,
        // Sent ONLY when the authority answered, and it means «I already have the hours, stop
        // filtering by the module's own timetable». Sending it with nothing to filter by would
        // hand back the whole calendar; leaving it out keeps the query exactly as it was.
        ...(opening !== null ? { schedules_answers: 1 } : {}),
      });
      const free = rows<Slot>(result);
      this.slots = opening !== null ? free.filter((s) => insideOpening(s, opening)) : free;
    } catch (e) {
      this.slots = [];
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errLoadSlots');
    }
  }

  /** Picking a time SETS IT ASIDE (appointments#69).
   *
   *  The window that this closes is the one appointments#38 could only report after the fact:
   *  hours pass between the message and the approval, the counter sells the hour, and the booking
   *  is refused when somebody finally approves. Holding while the decision is being made is what
   *  the market does — Square holds 15 minutes while a customer completes a booking, Appointedd 7,
   *  Timify caps at 5, Phorest opens a 7-minute holding slot on the calendar while the salon rings
   *  back. Every documented number sits in the 5–15 band, because the clock only makes sense while
   *  a PERSON is waiting on screen.
   *
   *  The clock starts HERE and not when the message arrives, and that is forced, not chosen: what
   *  the model parsed is free text with no professional and no hour, so until somebody picks there
   *  is no slot to hold. The long variant of this mechanism (Odoo and Acuity park the request ON
   *  the calendar with no expiry at all) needs a request that already names a slot — and it is
   *  also the variant whose failure mode fills the forums: holds nobody reclaims, freed by hand.
   *
   *  Failing to hold does NOT block the booking. A hold is a courtesy that expires; refusing to
   *  continue because we could not take one would turn the best-effort half of the feature into a
   *  new way of not being able to book at all. */
  private async pickSlot(s: Slot): Promise<void> {
    this.startDatetime = s.slot_start;
    this.holdExpired = false;
    if (!this.open || this.holdMinutes <= 0) return;
    try {
      await erplora().command('appointments.slots.hold', {
        // Opaque both ways: we say who is asking and over which of THEIR rows. `appointments`
        // stores it without knowing what a WhatsApp request is, and a hub with no inbox never
        // learns this table exists.
        source: 'whatsapp_inbox',
        source_ref: this.open.request_id,
        staff_id: this.staffId,
        start_datetime: s.slot_start,
        end_datetime: s.slot_end,
        label: this.customerLabel || this.open.contact_name || this.open.contact_phone,
      });
      this.startHoldClock();
    } catch {
      // Best effort, and said out loud: the operator has to know the slot is still on sale.
      this.holdUntil = 0;
      this.error = erplora().t(CATALOG, 'ui.holdFailed');
    }
  }

  /** Gives the slot back. Only on an EXPLICIT walk-away: an unmount is not one (a host re-render
   *  would hand the slot back mid-decision), and the TTL already covers the operator who simply
   *  leaves — «if the user is gone, let it expire silently» is where the market lands. */
  private async releaseHold(): Promise<void> {
    this.stopHoldClock();
    if (!this.open || !this.holdUntil) return;
    this.holdUntil = 0;
    try {
      await erplora().command('appointments.slots.release_hold', {
        source: 'whatsapp_inbox',
        source_ref: this.open.request_id,
      });
    } catch {
      // It expires on its own anyway; a failed release is minutes of a slot, not a lost booking.
    }
  }

  private startHoldClock(): void {
    this.holdUntil = Date.now() + this.holdMinutes * 60_000;
    this.stopHoldClock();
    this.tickHold();
    this.holdTicker = setInterval(() => this.tickHold(), 1000);
  }

  private stopHoldClock(): void {
    if (this.holdTicker) clearInterval(this.holdTicker);
    this.holdTicker = null;
  }

  private tickHold(): void {
    const left = Math.max(0, this.holdUntil - Date.now());
    this.holdLeft = left;
    if (left > 0) return;
    // The lease lapsed with the operator still on screen — the one case the market says to speak
    // up about (Appointedd tells the customer, Cargoclix paints it red). The slot has to be picked
    // again, because between now and the approval it may already be sold.
    this.stopHoldClock();
    this.holdUntil = 0;
    this.startDatetime = '';
    this.holdExpired = true;
    void this.loadSlots();
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
    // appointments#69: no release here. The hold is CONSUMED by `_hold_consume`, in the same
    // transaction that writes the appointment. Giving it back from the browser would free the slot
    // a heartbeat before its own booking lands — and that heartbeat is the whole window this
    // feature exists to close.
    this.stopHoldClock();
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

  private async cancel(): Promise<void> {
    await this.releaseHold();
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
        ${this.holdUntil
          ? html`<p class="hold">${t('ui.holdCountdown')
              .replace('{mins}', String(Math.floor(this.holdLeft / 60000)))
              .replace('{secs}', String(Math.floor((this.holdLeft % 60000) / 1000)).padStart(2, '0'))}</p>`
          : nothing}
        ${this.holdExpired
          ? html`<ok-inline-feedback tone="warning" icon="time-outline">${t('ui.holdExpired')}</ok-inline-feedback>`
          : nothing}
        ${this.openingUnknown
          ? html`<ok-inline-feedback tone="warning" icon="alert-circle-outline">${t('ui.openingUnknown')}</ok-inline-feedback>`
          : nothing}
        ${this.slots.length === 0
          ? html`<p class="said">${t(this.dayClosed ? 'ui.bookingDayClosed' : 'ui.bookingNoSlots')}</p>`
          : html`<div class="slots">
              ${this.slots.map((s) => html`<button type="button" class="slot"
                aria-pressed=${this.startDatetime === s.slot_start ? 'true' : 'false'}
                @click=${() => { void this.pickSlot(s); }}>${s.start_time}</button>`)}
            </div>`}
      </div>

      <div class="actions go">
        <ion-button ?disabled=${!this.ready || this.busy} @click=${() => this.confirm()}>
          ${t('ui.bookingConfirm')}
        </ion-button>
        <span class="cancel"><ion-button fill="clear" color="medium"
          @click=${() => void this.cancel()}>${t('ui.bookingCancel')}</ion-button></span>
      </div>
    </div>`;
  }
}

define('erp-appointments-request-booking', ErpAppointmentsRequestBooking);
