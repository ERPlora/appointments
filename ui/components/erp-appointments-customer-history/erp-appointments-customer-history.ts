import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
// The visit history IS a timeline: OutfitKit already draws one (reused, not reinvented).
import '@erplora/outfitkit/ok-timeline';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

// erp-appointments-customer-history — the VISIT HISTORY on the customer sheet (appointments#46,
// decided in ERPlora/pm#9). Filler of the `customers.detail` slot (ADR-0043 §3bis): the sheet of
// `customers` resolves this component by slot name, mounts it and tells it WHICH customer is open
// with a `CustomEvent` (`erp:customer-detail` {customer_id, customer_name}) on the element itself.
// `customers` never learns what an appointment is (a corner shop has customers and no agenda): if
// this module is not installed, the sheet simply has no history block.
//
// What it shows: the last N appointments of the customer (this module's PUBLIC query
// `appointments.appointments.list_for_customer`), newest first, each with service, professional,
// status and its notes. The internal note is where the salon writes the colour formula (Phorest's
// split: client notes = stable, appointment notes = per visit), so it is the first thing on the line.
//
// Reachable at the chair in two taps: open the customer, read. No buttons, no forms here.

interface Visit {
  id: string;
  appointment_number: string;
  start_datetime: string;
  end_datetime: string;
  duration_minutes: number;
  status: string;
  service_id: string | null;
  service_name: string;
  service_price: number;
  staff_id: string | null;
  staff_name: string;
  notes: string;
  internal_notes: string;
  converted_sale_id: string | null;
}

interface TimelineItem {
  id: string;
  title: string;
  description?: string;
  time?: string;
  status?: 'done' | 'current' | 'pending';
  color?: string;
  icon?: string;
}

interface ErploraLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

function erplora(): ErploraLike {
  const c = (globalThis as { erplora?: ErploraLike }).erplora;
  if (!c) throw new Error('erplora SDK not initialised by the shell');
  return c;
}

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: T[] }).rows)) return (r as { rows: T[] }).rows;
  return [];
}

/** How many visits the sheet shows: enough to find last season's formula, not the whole life. */
const LAST_N = 10;

const STATUS_KEYS: Record<string, string> = {
  pending: 'ui.statusPending',
  confirmed: 'ui.statusConfirmed',
  in_progress: 'ui.statusInProgress',
  completed: 'ui.statusCompleted',
  cancelled: 'ui.statusCancelled',
  no_show: 'ui.statusNoShow',
};

/** Timeline dot: done = the visit happened; the rest are upcoming or did not happen. */
function timelineStatus(status: string): { status: TimelineItem['status']; color?: string; icon: string } {
  switch (status) {
    case 'completed': return { status: 'done', icon: 'checkmark-outline' };
    case 'in_progress': return { status: 'current', icon: 'play-outline' };
    case 'cancelled':
    case 'no_show': return { status: 'pending', color: 'danger', icon: 'close-outline' };
    default: return { status: 'pending', icon: 'time-outline' };
  }
}

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    return iso;
  }
}

export class ErpAppointmentsCustomerHistory extends LitElement {
  static styles = css`
    :host { display: block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    h3 { font-size: 0.95rem; font-weight: 600; margin: 0 0 .5rem; display: flex; align-items: center; gap: .4rem; }
    .empty { color: var(--ion-color-medium, #8b897f); margin: .25rem 0 0; font-size: .9rem; }
    .loading { color: var(--ion-color-medium, #8b897f); font-size: .9rem; }
  `;

  @state() private customerId = '';
  @state() private visits: Visit[] = [];
  @state() private loading = false;
  @state() private error = '';
  /** Sequence guard: a slow answer for the previous customer must never paint over the new one. */
  private seq = 0;

  private readonly onCustomerDetail = (ev: Event) => {
    const detail = (ev as CustomEvent<{ customer_id?: string }>).detail;
    const id = String(detail?.customer_id ?? '');
    if (!id) return;
    void this.load(id);
  };

  connectedCallback(): void {
    super.connectedCallback();
    // Host → filler contract (ADR-0043): the event is dispatched ON this element, it does not bubble.
    this.addEventListener('erp:customer-detail', this.onCustomerDetail);
  }

  disconnectedCallback(): void {
    this.removeEventListener('erp:customer-detail', this.onCustomerDetail);
    super.disconnectedCallback();
  }

  private async load(customerId: string): Promise<void> {
    const mySeq = ++this.seq;
    this.customerId = customerId;
    this.loading = true;
    this.error = '';
    try {
      const result = await erplora().query('appointments.appointments.list_for_customer', {
        customer_id: customerId,
        limit: LAST_N,
      });
      if (mySeq !== this.seq) return;
      this.visits = rows<Visit>(result);
    } catch {
      if (mySeq !== this.seq) return;
      this.visits = [];
      this.error = erplora().t(CATALOG, 'ui.historyError');
    } finally {
      if (mySeq === this.seq) this.loading = false;
    }
  }

  private items(): TimelineItem[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const locale = erplora().locale;
    return this.visits.map((v) => {
      const dot = timelineStatus(v.status);
      const who = [v.service_name, v.staff_name].filter(Boolean).join(' · ');
      const statusLabel = t(STATUS_KEYS[v.status] ?? v.status);
      // The formula (internal note) first: it is what the stylist came to read.
      const description = [v.internal_notes, v.notes].map((s) => (s ?? '').trim()).filter(Boolean).join(' — ');
      return {
        id: v.id,
        title: `${who} · ${statusLabel}`,
        time: `${formatWhen(v.start_datetime, locale)} · ${v.appointment_number}`,
        description: description || undefined,
        status: dot.status,
        color: dot.color,
        icon: dot.icon,
      };
    });
  }

  render() {
    if (!this.customerId) return nothing;
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`
      <h3>${t('ui.historyTitle')}</h3>
      ${this.error ? html`<ok-inline-feedback tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>` : nothing}
      ${this.loading && !this.visits.length ? html`<p class="loading">${t('ui.loading')}</p>` : nothing}
      ${!this.loading && !this.error && !this.visits.length ? html`<p class="empty">${t('ui.historyEmpty')}</p>` : nothing}
      ${this.visits.length ? html`<ok-timeline .items=${this.items()}></ok-timeline>` : nothing}
    `;
  }
}

define('erp-appointments-customer-history', ErpAppointmentsCustomerHistory);

declare global {
  interface HTMLElementTagNameMap {
    'erp-appointments-customer-history': ErpAppointmentsCustomerHistory;
  }
}
