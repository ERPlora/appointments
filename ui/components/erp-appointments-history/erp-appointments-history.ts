import { LitElement, html, css, nothing, type PropertyValues } from 'lit';
import { property, state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
// The change log IS a timeline: OutfitKit already draws one (reused, not reinvented).
import '@erplora/outfitkit/ok-timeline';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
import { businessTimezone } from '../../lib/business-time';

const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

// erp-appointments-history — appointments#194: the CHANGE HISTORY of ONE appointment, on its
// sheet in the agenda. «When a customer says "I didn't move anything" or "I didn't cancel", the
// front desk has nowhere to look.» The module already writes every transition
// (`appointments_history`, one line per change) and, since appointments#145, the reschedule and
// the cancel say who asked for it (`channel`: the front desk or the customer) — this component is
// the missing screen for that trail, the same block Fresha, Booksy, Square Appointments and
// Mindbody show inside the appointment's detail panel.
//
// The read already exists: `appointments.appointments.history`. What this screen must not do is
// paint `description` — it is fixed English text written by the SQL handler for developers, never
// for the front desk. The action and the channel are painted BY KEY instead, translated here.
//
// WHO did it is resolved against `hub.users.list` — the core's reserved namespace (ADR-0192), the
// same door `kitchen` and `sales` use to turn an id into a name. A change the customer asked for
// through a channel never names the bot user that channel runs as: it says "requested by the
// customer" instead, because that IS the truth of who acted.
//
// The when is read on the BUSINESS clock (appointments#12, `businessTimezone()`), never the
// device's: a stylist opening this sheet on her own phone must read the same hour as the tablet at
// the front desk.
interface HistoryRow {
  id: string;
  appointment_id: string;
  action: string;
  description: string;
  performed_by: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

interface HubUser {
  id: string;
  name: string;
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

/** Every action the label knows by name, so the source itself proves coverage
 *  (see the test `covers every action the module writes`, which greps for `<action>:`). An action
 *  this screen does not know yet — a future transition, or one the module has not shipped — falls
 *  through to a neutral label instead of a raw code no one booked to read. */
const ACTION_LABEL_KEYS: Record<string, string> = {
  created: 'ui.historyActionCreated',
  confirmed: 'ui.historyActionConfirmed',
  started: 'ui.historyActionStarted',
  completed: 'ui.historyActionCompleted',
  cancelled: 'ui.historyActionCancelled',
  no_show: 'ui.historyActionNoShow',
  rescheduled: 'ui.historyActionRescheduled',
};

/** The dot each action paints: a closed appointment (done, cancelled or missed) reads as
 *  finished — this is a LOG, not an upcoming plan, so every line is `status: 'done'`. */
function actionVisual(action: string): { icon: string; color?: string } {
  switch (action) {
    case 'cancelled':
    case 'no_show':
      return { icon: 'close-outline', color: 'danger' };
    case 'completed':
      return { icon: 'checkmark-done-outline' };
    case 'rescheduled':
      return { icon: 'calendar-outline' };
    case 'confirmed':
      return { icon: 'checkmark-circle-outline' };
    case 'started':
      return { icon: 'play-outline' };
    case 'created':
      return { icon: 'add-circle-outline' };
    default:
      return { icon: 'ellipse-outline' };
  }
}

/** `new_value` is stored as a JSON string built by hand in SQL (`_history_*.sql`, no JSON
 *  builtins in the portable dialect subset). A row nobody wrote through this module — a manual
 *  insert, an older format — must not break the line: unreadable JSON reads as "no extra facts",
 *  never as a crash. */
function parseNewValue(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function formatWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    // appointments#12: the BUSINESS clock, never the device's — see `business-time.ts`.
    return new Intl.DateTimeFormat(locale || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: businessTimezone(),
    }).format(d);
  } catch {
    return iso;
  }
}

export class ErpAppointmentsHistory extends LitElement {
  static styles = css`
    :host { display: block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    h3 { font-size: 0.95rem; font-weight: 600; margin: 0 0 .5rem; display: flex; align-items: center; gap: .4rem; }
    .empty { color: var(--ion-color-medium, #8b897f); margin: .25rem 0 0; font-size: .9rem; }
    .loading { color: var(--ion-color-medium, #8b897f); font-size: .9rem; }
  `;

  @property({ attribute: 'appointment-id' }) appointmentId = '';
  /** A host panel whose header already says «Appointment history» drops this title (one name). */
  @property({ type: Boolean, attribute: 'hide-title' }) hideTitle = false;

  @state() private entries: HistoryRow[] = [];
  @state() private usersById = new Map<string, string>();
  @state() private loading = false;
  @state() private error = '';

  /** Sequence guard: a slow answer for the previous appointment must never paint over the new
   *  one — the sheet in the agenda can switch appointments faster than a request round-trips. */
  private seq = 0;
  /** The appointment this component already reacted to, so a re-render that leaves
   *  `appointmentId` untouched (e.g. `entries`/`loading` changing) never re-triggers a load. */
  private lastAppointmentId: string | undefined;

  // `willUpdate`, not `updated`: the state it resets lands in THIS render, without a second cycle.
  protected willUpdate(_changed: PropertyValues<this>): void {
    if (this.appointmentId === this.lastAppointmentId) return;
    this.lastAppointmentId = this.appointmentId;
    if (!this.appointmentId) {
      // Invalidate any request still in flight for the appointment we just left.
      this.seq += 1;
      this.entries = [];
      this.loading = false;
      this.error = '';
      return;
    }
    // Another appointment: the previous one's lines must not stay on screen while this one loads.
    this.entries = [];
    void this.load(this.appointmentId);
  }

  private async load(appointmentId: string): Promise<void> {
    const mySeq = (this.seq += 1);
    this.loading = true;
    this.error = '';
    // hub.users.list may fail on its own (no permission, no SDK) without breaking the history:
    // the trail keeps painting, just without names — same policy `kitchen`/`sales` follow.
    const usersPromise = erplora()
      .query<HubUser[]>('hub.users.list')
      .catch(() => [] as HubUser[]);
    try {
      const [historyResult, users] = await Promise.all([
        erplora().query('appointments.appointments.history', { appointment_id: appointmentId }),
        usersPromise,
      ]);
      if (mySeq !== this.seq) return;
      this.entries = rows<HistoryRow>(historyResult);
      this.usersById = new Map(
        users
          .filter((u) => u && u.id && String(u.name ?? '').trim())
          .map((u): [string, string] => [String(u.id), String(u.name).trim()]),
      );
    } catch {
      if (mySeq !== this.seq) return;
      this.entries = [];
      this.error = erplora().t(CATALOG, 'ui.appointmentHistoryError');
    } finally {
      if (mySeq === this.seq) this.loading = false;
    }
  }

  private items(): TimelineItem[] {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const locale = erplora().locale;
    return this.entries.map((row) => {
      const value = parseNewValue(row.new_value);
      const channel = typeof value.channel === 'string' ? value.channel : '';
      const parts: string[] = [];
      if (channel === 'customer') parts.push(t('ui.historyByCustomer'));
      else if (channel === 'staff') parts.push(t('ui.historyByFrontDesk'));
      if (row.action === 'rescheduled' && typeof value.start_datetime === 'string') {
        parts.push(`${t('ui.historyNewTime')}: ${formatWhen(value.start_datetime, locale)}`);
      }
      if (row.action === 'cancelled') {
        const reason = typeof value.reason === 'string' ? value.reason.trim() : '';
        if (reason) parts.push(`${t('ui.historyReason')}: ${reason}`);
      }
      // The channel runs the change AS the bot user: naming it would blame the bot for what the
      // customer asked, so a customer-led line never shows an actor at all.
      const actor = channel === 'customer' || !row.performed_by ? '' : this.usersById.get(row.performed_by) ?? '';
      const when = formatWhen(row.created_at, locale);
      const visual = actionVisual(row.action);
      return {
        id: row.id,
        title: t(ACTION_LABEL_KEYS[row.action] ?? 'ui.historyActionOther'),
        description: parts.length ? parts.join(' · ') : undefined,
        time: actor ? `${when} · ${actor}` : when,
        status: 'done',
        color: visual.color,
        icon: visual.icon,
      };
    });
  }

  render() {
    if (!this.appointmentId) return nothing;
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`
      ${this.hideTitle ? nothing : html`<h3>${t('ui.appointmentHistoryTitle')}</h3>`}
      ${this.error
        ? html`<ok-inline-feedback data-testid="appointments-history-error" tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>`
        : nothing}
      ${this.loading && !this.entries.length
        ? html`<p class="loading" data-testid="appointments-history-loading">${t('ui.loading')}</p>`
        : nothing}
      ${!this.loading && !this.error && !this.entries.length
        ? html`<p class="empty" data-testid="appointments-history-empty">${t('ui.appointmentHistoryEmpty')}</p>`
        : nothing}
      ${this.entries.length ? html`<ok-timeline .items=${this.items()}></ok-timeline>` : nothing}
    `;
  }
}

define('erp-appointments-history', ErpAppointmentsHistory);

declare global {
  interface HTMLElementTagNameMap {
    'erp-appointments-history': ErpAppointmentsHistory;
  }
}
