import { LitElement, html, css, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { define } from '@erplora/outfitkit/define';
// i18n (ADR-0055): catálogo `ui` inlineado por esbuild; los textos internos se resuelven
// con `erplora.t(CATALOG, 'ui.clave')` (idioma activo, fallback locale→en→clave).
import esLocale from '../../../locales/es.json';
import enLocale from '../../../locales/en.json';
const CATALOG: Record<string, unknown> = { es: esLocale, en: enLocale };

interface ErploraClientLike {
  query<T = unknown>(name: string, params?: Record<string, unknown>): Promise<T>;
  command<T = unknown>(name: string, payload?: Record<string, unknown>): Promise<T>;
  /** i18n del módulo (ADR-0055): idioma activo + traducción del catálogo `ui`. */
  locale: string;
  t(catalog: Record<string, unknown>, key: string, params?: Record<string, unknown>): string;
}

interface Settings {
  default_duration: number;
  min_booking_notice: number;
  max_advance_booking: number;
  allow_overlapping: number;
  calendar_start_hour: number;
  calendar_end_hour: number;
  slot_interval: number;
}

// Espeja los DEFAULT de la migración (001_init.sql) para un alta mínima sin fila previa.
const DEFAULTS: Settings = {
  default_duration: 60,
  min_booking_notice: 60,
  max_advance_booking: 90,
  allow_overlapping: 0,
  calendar_start_hour: 8,
  calendar_end_hour: 20,
  slot_interval: 15,
};

function erplora(): ErploraClientLike {
  const c = (globalThis as { erplora?: ErploraClientLike }).erplora;
  if (!c) throw new Error('erplora SDK no inicializado por el shell');
  return c;
}

export class ErpAppointmentsSettings extends LitElement {
  static styles = css`
    :host { display:block; font-family: system-ui, sans-serif; color: var(--ion-text-color, #1c1b18); }
    header { display:flex; gap:.5rem; align-items:center; margin-bottom:.75rem; }
    h2 { margin:0; font-size:1.15rem; flex:1; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(14rem,1fr)); gap:.75rem; margin-bottom:1rem; }
    .field { display:flex; flex-direction:column; gap:.25rem; }
    label { font-size:.85rem; color: var(--ion-color-medium,#6b6557); }
    .toggle-row { display:flex; align-items:center; gap:.75rem; margin:.75rem 0 1rem; }
    .toggle-row .hint { font-size:.8rem; color: var(--ion-color-medium,#6b6557); }
    .err { color:#d9480f; font-weight:600; }
    .ok { color:#2b8a3e; font-weight:600; }
    .actions { display:flex; gap:.5rem; margin-top:.5rem; }
  `;

  @state() s: Settings = { ...DEFAULTS };

  @state() loading = true;

  @state() saving = false;

  @state() error = '';

  @state() saved = false;

  private readonly onLocaleChange = (): void => this.requestUpdate();

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener('erplora:locale-changed', this.onLocaleChange);
    await this.refresh();
  }

  disconnectedCallback() {
    window.removeEventListener('erplora:locale-changed', this.onLocaleChange);
    super.disconnectedCallback();
  }

  private async refresh() {
    this.loading = true;
    this.error = '';
    try {
      const rows = await erplora().query<Settings[]>('appointments.settings.get');
      const row = Array.isArray(rows) ? rows[0] : (rows as unknown as Settings | undefined);
      this.s = row ? { ...DEFAULTS, ...row } : { ...DEFAULTS };
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errLoadSettings');
    } finally {
      this.loading = false;
    }
  }

  private set<K extends keyof Settings>(key: K, value: Settings[K]) {
    this.s = { ...this.s, [key]: value };
    this.saved = false;
  }

  private async save(ev: Event) {
    ev.preventDefault();
    this.saving = true;
    this.error = '';
    this.saved = false;
    try {
      await erplora().command('appointments.settings.upsert', {
        default_duration: Number(this.s.default_duration) || 60,
        min_booking_notice: Number(this.s.min_booking_notice) || 0,
        max_advance_booking: Number(this.s.max_advance_booking) || 1,
        allow_overlapping: !!this.s.allow_overlapping,
        calendar_start_hour: Number(this.s.calendar_start_hour) || 0,
        calendar_end_hour: Number(this.s.calendar_end_hour) || 24,
        slot_interval: Number(this.s.slot_interval) || 15,
      });
      this.saved = true;
      await this.refresh();
    } catch (e) {
      this.error = e instanceof Error ? e.message : erplora().t(CATALOG, 'ui.errSaveSettings');
    } finally {
      this.saving = false;
    }
  }

  render() {
    const t = (k: string): string => erplora().t(CATALOG, k);
    return html`<form @submit=${(e: Event) => this.save(e)}>
        <header>
          <h2>${t('ui.settingsTitle')}</h2>
        </header>
        ${this.error ? html`<p class="err">${this.error}</p>` : nothing}
        ${this.saved ? html`<p class="ok">${t('ui.settingsSaved')}</p>` : nothing}
        <div class="toggle-row">
          <ion-toggle ?checked=${!!this.s.allow_overlapping} @ionChange=${(e: any) => this.set('allow_overlapping', e.target.checked ? 1 : 0)}></ion-toggle>
          <div>
            <label>${t('ui.labelAllowOverlapping')}</label>
            <div class="hint">${t('ui.hintAllowOverlapping')}</div>
          </div>
        </div>
        <div class="grid">
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelDefaultDuration')} type="number" min="1" max="480" .value=${String(this.s.default_duration)} @ionInput=${(e: any) => this.set('default_duration', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelMinNotice')} type="number" min="0" max="10080" .value=${String(this.s.min_booking_notice)} @ionInput=${(e: any) => this.set('min_booking_notice', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelMaxAdvance')} type="number" min="1" max="730" .value=${String(this.s.max_advance_booking)} @ionInput=${(e: any) => this.set('max_advance_booking', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelCalendarStart')} type="number" min="0" max="23" .value=${String(this.s.calendar_start_hour)} @ionInput=${(e: any) => this.set('calendar_start_hour', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelCalendarEnd')} type="number" min="1" max="24" .value=${String(this.s.calendar_end_hour)} @ionInput=${(e: any) => this.set('calendar_end_hour', Number(e.target.value))}></ion-input>
          </div>
          <div class="field">
            <ion-input fill="outline" label-placement="floating" label=${t('ui.labelSlotInterval')} type="number" min="5" max="120" .value=${String(this.s.slot_interval)} @ionInput=${(e: any) => this.set('slot_interval', Number(e.target.value))}></ion-input>
          </div>
        </div>
        <div class="actions">
          <ion-button type="submit" ?disabled=${this.saving || this.loading}>${this.saving ? t('ui.saving') : t('ui.buttonSave')}</ion-button>
        </div>
      </form>`;
  }
}

define('erp-appointments-settings', ErpAppointmentsSettings);
