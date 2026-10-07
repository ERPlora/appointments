import { LitElement, html, css, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
import '@erplora/outfitkit/ok-inline-feedback';
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';

const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

/** One page per keystroke: enough to pick from, small enough to ask on every key. */
export const CUSTOMER_PAGE = 20;

/** The customer a booking links to (from `customers.list`); its contact is copied into the booking. */
export interface PickedCustomer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
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

/**
 * appointments#306 — the customer field of the create panel and of the new-series panel.
 *
 * It searches the SERVER on every keystroke through the public `customers.list` (the list engine's
 * `search` matches name, phone and email, ignoring case and accents) and paints exactly what the
 * server answers: a browser-side filter on top would hide «José» from someone typing «jose», which
 * the server just found. The previous field loaded the first 500 customers by name into an
 * `ion-select`, so a salon with more could not book the rest, and a failed load looked like an
 * empty book.
 *
 * Controlled by the host: `customer` is the chosen one; picking emits `customer-change` with the
 * whole customer (the booking copies her contact). `value` mirrors her id for the QA hooks.
 */
export class ErpAppointmentsCustomerPicker extends LitElement {
  static styles = css`
    :host { display: block; position: relative; }
    .results {
      margin-top: .25rem;
      border: 1px solid var(--ion-color-step-200, #d9d7cf);
      border-radius: var(--ok-radius-sm, 10px);
      background: var(--ion-background-color, #fff);
      max-height: 16rem;
      overflow-y: auto;
    }
    ion-list { background: transparent; padding: 0; }
    ion-item { --background: transparent; --min-height: 2.75rem; }
    ion-label p { color: var(--ion-color-medium, #8b897f); }
    .note { color: var(--ion-color-medium, #8b897f); font-size: .875rem; padding: .6rem .9rem; margin: 0; }
    .error { display: flex; flex-wrap: wrap; align-items: center; gap: .25rem .5rem; margin-top: .35rem; }
    .error ok-inline-feedback { flex: 1 1 12rem; min-width: 0; }
  `;

  /** The field's label (the host's «Customer»). */
  @property() label = '';

  /** The chosen customer, or none yet. */
  @property({ attribute: false }) customer: PickedCustomer | null = null;

  @state() private query = '';
  @state() private open = false;
  @state() private results: PickedCustomer[] = [];
  @state() private searching = false;
  @state() private error = '';

  /** Ticket of the latest search: a slow answer to an older keystroke never paints over a newer one. */
  private seq = 0;
  private loadedOnce = false;

  /** The chosen customer's id — what the QA reads off the field, like it read the old `ion-select`. */
  get value(): string {
    return this.customer?.id ?? '';
  }

  private readonly onDocClick = (e: Event) => {
    if (this.open && !e.composedPath().includes(this)) this.open = false;
  };

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('click', this.onDocClick);
    // First page up front: the list is there the moment the field is opened.
    if (!this.loadedOnce) {
      this.loadedOnce = true;
      void this.search('');
    }
  }

  disconnectedCallback(): void {
    document.removeEventListener('click', this.onDocClick);
    super.disconnectedCallback();
  }

  private async search(query: string): Promise<void> {
    const ticket = ++this.seq;
    this.searching = true;
    const term = query.trim();
    try {
      const params: Record<string, unknown> = { limit: CUSTOMER_PAGE, sort: 'name', dir: 'asc' };
      if (term) params.search = term;
      const found = rows<PickedCustomer>(await erplora().query('customers.list', params));
      if (ticket !== this.seq) return;
      this.results = found;
      this.error = '';
    } catch (e) {
      if (ticket !== this.seq) return;
      // Said, never swallowed: an empty list would read as «this customer does not exist» and send
      // the receptionist off to create a duplicate. The last good results stay on screen.
      const message = e instanceof Error ? e.message : '';
      this.error = message || erplora().t(CATALOG, 'ui.errLoadCustomers');
    } finally {
      if (ticket === this.seq) this.searching = false;
    }
  }

  private onInput(value: string): void {
    this.query = value;
    this.open = true;
    void this.search(value);
  }

  private onFocus(): void {
    if (this.open) return;
    this.open = true;
    this.query = '';
    void this.search('');
  }

  private choose(c: PickedCustomer): void {
    this.customer = c;
    this.open = false;
    this.query = '';
    this.dispatchEvent(new CustomEvent('customer-change', { detail: { customer: c }, bubbles: true, composed: true }));
  }

  private onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.open) {
      e.stopPropagation();
      this.open = false;
    } else if (e.key === 'Enter' && this.open) {
      // Enter picks the first result instead of submitting the booking half-filled.
      e.preventDefault();
      const first = this.results[0];
      if (first) this.choose(first);
    }
  }

  private renderResults(t: (k: string) => string) {
    if (!this.open) return nothing;
    const empty = !this.searching && !this.error && this.results.length === 0;
    // A failure with nothing to list is said by the error alone: an empty bordered box under it
    // reads as a broken field.
    if (this.error && this.results.length === 0) return nothing;
    return html`<div class="results" role="listbox">
      <ion-list lines="none">
        ${this.results.map(
          (c) => html`<ion-item button detail="false" role="option" data-testid=${`appointments-customer-picker-option-${c.id}`}
            aria-selected=${this.customer?.id === c.id ? 'true' : 'false'} @click=${() => this.choose(c)}>
            <ion-label>
              <h3>${c.name}</h3>
              ${c.phone || c.email ? html`<p>${c.phone || c.email}</p>` : nothing}
            </ion-label>
          </ion-item>`,
        )}
      </ion-list>
      ${this.searching && this.results.length === 0
        ? html`<p class="note" data-testid="appointments-customer-picker-searching">${t('ui.customerSearching')}</p>`
        : nothing}
      ${empty
        ? html`<p class="note" data-testid="appointments-customer-picker-empty">${this.query.trim() ? t('ui.customerNoMatch') : t('ui.customerNone')}</p>`
        : nothing}
      ${this.results.length >= CUSTOMER_PAGE
        ? html`<p class="note" data-testid="appointments-customer-picker-more">${t('ui.customerMore')}</p>`
        : nothing}
    </div>`;
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    const shown = this.open ? this.query : (this.customer?.name ?? '');
    return html`
      <ion-input data-testid="appointments-customer-picker-input" fill="outline" mode="md" label-placement="floating"
        type="search" autocomplete="off" label=${this.label} placeholder=${t('ui.customerSearchPlaceholder')}
        .value=${shown}
        @ionFocus=${() => this.onFocus()}
        @ionInput=${(e: CustomEvent<{ value?: string | null }>) => this.onInput(String(e.detail?.value ?? (e.target as HTMLInputElement).value ?? ''))}
        @keydown=${(e: KeyboardEvent) => this.onKeydown(e)}></ion-input>
      ${this.error
        ? html`<div class="error">
            <ok-inline-feedback data-testid="appointments-customer-picker-error" tone="danger" icon="alert-circle-outline">${this.error}</ok-inline-feedback>
            <ion-button data-testid="appointments-customer-picker-retry" size="small" fill="clear" @click=${() => void this.search(this.query)}>${t('ui.customerRetry')}</ion-button>
          </div>`
        : nothing}
      ${this.renderResults(t)}
    `;
  }
}

define('erp-appointments-customer-picker', ErpAppointmentsCustomerPicker);
