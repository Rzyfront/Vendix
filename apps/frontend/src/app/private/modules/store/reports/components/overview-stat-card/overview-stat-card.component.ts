import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * Color-coded state of the stat card. Drives the left border, accent
 * background, and icon-wrapper color.
 */
export type OverviewStatState =
  | 'critical'
  | 'warning'
  | 'positive'
  | 'neutral';

/**
 * Optional trend direction shown as a small chip next to the title.
 */
export type OverviewStatTrend = 'up' | 'down' | 'flat';

/**
 * How the numeric `value` should be rendered:
 * - `currency` formats with Angular's built-in CurrencyPipe (COP, no decimals).
 * - `percentage` appends a `%` sign.
 * - `number` applies `es-CO` locale formatting (dot as thousand separator).
 */
export type OverviewStatFormat = 'currency' | 'percentage' | 'number';

/**
 * OverviewStatCardComponent
 * - Custom stat card for the Reports overview summary (8 cards).
 * - Replaces `<app-stats>` per the user request for a "novel" style with
 *   dynamic border colors that reflect the health of the underlying metric.
 * - Pure presentational: no fetches, no state, no NgRx. Caller passes values.
 *
 * Skills applied:
 * - `vendix-zoneless-signals` (signal inputs, OnPush, no legacy patterns)
 * - `vendix-frontend-icons` (icon name via registry key, color via class)
 * - `vendix-currency-formatting` (CurrencyPipe is the Angular built-in;
 *   the custom Vendix pipe is tenant-aware and not used here because the
 *   spec mandates COP with no decimals regardless of tenant settings).
 */
@Component({
  selector: 'app-overview-stat-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './overview-stat-card.component.html',
  styleUrls: ['./overview-stat-card.component.scss'],
})
export class OverviewStatCardComponent {
  // Built-in Angular CurrencyPipe used as a class instance so the
  // computed() can produce a formatted string without depending on
  // tenant currency resolution (the spec hardcodes COP, no decimals).
  private readonly currencyPipe = new CurrencyPipe('en-US');

  // ---------------------------------------------------------------------------
  // Signal inputs
  // ---------------------------------------------------------------------------

  readonly title = input.required<string>();
  readonly value = input<string | number>('');
  readonly icon = input<string>('info');
  readonly state = input<OverviewStatState>('neutral');
  readonly trend = input<OverviewStatTrend | undefined>(undefined);
  readonly growth = input<number | null | undefined>(undefined);
  readonly formatType = input<OverviewStatFormat>('number');
  readonly loading = input<boolean>(false);

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  /**
   * Lucide icon name matching the current trend. Falls back to a flat
   * "-" icon when trend is undefined, so the chip can render an icon
   * even without a growth percentage.
   */
  readonly trendIcon = computed<string>(() => {
    const t = this.trend();
    if (t === 'up') return 'trending-up';
    if (t === 'down') return 'trending-down';
    return 'minus';
  });

  /**
   * Formats `growth` as a signed percentage. Rounded cleanly to at most 2
   * decimal places (e.g. `+12%`, `-37.61%`).
   */
  readonly formattedGrowth = computed<string>(() => {
    const g = this.growth();
    if (g === null || g === undefined) return '';
    const num = Number(g);
    if (Number.isNaN(num)) return '';
    const sign = num > 0 ? '+' : '';
    const formatted = num % 1 === 0 ? num.toString() : num.toFixed(2);
    return `${sign}${formatted}%`;
  });

  /**
   * Formats the metric value according to `formatType()`. Empty inputs
   * (null / undefined / empty string) render as "—" so the parent grid
   * stays consistent for the "no data" state. If the parent passes a
   * non-numeric string (e.g. a pre-formatted "$1,234,567" or "15.3%"),
   * it is displayed as-is so callers can opt out of auto-formatting.
   */
  readonly formattedValue = computed<string>(() => {
    const raw = this.value();
    if (raw === '' || raw === null || raw === undefined) return '—';

    if (typeof raw === 'string') {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        // Pre-formatted string from the parent: show as-is.
        return raw;
      }
    }

    const num = typeof raw === 'string' ? Number(raw) : raw;
    const formatType = this.formatType();
    if (formatType === 'currency') {
      return this.currencyPipe.transform(num, 'COP', 'symbol-narrow', '1.0-0') ?? '';
    }
    if (formatType === 'percentage') {
      const formatted = num % 1 === 0 ? num.toString() : num.toFixed(2);
      return `${formatted}%`;
    }
    return num.toLocaleString('es-CO');
  });

  /**
   * Human-readable state label rendered in the footer dot row.
   * Localized and uppercase to match the Stitch design.
   */
  readonly stateLabel = computed<string>(() => {
    switch (this.state()) {
      case 'critical':
        return 'CRÍTICO';
      case 'warning':
        return 'ADVERTENCIA';
      case 'positive':
        return 'POSITIVO';
      default:
        return 'NEUTRAL';
    }
  });
}
