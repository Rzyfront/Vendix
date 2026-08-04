import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { VexiProposal } from '../../../core/store/vexi/vexi.actions';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { CurrencyFormatService } from '../../pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../utils/date.util';
import { IconComponent } from '../icon/icon.component';

/**
 * Fields whose value is money. Checked *after* the percentage test so that
 * `discount_percentage` and `tax_rate` are not printed with a currency symbol
 * just because they contain "discount" or "rate".
 */
const MONEY_FIELD =
  /(price|cost|amount|total|subtotal|discount|fee|margin|salary|balance|paid|payable|revenue|profit|precio|costo|monto|valor|saldo)/i;

const PERCENT_FIELD = /(percent|percentage|_rate$|^rate$|porcentaje|tasa)/i;

const DATE_FIELD = /(_at$|_date$|^date|fecha|expires|expiry|vence|deadline)/i;

/**
 * Counts, never money. Checked before `MONEY_FIELD` because `total_items` and
 * `total_units` would otherwise be printed with a currency symbol on the
 * strength of the word "total".
 */
const COUNT_FIELD =
  /(count|_qty$|^qty$|quantity|items|units|stock|cantidad|unidades|existencias)/i;

/** `2026-08-02` — a date-only value, which must be read in UTC, never local. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

interface DiffRow {
  key: string;
  label: string;
  from: string;
  to: string;
  changed: boolean;
}

@Component({
  selector: 'app-vexi-confirmation-card',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="vexi-card"
      [class.vexi-card--warning]="status() === 'warning'"
      [class.vexi-card--error]="status() === 'error'"
      role="group"
      aria-label="Cambio propuesto por Vexi"
    >
      <header class="vexi-card__header">
        <span class="vexi-card__badge" aria-hidden="true">
          @switch (status()) {
            @case ('error') {
              <app-icon name="x-circle" [size]="15" />
            }
            @case ('warning') {
              <app-icon name="alert-triangle" [size]="15" />
            }
            @default {
              <app-icon name="pencil" [size]="15" />
            }
          }
        </span>
        <span class="vexi-card__heading">
          <strong class="vexi-card__title">Vexi propone un cambio</strong>
          <span class="vexi-card__target">{{ target() }}</span>
        </span>
      </header>

      @if (message()) {
        <p class="vexi-card__message">{{ message() }}</p>
      }

      @if (rows().length) {
        <dl class="vexi-card__diff">
          @for (row of rows(); track row.key) {
            <div class="vexi-row" [class.vexi-row--same]="!row.changed">
              <dt class="vexi-row__label">{{ row.label }}</dt>
              <dd class="vexi-row__values">
                <span class="vexi-row__from">{{ row.from }}</span>
                <span class="vexi-row__arrow" aria-hidden="true">
                  <app-icon name="arrow-right" [size]="12" />
                </span>
                <span class="vexi-row__to">{{ row.to }}</span>
              </dd>
            </div>
          }
        </dl>
      } @else {
        <p class="vexi-card__message">
          Vexi no pudo detallar el cambio campo a campo. Revisa la conversación
          antes de aprobar.
        </p>
      }

      <!-- Two explicit actions of the same size and the same adjacency: there
           is no default, no timeout and no "approve on inactivity". Neither
           button is autofocused, so an Enter pressed out of habit in the
           composer can never approve a write. -->
      <footer class="vexi-card__actions">
        <button
          type="button"
          class="vexi-card__btn vexi-card__btn--reject"
          (click)="reject.emit()"
          [disabled]="applying()"
        >
          <app-icon name="x" [size]="15" />
          Rechazar
        </button>
        <button
          type="button"
          class="vexi-card__btn vexi-card__btn--approve"
          (click)="approve.emit()"
          [disabled]="applying() || status() === 'error'"
        >
          @if (applying()) {
            <app-icon name="loader-2" [size]="15" [spin]="true" />
            Aplicando…
          } @else {
            <app-icon name="check" [size]="15" />
            Aprobar
          }
        </button>
      </footer>

      @if (status() === 'error') {
        <p class="vexi-card__blocked">
          Este cambio no se puede aplicar tal como está. Pídele a Vexi que lo
          corrija.
        </p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .vexi-card {
        display: flex;
        flex-direction: column;
        gap: 9px;
        padding: 11px;
        border: 1px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.4);
        border-radius: 14px;
        background: var(--color-surface, #fff);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.07);
      }

      .vexi-card--warning {
        border-color: var(--color-warning, #fb923c);
      }

      .vexi-card--error {
        border-color: var(--color-error, #ef4444);
      }

      .vexi-card__header {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .vexi-card__badge {
        display: grid;
        place-items: center;
        width: 26px;
        height: 26px;
        flex-shrink: 0;
        border-radius: 8px;
        background: rgba(var(--color-primary-rgb, 46, 204, 113), 0.14);
        color: var(--color-primary, #2ecc71);
      }

      .vexi-card--warning .vexi-card__badge {
        background: var(--color-warning-light, rgba(251, 146, 60, 0.12));
        color: var(--color-warning, #fb923c);
      }

      .vexi-card--error .vexi-card__badge {
        background: var(--color-error-light, rgba(239, 68, 68, 0.12));
        color: var(--color-error, #ef4444);
      }

      .vexi-card__heading {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .vexi-card__title {
        font-size: 0.82rem;
        font-weight: 600;
      }

      .vexi-card__target {
        font-size: 0.78rem;
        color: var(--color-text-secondary, inherit);
        opacity: 0.85;
        overflow-wrap: anywhere;
      }

      .vexi-card__message {
        margin: 0;
        font-size: 0.76rem;
        line-height: 1.4;
        color: var(--color-text-secondary, inherit);
      }

      .vexi-card__diff {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        padding: 8px;
        border-radius: 10px;
        background: var(--color-surface-secondary, rgba(0, 0, 0, 0.035));
      }

      .vexi-row {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }

      .vexi-row--same {
        opacity: 0.55;
      }

      .vexi-row__label {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--color-text-muted, inherit);
        opacity: 0.8;
      }

      .vexi-row__values {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0;
        font-size: 0.8rem;
        flex-wrap: wrap;
      }

      .vexi-row__from {
        text-decoration: line-through;
        opacity: 0.6;
        overflow-wrap: anywhere;
      }

      .vexi-row__arrow {
        display: inline-grid;
        place-items: center;
        flex-shrink: 0;
        opacity: 0.5;
      }

      .vexi-row__to {
        font-weight: 600;
        color: var(--color-primary, #2ecc71);
        overflow-wrap: anywhere;
      }

      /* Equal weight is literal: same flex basis, same height, same type
         scale. Only the semantics differ. */
      .vexi-card__actions {
        display: flex;
        gap: 8px;
      }

      .vexi-card__btn {
        display: flex;
        flex: 1 1 0;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 40px;
        padding: 0 10px;
        border-radius: 10px;
        font-family: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .vexi-card__btn:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 46, 204, 113), 0.8);
        outline-offset: 2px;
      }

      .vexi-card__btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .vexi-card__btn--reject {
        border: 1px solid var(--color-error, #ef4444);
        background: transparent;
        color: var(--color-error, #ef4444);
      }

      .vexi-card__btn--reject:hover:not(:disabled) {
        background: var(--color-error-light, rgba(239, 68, 68, 0.1));
      }

      .vexi-card__btn--approve {
        border: 1px solid var(--color-primary, #2ecc71);
        background: var(--color-primary, #2ecc71);
        color: #fff;
      }

      .vexi-card__btn--approve:hover:not(:disabled) {
        filter: brightness(0.94);
      }

      .vexi-card__blocked {
        margin: 0;
        font-size: 0.72rem;
        color: var(--color-error, #ef4444);
      }
    `,
  ],
})
export class VexiConfirmationCardComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly auth = inject(AuthFacade);

  readonly proposal = input.required<VexiProposal>();
  readonly approve = output<void>();
  readonly reject = output<void>();

  constructor() {
    // The impure `CurrencyPipe` normally triggers this on construction. This
    // card formats inside `computed()` instead — the pipe is not reactive to
    // signals — so it has to prime the service itself, or the first render
    // falls back to a bare "$".
    void this.currencyFormat.loadCurrency();
  }

  protected readonly applying = computed(() => this.proposal().applying);
  protected readonly status = computed(
    () => this.proposal().preview?.status ?? 'ok',
  );
  protected readonly message = computed(
    () => this.proposal().preview?.message ?? '',
  );

  protected readonly target = computed(() => {
    const preview = this.proposal().preview;
    if (preview?.target) return preview.target;
    // No preview: name the tool rather than leaving the card anonymous.
    return this.proposal().tool.replace(/_/g, ' ');
  });

  /**
   * The store's IANA timezone, the same value the backend uses to decide what
   * "today" means. A timestamp rendered in the browser's zone would show a
   * different day to an owner travelling, for a change they are approving
   * against their own books.
   */
  protected readonly timezone = computed(() => {
    const settings = this.auth.storeSettings() as {
      general?: { timezone?: string };
    } | null;
    return settings?.general?.timezone || 'America/Bogota';
  });

  protected readonly rows = computed<DiffRow[]>(() => {
    const changes = this.proposal().preview?.changes ?? [];
    return changes.map((change, index) => {
      const from = this.formatValue(change.field, change.from);
      const to = this.formatValue(change.field, change.to);
      return {
        // Index-prefixed: a tool that reports the same field twice (a variant
        // matrix, for instance) must not collapse the two rows into one, and a
        // duplicate `track` key is a runtime error in @for.
        key: `${index}:${change.field}`,
        label: change.label || this.humanizeField(change.field),
        from,
        to,
        changed: from !== to,
      };
    });
  });

  private humanizeField(field: string): string {
    const spaced = field.replace(/_/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /**
   * Renders a raw tool value the way the owner reads it in the rest of the
   * panel: money through the store's currency configuration, dates through the
   * store's timezone, booleans as words. Approving a diff that says
   * `1200000` instead of `$1.200.000` is approving something you skimmed.
   */
  private formatValue(field: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';

    if (Array.isArray(value)) {
      return value.length ? value.map((item) => String(item)).join(', ') : '—';
    }

    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))
          ? Number(value)
          : null;

    if (numeric !== null) {
      if (PERCENT_FIELD.test(field)) {
        return `${numeric.toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;
      }
      if (MONEY_FIELD.test(field) && !COUNT_FIELD.test(field)) {
        return this.currencyFormat.format(numeric);
      }
      return numeric.toLocaleString('es-CO', { maximumFractionDigits: 4 });
    }

    if (typeof value === 'string') {
      if (DATE_ONLY.test(value)) return formatDateOnlyUTC(value);
      if (DATE_FIELD.test(field)) {
        const parsed = new Date(value);
        if (!isNaN(parsed.getTime())) {
          return parsed.toLocaleString('es-CO', {
            timeZone: this.timezone(),
            // Without an explicit cycle the container's ICU renders midnight
            // as "24:00" of the previous day in es-CO.
            hourCycle: 'h23',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          });
        }
      }
      return value;
    }

    if (value instanceof Date) {
      return value.toLocaleString('es-CO', {
        timeZone: this.timezone(),
        hourCycle: 'h23',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
