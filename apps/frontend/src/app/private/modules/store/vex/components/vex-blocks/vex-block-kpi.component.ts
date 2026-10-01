import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
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

  readonly block = input.required<VexUiBlock>();

  readonly spec = computed(() => this.block().spec as VexKpiSpec);

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
      return `${sign}${numeric.toLocaleString('es-CO', { maximumFractionDigits: 2 })} pts`;
    }
    return `${sign}${this.format(this.spec().format ?? 'number', numeric)}`;
  });

  readonly delta_class = computed(() => {
    const numeric = toNumber(this.raw_delta());
    if (numeric === null || numeric === 0) return 'text-[var(--color-text-secondary)]';
    const positive = numeric > 0 !== (this.spec().invert_delta ?? false);
    return positive ? 'text-[var(--color-success,#16a34a)]' : 'text-[var(--color-error,#dc2626)]';
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
        return `${numeric.toLocaleString('es-CO', { maximumFractionDigits: 2 })}%`;
      default:
        return numeric.toLocaleString('es-CO', { maximumFractionDigits: 2 });
    }
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}
