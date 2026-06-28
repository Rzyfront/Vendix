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

// Paleta idéntica al web (dashboard.component.ts → updateTrendChart).
const COLOR_REVENUE = '#22c55e'; // --color-primary (green-500)
const COLOR_ORDERS = '#06b6d4';  // --color-accent (cyan-500)
const CHART_HEIGHT = 240;        // h-56 del web
const Y_TICKS = 5;
const BAR_MAX_WIDTH = 16;        // Paridad con `barMaxWidth: 16` del web.

/** Formato corto del eje Y — paridad con echarts formatter. */
function shortCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

/** Formato de período 'YYYY-MM-DD' → 'DD/MM' (paridad con formatChartPeriod 'day'). */
function formatPeriod(period: string): string {
  if (!period) return '';
  const [, m, d] = period.split('-');
  return `${d}/${m}`;
}

interface Props {
  data: SalesTrend[];
}

/**
 * Gráfico dual-axis combo — paridad exacta con `dashboard.component.ts → updateTrendChart` (web).
 *
 * - Línea de área suave para **Ingresos** (eje Y izquierdo).
 * - Barras para **Órdenes** (eje Y derecho, `barMaxWidth: 16`).
 * - Leyenda inferior: "Ingresos" + "Órdenes".
 */
export function DashboardTrendChart({ data }: Props) {
  const { width: screenWidth } = useWindowDimensions();

  const PAD_LEFT = 48;
  const PAD_RIGHT = 40;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 56;
  const W = screenWidth - spacing[4] * 2;
  const innerW = Math.max(100, W - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;

  const labels = useMemo(() => data.map((d) => formatPeriod(d.period)), [data]);
  const maxRevenue = useMemo(() => Math.max(1, ...data.map((d) => d.revenue || 0)), [data]);
  const maxOrders = useMemo(() => Math.max(1, ...data.map((d) => d.orders || 0)), [data]);

  const slotW = data.length > 0 ? innerW / data.length : 0;
  const points = useMemo(
    () =>
      data.map((d, i) => ({
        x: PAD_LEFT + slotW * (i + 0.5),
        yRev: PAD_TOP + innerH - ((d.revenue || 0) / maxRevenue) * innerH,
        yOrd: PAD_TOP + innerH - ((d.orders || 0) / maxOrders) * innerH,
        revenue: d.revenue || 0,
        orders: d.orders || 0,
        label: labels[i],
      })),
    [data, maxRevenue, maxOrders, innerH, PAD_LEFT, PAD_TOP, slotW, labels],
  );

  // Build area path from smoothed line (paridad con `areaStyle` linear gradient).
  const linePoints = points.map((p) => ({ x: p.x, y: p.yRev }));
  const smoothD = smoothPath(linePoints);
  const areaD = points.length > 0
    ? `${smoothD} L ${points[points.length - 1].x} ${PAD_TOP + innerH} L ${points[0].x} ${PAD_TOP + innerH} Z`
    : '';

  // Y ticks (revenue, izquierda)
  const yTicksRev = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxRevenue / Y_TICKS) * i);
  const yTicksOrd = Array.from({ length: Y_TICKS + 1 }, (_, i) => Math.round((maxOrders / Y_TICKS) * i));

  // Subset of X labels
  const labelStep = Math.max(1, Math.ceil(labels.length / 6));

  if (data.length === 0) return null;

  return (
    <View style={styles.wrapper}>
      <Svg width={W} height={CHART_HEIGHT} accessibilityLabel="Tendencia de ventas">
        <Defs>
          <SvgLinearGradient id="dashGradRev" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={COLOR_REVENUE} stopOpacity={0.3} />
            <Stop offset="100%" stopColor={COLOR_REVENUE} stopOpacity={0.05} />
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
                x={PAD_LEFT - 6}
                y={y + 4}
                fontSize={10}
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
          {yTicksOrd.map((t, i) => {
            const v = (maxOrders / Y_TICKS) * i;
            const y = PAD_TOP + innerH - (v / maxOrders) * innerH;
            return (
              <SvgText
                key={`yord-${i}`}
                x={PAD_LEFT + innerW + 6}
                y={y + 4}
                fontSize={10}
                fill={colorScales.gray[500]}
                textAnchor="start"
              >
                {Math.round(v)}
              </SvgText>
            );
          })}
        </G>

        {/* Barras de Órdenes (paridad con `type: 'bar', barMaxWidth: 16, borderRadius: [2, 2, 0, 0]`) */}
        <G>
          {points.map((p, i) => {
            const barH = PAD_TOP + innerH - p.yOrd;
            const barW = Math.min(BAR_MAX_WIDTH, slotW * 0.7);
            const xBar = p.x - barW / 2;
            const yBar = p.yOrd;
            return (
              <Rect
                key={`bar-${i}`}
                x={xBar}
                y={yBar}
                width={barW}
                height={Math.max(0, barH)}
                rx={2}
                ry={2}
                fill={COLOR_ORDERS}
                fillOpacity={0.6}
              />
            );
          })}
        </G>

        {/* Area + Line Ingresos (smooth curve vía cubic Bezier) */}
        <Path d={areaD} fill="url(#dashGradRev)" />
        <Path
          d={smoothD}
          stroke={COLOR_REVENUE}
          strokeWidth={2}
          fill="none"
        />
        {points.map((p, i) => (
          <Circle key={`rev-${i}`} cx={p.x} cy={p.yRev} r={3} fill={COLOR_REVENUE} />
        ))}

        {/* Eje X labels (subset) */}
        <G>
          {points.map((p, i) => {
            if (i % labelStep !== 0 && i !== points.length - 1) return null;
            return (
              <SvgText
                key={`x-${i}`}
                x={p.x}
                y={PAD_TOP + innerH + 14}
                fontSize={10}
                fill={colorScales.gray[500]}
                textAnchor="middle"
              >
                {p.label}
              </SvgText>
            );
          })}
        </G>

        {/* Leyenda inferior — paridad con web `legend: { data: ['Ingresos', 'Órdenes'], bottom: 0 }` */}
        <LegendRow
          x={PAD_LEFT + innerW / 2}
          y={CHART_HEIGHT - 14}
          items={[
            { label: 'Ingresos', color: COLOR_REVENUE, kind: 'line' },
            { label: 'Órdenes', color: COLOR_ORDERS, kind: 'bar' },
          ]}
        />
      </Svg>

      <Text style={styles.summaryText}>
        {data.length} días · Ingresos:{' '}
        <Text style={styles.summaryBold}>
          ${Math.round(data.reduce((s, d) => s + (d.revenue || 0), 0)).toLocaleString()}
        </Text>{' '}
        · Órdenes:{' '}
        <Text style={styles.summaryBold}>
          {data.reduce((s, d) => s + (d.orders || 0), 0).toLocaleString()}
        </Text>
      </Text>
    </View>
  );
}

/* ========================================================================
 * Helpers
 * ====================================================================== */

/** Path suave tipo cardinal/catmull usando Bezier cúbicas — paridad con `smooth: true` de echarts. */
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
  items: Array<{ label: string; color: string; kind: 'line' | 'bar' }>;
}) {
  const itemW = 90;
  const totalW = items.length * itemW;
  const startX = x - totalW / 2;
  return (
    <G>
      {items.map((it, idx) => {
        const ix = startX + idx * itemW;
        if (it.kind === 'bar') {
          return (
            <G key={it.label}>
              <Rect x={ix} y={y - 8} width={10} height={10} rx={2} fill={it.color} fillOpacity={0.6} />
              <SvgText
                x={ix + 16}
                y={y}
                fontSize={11}
                fill={colorScales.gray[500]}
              >
                {it.label}
              </SvgText>
            </G>
          );
        }
        return (
          <G key={it.label}>
            <Line
              x1={ix}
              y1={y - 4}
              x2={ix + 14}
              y2={y - 4}
              stroke={it.color}
              strokeWidth={2.5}
            />
            <Circle cx={ix + 7} cy={y - 4} r={2.5} fill={it.color} />
            <SvgText
              x={ix + 20}
              y={y}
              fontSize={11}
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

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  summaryText: {
    marginTop: spacing[2],
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    fontWeight: typography.fontWeight.medium,
  },
  summaryBold: {
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
  },
});