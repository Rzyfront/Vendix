import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import { FunnelChart, HeatmapChart } from 'echarts/charts';
import { VisualMapComponent } from 'echarts/components';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import {
  VexBlockInteraction,
  VexBlockTabularData,
  VexChartSpec,
  VexUiBlock,
} from '../../models/vex.models';
import { VEX_COPY } from '../../vex-copy';
import { VexBlockExportMenuComponent } from './vex-block-export-menu.component';
import { blockToExportTable, downloadDataUrl } from './vex-block-export.util';

// `echarts.use` is global and idempotent: the shared wrapper registers the
// base charts; Vex adds the ones only its advanced chart types need.
echarts.use([FunnelChart, HeatmapChart, VisualMapComponent]);

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
  imports: [ChartComponent, VexBlockExportMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure
      class="rounded-2xl border border-border bg-surface overflow-hidden m-0"
    >
      <figcaption
        class="px-4 pt-3 flex items-center justify-between gap-2 text-sm font-semibold text-text-primary"
      >
        <span class="min-w-0 truncate">{{ spec().title || copy.label }}</span>
        <vendix-vex-block-export-menu
          [block]="block()"
          [allowImage]="true"
          (exportImage)="exportImage()"
        />
      </figcaption>
      @if (has_rows()) {
        <app-chart
          [options]="options()"
          [showLegend]="true"
          [showTooltip]="true"
          (chartClick)="onChartClick($event)"
        ></app-chart>
      } @else {
        <p class="px-4 py-6 text-sm text-center text-text-secondary">
          {{ copy.empty }}
        </p>
      }
    </figure>
  `,
})
export class VexBlockChartComponent {
  protected readonly copy = VEX_COPY.blocks.chart;
  readonly block = input.required<VexUiBlock>();
  readonly interaction = output<VexBlockInteraction>();

  readonly spec = computed(() => this.block().spec as VexChartSpec);

  private readonly rows = computed(() => {
    const data = this.block().data as Partial<VexBlockTabularData>;
    return Array.isArray(data.rows) ? data.rows : [];
  });

  readonly has_rows = computed(() => this.rows().length > 0);

  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /**
   * Palette read from the live CSS variables. `ThemeService` writes mode and
   * preset colors straight onto `<html>` (inline style + `data-theme`) and
   * exposes no signal for those axes (`currentTheme` is only set by the
   * deprecated `applyTheme`), so the DOM is the source of truth: an observer
   * on those attributes re-reads the palette, and the signal only changes
   * when the colors really did — an unrelated style write is a no-op.
   */
  private readonly palette = signal<string[]>(readPalette());

  constructor() {
    if (this.isBrowser && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        const next = readPalette();
        const previous = this.palette();
        if (next.some((color, i) => color !== previous[i])) {
          this.palette.set(next);
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'class', 'data-theme'],
      });
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
  }

  readonly options = computed<EChartsOption>(() =>
    buildOption(this.spec(), this.rows(), this.palette()),
  );

  /** PNG of what is on screen, painted over the theme surface color. */
  exportImage(): void {
    const el = this.host.nativeElement.querySelector<HTMLElement>('.echarts-chart');
    const instance = el ? echarts.getInstanceByDom(el) : undefined;
    if (!instance) return;
    const surface =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-surface')
        .trim() || FALLBACK_PALETTE[6];
    downloadDataUrl(
      instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: surface }),
      blockToExportTable(this.block())?.filename ?? 'vex-grafico',
    );
  }

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
    case 'rose': {
      const value_key = series_defs[0]?.key;
      const label_key = spec.x_axis_key ?? firstTextKey(rows, value_key);
      return {
        color: palette,
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [
          {
            type: 'pie',
            roseType: 'area',
            radius: ['15%', '65%'],
            data: rows.map((row) => ({
              name: String(row[label_key] ?? ''),
              value: readNumber(value_key ? row[value_key] : undefined),
            })),
          },
        ],
      };
    }
    case 'funnel': {
      const value_key = series_defs[0]?.key;
      const label_key = spec.x_axis_key ?? firstTextKey(rows, value_key);
      return {
        color: palette,
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [
          {
            type: 'funnel',
            sort: 'descending',
            left: '8%',
            width: '84%',
            top: 16,
            bottom: 48,
            gap: 2,
            label: { show: true, position: 'inside' },
            data: rows.map((row) => ({
              name: String(row[label_key] ?? ''),
              value: readNumber(value_key ? row[value_key] : undefined),
            })),
          },
        ],
      };
    }
    case 'heatmap': {
      // x = row labels; every series is one Y row with a value per label.
      const label_key = spec.x_axis_key ?? firstTextKey(rows, series_defs[0]?.key);
      const x_labels = rows.map((row) => String(row[label_key] ?? ''));
      const y_labels = series_defs.map((def) => def.label ?? def.key);
      const cells = series_defs.flatMap((def, y) =>
        rows.map((row, x) => [x, y, readNumber(row[def.key])]),
      );
      const values = cells.map((cell) => cell[2]);
      const show_labels = x_labels.length <= 12 && y_labels.length <= 10;
      return {
        tooltip: {
          trigger: 'item',
          formatter: (params: unknown) => {
            const value = (params as { value?: number[] }).value ?? [];
            return `${x_labels[value[0]] ?? ''} · ${y_labels[value[1]] ?? ''}: ${value[2] ?? ''}`;
          },
        },
        grid: { left: 8, right: 12, top: 16, bottom: 72, containLabel: true },
        xAxis: { type: 'category', data: x_labels, splitArea: { show: true } },
        yAxis: { type: 'category', data: y_labels, splitArea: { show: true } },
        visualMap: {
          min: values.length ? Math.min(...values) : 0,
          max: values.length ? Math.max(...values) : 1,
          calculable: true,
          orient: 'horizontal',
          left: 'center',
          bottom: 4,
          // One accent: the theme primary, from transparent-ish to solid.
          inRange: { color: [palette[0]], colorAlpha: [0.1, 1] },
        },
        series: [
          {
            type: 'heatmap',
            data: cells,
            label: { show: show_labels },
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
      // bar | line | area | stacked_bar | combo
      const label_key = spec.x_axis_key ?? firstTextKey(rows, series_defs[0]?.key);
      const is_combo = spec.chart_type === 'combo';
      const is_stacked = spec.stacked || spec.chart_type === 'stacked_bar';
      const base_type: 'bar' | 'line' =
        spec.chart_type === 'area' || spec.chart_type === 'line'
          ? 'line'
          : 'bar';
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
        series: series_defs.map((def, index) => ({
          name: def.label ?? def.key,
          type: is_combo ? (def.type ?? (index === 0 ? 'bar' : 'line')) : base_type,
          stack: is_stacked && !is_combo ? 'vex' : undefined,
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
