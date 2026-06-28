import { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, {
  Path,
  Circle,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Line,
  Rect,
  Text as SvgText,
  G,
} from 'react-native-svg';
import { colorScales, spacing, typography, colors, borderRadius } from '@/shared/theme';
import type { SalesTrend } from '@/features/store/types';

// Paleta idéntica al web (sales-trends.component.ts → updateCharts).
const COLOR_REVENUE = '#22c55e'; // green-500
const COLOR_ORDERS = '#3b82f6';  // blue-500
const COLOR_AOV = '#8b5cf6';     // purple-500
const CHART_HEIGHT_LARGE = 400;  // paridad con `.chart-container.large`
const Y_TICKS = 5;

/** Formato corto del eje Y — paridad con echarts formatter. */
function shortCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

/** Formato de período según granularidad (paridad con web `formatChartPeriod`). */
function formatPeriod(period: string, granularity: 'day' | 'week' | 'month'): string {
  if (!period) return '';
  // `period` viene como 'YYYY-MM-DD' o 'YYYY-MM'.
  if (granularity === 'month') {
    // YYYY-MM → MM/YYYY
    const [y, m] = period.split('-');
    return `${m}/${y.slice(2)}`;
  }
  if (granularity === 'week') {
    // YYYY-Www → Wxx
    return period.length >= 7 ? `W${period.slice(5)}` : period;
  }
  // day → DD/MM
  const [, m, d] = period.split('-');
  return `${d}/${m}`;
}

interface BaseProps {
  data: SalesTrend[];
  granularity: 'day' | 'week' | 'month';
}

/* ========================================================================
 * CHART 1 — Combined (Ingresos area + Órdenes line, dual Y axis)
 * ====================================================================== */
export function SalesTrendsCombinedChart({ data, granularity }: BaseProps) {
  const { width: screenWidth } = useWindowDimensions();

  const PAD_LEFT = 56;
  const PAD_RIGHT = 48;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 80;
  const W = screenWidth - spacing[4] * 2;
  const innerW = Math.max(100, W - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT_LARGE - PAD_TOP - PAD_BOTTOM;

  const labels = useMemo(() => data.map((d) => formatPeriod(d.period, granularity)), [data, granularity]);
  const maxRevenue = useMemo(() => Math.max(1, ...data.map((d) => d.revenue || 0)), [data]);
  const maxOrders = useMemo(() => Math.max(1, ...data.map((d) => d.orders || 0)), [data]);

  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;

  const points = useMemo(
    () =>
      data.map((d, i) => ({
        x: PAD_LEFT + i * stepX,
        yRev: PAD_TOP + innerH - ((d.revenue || 0) / maxRevenue) * innerH,
        yOrd: PAD_TOP + innerH - ((d.orders || 0) / maxOrders) * innerH,
        revenue: d.revenue || 0,
        orders: d.orders || 0,
        label: labels[i],
      })),
    [data, maxRevenue, maxOrders, innerH, PAD_LEFT, PAD_TOP, stepX, labels],
  );

  // Paths
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yRev}`)
    .join(' ');
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${PAD_TOP + innerH} L ${points[0].x} ${PAD_TOP + innerH} Z`
    : '';

  const ordersPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.yOrd}`)
    .join(' ');

  // Y ticks (revenue, izquierda)
  const yTicksRev = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxRevenue / Y_TICKS) * i);

  // Subset de labels X (mostrar ~5-7 para evitar overlap)
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <View style={styles.wrapper}>
      <Svg width={W} height={CHART_HEIGHT_LARGE} accessibilityLabel="Gráfico de ingresos vs órdenes">
        <Defs>
          <SvgLinearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={COLOR_REVENUE} stopOpacity={0.2} />
            <Stop offset="100%" stopColor={COLOR_REVENUE} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>

        {/* Grid horizontal — paridad con splitLine web */}
        <G>
          {yTicksRev.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxRevenue) * innerH;
            return (
              <Line
                key={`grid-${i}`}
                x1={PAD_LEFT}
                x2={PAD_LEFT + innerW}
                y1={y}
                y2={y}
                stroke={colorScales.gray[100]}
                strokeWidth={1}
              />
            );
          })}
        </G>

        {/* Eje Y izquierdo — Ingresos */}
        <G>
          {yTicksRev.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxRevenue) * innerH;
            return (
              <SvgText
                key={`yrev-${i}`}
                x={PAD_LEFT - 8}
                y={y + 4}
                fontSize={11}
                fill={colorScales.gray[500]}
                textAnchor="end"
              >
                {shortCurrency(t)}
              </SvgText>
            );
          })}
        </G>

        {/* Eje Y derecho — Órdenes (paridad con `position: 'right'`) */}
        <G>
          {Array.from({ length: Y_TICKS + 1 }, (_, i) => {
            const v = (maxOrders / Y_TICKS) * i;
            const y = PAD_TOP + innerH - (v / maxOrders) * innerH;
            return (
              <SvgText
                key={`yord-${i}`}
                x={PAD_LEFT + innerW + 8}
                y={y + 4}
                fontSize={11}
                fill={colorScales.gray[500]}
                textAnchor="start"
              >
                {Math.round(v)}
              </SvgText>
            );
          })}
        </G>

        {/* Area + Line Ingresos (smooth curve vía cubic Bezier) */}
        {points.length > 0 && (
          <>
            <Path d={areaPath} fill="url(#gradRev)" />
            <Path
              d={smoothPath(points.map((p) => ({ x: p.x, y: p.yRev })))}
              stroke={COLOR_REVENUE}
              strokeWidth={2.5}
              fill="none"
            />
            {points.map((p, i) => (
              <Circle key={`rev-${i}`} cx={p.x} cy={p.yRev} r={3.5} fill={COLOR_REVENUE} />
            ))}
          </>
        )}

        {/* Line Órdenes (sin area, paridad con web que solo tiene line) */}
        {points.length > 0 && (
          <>
            <Path
              d={smoothPath(points.map((p) => ({ x: p.x, y: p.yOrd })))}
              stroke={COLOR_ORDERS}
              strokeWidth={2}
              fill="none"
              strokeDasharray="6 3"
            />
            {points.map((p, i) => (
              <Circle key={`ord-${i}`} cx={p.x} cy={p.yOrd} r={2.5} fill={COLOR_ORDERS} />
            ))}
          </>
        )}

        {/* Eje X labels (subset) */}
        <G>
          {points.map((p, i) => {
            if (i % labelStep !== 0 && i !== points.length - 1) return null;
            return (
              <SvgText
                key={`x-${i}`}
                x={p.x}
                y={PAD_TOP + innerH + 18}
                fontSize={10}
                fill={colorScales.gray[500]}
                textAnchor="middle"
              >
                {p.label}
              </SvgText>
            );
          })}
        </G>

        {/* Leyenda inferior — paridad con web `legend: { data: ['Ingresos', 'Órdenes'], bottom: 30 }` */}
        <LegendRow
          x={PAD_LEFT + innerW / 2}
          y={CHART_HEIGHT_LARGE - 16}
          items={[
            { label: 'Ingresos', color: COLOR_REVENUE },
            { label: 'Órdenes', color: COLOR_ORDERS, dashed: true },
          ]}
        />
      </Svg>

      <ChartSummary data={data} granularity={granularity} />
    </View>
  );
}

/* ========================================================================
 * CHART 2 — AOV (Ticket Promedio, area line purple)
 * ====================================================================== */
export function SalesTrendsAovChart({ data, granularity }: BaseProps) {
  const { width: screenWidth } = useWindowDimensions();

  const PAD_LEFT = 56;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 80;
  const W = screenWidth - spacing[4] * 2;
  const innerW = Math.max(100, W - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT_LARGE - PAD_TOP - PAD_BOTTOM;

  const labels = useMemo(() => data.map((d) => formatPeriod(d.period, granularity)), [data, granularity]);
  const maxAov = useMemo(
    () => Math.max(1, ...data.map((d) => d.average_order_value || 0)),
    [data],
  );

  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = useMemo(
    () =>
      data.map((d, i) => ({
        x: PAD_LEFT + i * stepX,
        y: PAD_TOP + innerH - ((d.average_order_value || 0) / maxAov) * innerH,
        label: labels[i],
      })),
    [data, maxAov, innerH, PAD_LEFT, PAD_TOP, stepX, labels],
  );

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${PAD_TOP + innerH} L ${points[0].x} ${PAD_TOP + innerH} Z`
    : '';

  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxAov / Y_TICKS) * i);
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  return (
    <View style={styles.wrapper}>
      <Svg width={W} height={CHART_HEIGHT_LARGE} accessibilityLabel="Gráfico de ticket promedio">
        <Defs>
          <SvgLinearGradient id="gradAov" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={COLOR_AOV} stopOpacity={0.2} />
            <Stop offset="100%" stopColor={COLOR_AOV} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>

        {/* Grid */}
        <G>
          {yTicks.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxAov) * innerH;
            return (
              <Line
                key={`grid-${i}`}
                x1={PAD_LEFT}
                x2={PAD_LEFT + innerW}
                y1={y}
                y2={y}
                stroke={colorScales.gray[100]}
                strokeWidth={1}
              />
            );
          })}
        </G>

        {/* Eje Y */}
        <G>
          {yTicks.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxAov) * innerH;
            return (
              <SvgText
                key={`y-${i}`}
                x={PAD_LEFT - 8}
                y={y + 4}
                fontSize={11}
                fill={colorScales.gray[500]}
                textAnchor="end"
              >
                {shortCurrency(t)}
              </SvgText>
            );
          })}
        </G>

        {/* Area + Line */}
        {points.length > 0 && (
          <>
            <Path d={areaPath} fill="url(#gradAov)" />
            <Path
              d={smoothPath(points.map((p) => ({ x: p.x, y: p.y })))}
              stroke={COLOR_AOV}
              strokeWidth={2.5}
              fill="none"
            />
            {points.map((p, i) => (
              <Circle key={`aov-${i}`} cx={p.x} cy={p.y} r={3.5} fill={COLOR_AOV} />
            ))}
          </>
        )}

        {/* Eje X labels (subset) */}
        <G>
          {points.map((p, i) => {
            if (i % labelStep !== 0 && i !== points.length - 1) return null;
            return (
              <SvgText
                key={`x-${i}`}
                x={p.x}
                y={PAD_TOP + innerH + 18}
                fontSize={10}
                fill={colorScales.gray[500]}
                textAnchor="middle"
              >
                {p.label}
              </SvgText>
            );
          })}
        </G>

        {/* Leyenda */}
        <LegendRow
          x={PAD_LEFT + innerW / 2}
          y={CHART_HEIGHT_LARGE - 16}
          items={[{ label: 'Ticket Promedio', color: COLOR_AOV }]}
        />
      </Svg>

      <View style={styles.tooltipHint}>
        <Text style={styles.tooltipHintText}>
          Ticket Promedio general:{' '}
          <Text style={{ fontWeight: typography.fontWeight.bold }}>
            {data.length > 0
              ? `$${Math.round(
                  data.reduce((s, d) => s + (d.average_order_value || 0), 0) / data.length,
                ).toLocaleString()}`
              : '$0'}
          </Text>
        </Text>
      </View>
    </View>
  );
}

/* ========================================================================
 * Helpers
 * ====================================================================== */

/** Path suave tipo cardinal/catmull usando Bezier cúbicas — paridad visual con `smooth: true` de echarts. */
function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function LegendRow({
  x,
  y,
  items,
}: {
  x: number;
  y: number;
  items: Array<{ label: string; color: string; dashed?: boolean }>;
}) {
  const itemW = 100;
  const totalW = items.length * itemW;
  const startX = x - totalW / 2;
  return (
    <G>
      {items.map((it, idx) => {
        const ix = startX + idx * itemW;
        if (it.dashed) {
          return (
            <G key={it.label}>
              <Line
                x1={ix}
                y1={y - 5}
                x2={ix + 12}
                y2={y - 5}
                stroke={it.color}
                strokeWidth={2}
                strokeDasharray="4 2"
              />
              <SvgText
                x={ix + 18}
                y={y}
                fontSize={12}
                fill={colorScales.gray[500]}
              >
                {it.label}
              </SvgText>
            </G>
          );
        }
        return (
          <G key={it.label}>
            <Rect
              x={ix}
              y={y - 10}
              width={12}
              height={12}
              rx={2}
              fill={it.color}
            />
            <SvgText
              x={ix + 18}
              y={y}
              fontSize={12}
              fill={colorScales.gray[500]}
            >
              {it.label}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
}

/** Resumen del chart 1 — totales para paridad con el tooltip resumen. */
function ChartSummary({ data, granularity }: BaseProps) {
  const totalRev = data.reduce((s, d) => s + (d.revenue || 0), 0);
  const totalOrd = data.reduce((s, d) => s + (d.orders || 0), 0);
  const periodLabel = granularity === 'day' ? 'Diario' : granularity === 'week' ? 'Semanal' : 'Mensual';
  return (
    <View style={styles.tooltipHint}>
      <Text style={styles.tooltipHintText}>
        {periodLabel} — {data.length} períodos · Ingresos:{' '}
        <Text style={{ fontWeight: typography.fontWeight.bold }}>
          ${Math.round(totalRev).toLocaleString()}
        </Text>{' '}
        · Órdenes:{' '}
        <Text style={{ fontWeight: typography.fontWeight.bold }}>
          {totalOrd.toLocaleString()}
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  tooltipHint: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  tooltipHintText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    fontWeight: typography.fontWeight.medium,
  },
});