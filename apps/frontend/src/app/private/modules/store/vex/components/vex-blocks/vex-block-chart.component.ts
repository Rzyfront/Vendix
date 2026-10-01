import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { EChartsOption } from 'echarts';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import {
  VexBlockInteraction,
  VexBlockTabularData,
  VexChartSpec,
  VexUiBlock,
} from '../../models/vex.models';

/**
 * SSR/no-DOM fallback. Mirrors the `:root` defaults in `styles.scss`
 * (`--color-primary`, `--color-accent`, `--color-success`, `--color-info`,
 * `--color-warning`, `--color-error`, `--color-secondary`, `--color-gaming`)
 * as `rgb()` strings — echarts accepts any CSS color, and hex literals stay
 * out of Vex components per the no-fixed-colors rule.
 */
const FALLBACK_PALETTE = [
  'rgb(46, 204, 113)',
  'rgb(161, 244, 217)',
  'rgb(34, 197, 94)',
  'rgb(59, 130, 246)',
  'rgb(251, 146, 60)',
  'rgb(239, 68, 68)',
  'rgb(22, 43, 33)',
  'rgb(139, 92, 246)',
];

/**
 * Renders a `chart` block through the shared echarts wrapper.
 *
 * The spec stays small on purpose (chart type + key mapping); this component
 * owns the `EChartsOption` assembly so the model never writes echarts JSON by
 * hand. A click on a point emits a `chart_click` interaction for the next turn.
 */
@Component({
  selector: 'vendix-vex-block-chart',
  standalone: true,
  imports: [ChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure
      class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden m-0"
    >
      @if (spec().title) {
        <figcaption class="px-4 pt-3 text-sm font-semibold text-[var(--color-text-primary)]">
          {{ spec().title }}
        </figcaption>
      }
      @if (has_rows()) {
        <app-chart
          [options]="options()"
          [showLegend]="true"
          [showTooltip]="true"
          (chartClick)="onChartClick($event)"
        ></app-chart>
      } @else {
        <p class="px-4 py-6 text-sm text-center text-[var(--color-text-secondary)]">
          Sin datos para graficar
        </p>
      }
    </figure>
  `,
})
export class VexBlockChartComponent {
  readonly block = input.required<VexUiBlock>();
  readonly interaction = output<VexBlockInteraction>();

  readonly spec = computed(() => this.block().spec as VexChartSpec);

  private readonly rows = computed(() => {
    const data = this.block().data as Partial<VexBlockTabularData>;
    return Array.isArray(data.rows) ? data.rows : [];
  });

  readonly has_rows = computed(() => this.rows().length > 0);

  readonly options = computed<EChartsOption>(() =>
    buildOption(this.spec(), this.rows(), readPalette()),
  );

  onChartClick(event: unknown): void {
    const point = toPoint(event);
    this.interaction.emit({ type: 'chart_click', point });
  }
}

function readPalette(): string[] {
  try {
    if (typeof document === 'undefined') return FALLBACK_PALETTE;
    const style = getComputedStyle(document.documentElement);
    const pick = (name: string, fallback: string): string => {
      const value = style.getPropertyValue(name).trim();
      return value || fallback;
    };
    return [
      pick('--color-primary', FALLBACK_PALETTE[0]),
      pick('--color-accent', FALLBACK_PALETTE[1]),
      pick('--color-success', FALLBACK_PALETTE[2]),
      pick('--color-info', FALLBACK_PALETTE[3]),
      pick('--color-warning', FALLBACK_PALETTE[4]),
      pick('--color-error', FALLBACK_PALETTE[5]),
      pick('--color-secondary', FALLBACK_PALETTE[6]),
      pick('--color-gaming', FALLBACK_PALETTE[7]),
    ];
  } catch {
    return FALLBACK_PALETTE;
  }
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}

function buildOption(
  spec: VexChartSpec,
  rows: Array<Record<string, unknown>>,
  palette: string[],
): EChartsOption {
  const series_defs =
    spec.series?.length
      ? spec.series
      : inferSeries(rows, spec.x_axis_key);
  switch (spec.chart_type) {
    case 'pie':
    case 'doughnut': {
      const value_key = series_defs[0]?.key;
      const label_key = spec.x_axis_key ?? firstTextKey(rows, value_key);
      return {
        color: palette,
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [
          {
            type: 'pie',
            radius: spec.chart_type === 'doughnut' ? ['45%', '70%'] : '65%',
            data: rows.map((row) => ({
              name: String(row[label_key] ?? ''),
              value: readNumber(value_key ? row[value_key] : undefined),
            })),
          },
        ],
      };
    }
    case 'gauge': {
      const value_key = series_defs[0]?.key;
      const value = rows.length
        ? readNumber(value_key ? rows[0][value_key] : undefined)
        : 0;
      return {
        color: palette,
        series: [{ type: 'gauge', data: [{ value }] }],
      };
    }
    case 'scatter': {
      const [x_def, y_def] = series_defs;
      return {
        color: palette,
        tooltip: { trigger: 'item' },
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: [
          {
            type: 'scatter',
            symbolSize: 12,
            data: rows.map((row) => [
              readNumber(x_def ? row[x_def.key] : undefined),
              readNumber(y_def ? row[y_def.key] : undefined),
            ]),
          },
        ],
      };
    }
    case 'radar': {
      const label_key = spec.x_axis_key ?? firstTextKey(rows, series_defs[0]?.key);
      const indicators = rows.map((row) => ({ name: String(row[label_key] ?? '') }));
      return {
        color: palette,
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        radar: { indicator: indicators },
        series: [
          {
            type: 'radar',
            data: series_defs.map((def) => ({
              name: def.label ?? def.key,
              value: rows.map((row) => readNumber(row[def.key])),
            })),
          },
        ],
      };
    }
    default: {
      // bar | line | area
      const label_key = spec.x_axis_key ?? firstTextKey(rows, series_defs[0]?.key);
      const echarts_type = spec.chart_type === 'area' ? 'line' : spec.chart_type;
      return {
        color: palette,
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0 },
        grid: { left: 8, right: 12, top: 24, bottom: 56, containLabel: true },
        xAxis: {
          type: 'category',
          data: rows.map((row) => String(row[label_key] ?? '')),
        },
        yAxis: { type: 'value' },
        series: series_defs.map((def) => ({
          name: def.label ?? def.key,
          type: echarts_type,
          stack: spec.stacked ? 'vex' : undefined,
          areaStyle: spec.chart_type === 'area' ? {} : undefined,
          data: rows.map((row) => readNumber(row[def.key])),
        })),
      };
    }
  }
}

function inferSeries(
  rows: Array<Record<string, unknown>>,
  x_key?: string,
): Array<{ key: string; label?: string }> {
  if (!rows.length) return [];
  return Object.keys(rows[0])
    .filter((key) => key !== x_key && typeof rows[0][key] === 'number')
    .map((key) => ({ key }));
}

function firstTextKey(
  rows: Array<Record<string, unknown>>,
  exclude?: string,
): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]).filter((key) => key !== exclude);
  return (
    keys.find((key) => typeof rows[0][key] === 'string') ?? keys[0] ?? ''
  );
}

function toPoint(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== 'object') return {};
  const params = event as {
    name?: unknown;
    seriesName?: unknown;
    value?: unknown;
    data?: unknown;
  };
  return {
    ...(params.name !== undefined ? { name: params.name } : {}),
    ...(params.seriesName !== undefined ? { series: params.seriesName } : {}),
    ...(params.value !== undefined ? { value: params.value } : {}),
    ...(params.data !== undefined ? { data: params.data } : {}),
  };
}
