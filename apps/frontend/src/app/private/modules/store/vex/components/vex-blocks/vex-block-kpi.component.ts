import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { VexKpiSpec, VexUiBlock } from '../../models/vex.models';

/**
 * Renders a `kpi` block: one headline number plus an optional delta.
 *
 * Money goes through the store's `CurrencyFormatService` — the same
 * configuration the rest of the panel uses — never through a hardcoded `$`.
 */
@Component({
  selector: 'vendix-vex-block-kpi',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 flex items-center gap-3"
      [attr.aria-label]="spec().label"
    >
      @if (spec().icon) {
        <span
          class="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-[rgba(var(--color-primary-rgb,46,204,113),0.12)] text-[var(--color-primary)]"
          aria-hidden="true"
        >
          <app-icon [name]="spec().icon ?? 'info'" [size]="22"></app-icon>
        </span>
      }
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide text-[var(--color-text-secondary)] truncate">
          {{ spec().label }}
        </p>
        <p class="text-2xl font-semibold text-[var(--color-text-primary)] leading-tight">
          {{ formatted_value() }}
        </p>
        @if (delta_text()) {
          <p class="text-xs mt-0.5" [class]="delta_class()">
            {{ delta_text() }}
            @if (spec().delta_label) {
              <span class="text-[var(--color-text-secondary)]">· {{ spec().delta_label }}</span>
            }
          </p>
        }
      </div>
    </section>
  `,
})
export class VexBlockKpiComponent {
  private readonly currencyFormat = inject(CurrencyFormatService);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  readonly block = input.required<VexUiBlock>();

  readonly spec = computed(() => this.block().spec as VexKpiSpec);

  /**
   * Number locale from the STORE, never a hardcoded `es-CO`: once the
   * currency resolves, grouping follows the store's `format_style` (same
   * mapping `CurrencyFormatService` uses); before that, `general.language`.
   */
  private readonly number_locale = computed(() =>
    storeNumberLocale(
      this.settingsFacade.settings()?.general?.language,
      this.currencyFormat.currencyFormatStyle(),
      this.currencyFormat.resolution() === 'resolved',
    ),
  );

  private readonly raw_value = computed<unknown>(() => {
    const key = this.spec().value_key ?? 'value';
    return this.block().data[key];
  });

  private readonly raw_delta = computed<unknown>(() => {
    const key = this.spec().delta_key;
    if (!key) return undefined;
    return this.block().data[key];
  });

  readonly formatted_value = computed(() =>
    this.format(this.spec().format ?? 'number', this.raw_value()),
  );

  readonly delta_text = computed(() => {
    const delta = this.raw_delta();
    if (delta === null || delta === undefined || delta === '') return '';
    const numeric = toNumber(delta);
    if (numeric === null) return String(delta);
    const sign = numeric > 0 ? '+' : '';
    if (this.spec().format === 'percent') {
      return `${sign}${numeric.toLocaleString(this.number_locale(), { maximumFractionDigits: 2 })} pts`;
    }
    return `${sign}${this.format(this.spec().format ?? 'number', numeric)}`;
  });

  readonly delta_class = computed(() => {
    const numeric = toNumber(this.raw_delta());
    if (numeric === null || numeric === 0) return 'text-[var(--color-text-secondary)]';
    const positive = numeric > 0 !== (this.spec().invert_delta ?? false);
    return positive ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]';
  });

  constructor() {
    void this.currencyFormat.loadCurrency();
  }

  private format(format: string, value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    const numeric = toNumber(value);
    if (numeric === null) return String(value);
    switch (format) {
      case 'currency':
        return this.currencyFormat.format(numeric);
      case 'percent':
        return `${numeric.toLocaleString(this.number_locale(), { maximumFractionDigits: 2 })}%`;
      default:
        return numeric.toLocaleString(this.number_locale(), { maximumFractionDigits: 2 });
    }
  }
}

/**
 * Store-driven `Intl` locale for plain numbers. Mirrors the service-private
 * `getLocaleForStyle` mapping so grouping matches the store's money; the
 * language fallback keeps pre-resolution renders stable (`es-CO` groups like
 * `de-DE`, so the default COP tenant sees no flip when it resolves).
 */
function storeNumberLocale(
  language: string | undefined,
  format_style: string,
  resolved: boolean,
): string {
  if (resolved) {
    switch (format_style) {
      case 'dot_comma':
        return 'de-DE';
      case 'space_comma':
        return 'fr-FR';
      default:
        return 'en-US';
    }
  }
  return language === 'en' ? 'en-US' : 'es-CO';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}
