import { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Path, G, Circle, Text as SvgText, Rect } from 'react-native-svg';
import { colorScales, spacing, typography, colors } from '@/shared/theme';
import type { SalesByChannel } from '@/features/store/types';

// Paleta idéntica al web (dashboard.component.ts → CHANNEL_COLOR_VAR).
const CHANNEL_COLORS: Record<string, string> = {
  pos: '#2ecc71',        // --color-primary
  ecommerce: '#06b6d4',  // --color-secondary (cyan)
  whatsapp: '#f59e0b',   // --color-accent (amber)
  agent: '#eab308',      // --color-warning (yellow)
  marketplace: '#ef4444',// --color-error
};
const DEFAULT_COLOR = '#6b7280';

const CHART_HEIGHT = 240;

/** Formato corto del tooltip — paridad con echarts `currencyService.formatCompact`. */
function shortCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

interface Props {
  channels: SalesByChannel[];
}

/**
 * Gráfico de torta Nightingale (roseType area) — paridad exacta con
 * `dashboard.component.ts → updateChannelChart` (web).
 *
 * - Radio exterior proporcional a √valor (paridad con `roseType: 'area'`).
 * - Radio interior fijo (paridad con `radius: [30, 110]`).
 * - Centro del gráfico: 45% vertical.
 * - Leyenda inferior centrada.
 */
export function DashboardChannelPie({ channels }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const W = screenWidth - spacing[4] * 2;

  if (channels.length === 0) return null;

  const cx = W / 2;
  const cy = (CHART_HEIGHT - 36) / 2; // reserve ~36px for legend

  const maxRevenue = Math.max(...channels.map((c) => c.revenue || 0), 1);
  const innerR = 24;
  const outerR = Math.min(cx, cy) - 16;

  const total = channels.reduce((s, c) => s + (c.revenue || 0), 0) || 1;

  const slices = useMemo(() => {
    let startAngle = -Math.PI / 2; // start at top (12 o'clock)
    return channels.map((c) => {
      const fraction = (c.revenue || 0) / total;
      const angle = fraction * Math.PI * 2;
      const endAngle = startAngle + angle;

      // Rose pie: outer radius scales by sqrt(value/max) for area perception.
      const rOuter = innerR + (outerR - innerR) * Math.sqrt((c.revenue || 0) / maxRevenue);
      const color = CHANNEL_COLORS[c.channel.toLowerCase()] || DEFAULT_COLOR;

      const path = describeRoseSlice(cx, cy, innerR, rOuter, startAngle, endAngle);

      const slice = {
        path,
        color,
        channel: c,
        fraction,
        startAngle,
        endAngle,
        midAngle: (startAngle + endAngle) / 2,
        labelRadius: (innerR + rOuter) / 2,
      };
      startAngle = endAngle;
      return slice;
    });
  }, [channels, cx, cy, innerR, outerR, maxRevenue, total]);

  return (
    <View style={styles.wrapper}>
      <Svg width={W} height={CHART_HEIGHT} accessibilityLabel="Ventas por canal">
        <G>
          {slices.map((s, i) => (
            <Path
              key={`slice-${i}`}
              d={s.path}
              fill={s.color}
              stroke={colors.card}
              strokeWidth={2}
            />
          ))}
        </G>

        {/* Center label — total revenue (paridad con tooltip resumen) */}
        <G>
          <SvgText
            x={cx}
            y={cy - 4}
            fontSize={10}
            fill={colorScales.gray[500]}
            textAnchor="middle"
          >
            Total
          </SvgText>
          <SvgText
            x={cx}
            y={cy + 12}
            fontSize={13}
            fontWeight="bold"
            fill={colors.text.primary}
            textAnchor="middle"
          >
            {shortCurrency(total)}
          </SvgText>
        </G>

        {/* Leyenda inferior — paridad con web `legend: { bottom: 0, left: 'center', orient: 'horizontal' }` */}
        <LegendRow
          x={cx}
          y={CHART_HEIGHT - 8}
          items={slices.map((s) => ({
            label: s.channel.display_name || s.channel.channel,
            color: s.color,
          }))}
          totalWidth={W - 24}
        />
      </Svg>

      <Text style={styles.summaryText}>
        {channels.length} canales · Distribución del período
      </Text>
    </View>
  );
}

/* ========================================================================
 * Helpers
 * ====================================================================== */

/**
 * Construye el path SVG para un sector circular (anillo / rose pie).
 * El parámetro rose (outerR variable) produce el efecto Nightingale.
 */
function describeRoseSlice(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);

  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ');
}

function LegendRow({
  x,
  y,
  items,
  totalWidth,
}: {
  x: number;
  y: number;
  items: Array<{ label: string; color: string }>;
  totalWidth: number;
}) {
  if (items.length === 0) return null;
  const itemW = Math.min(110, totalWidth / items.length);
  const totalW = items.length * itemW;
  const startX = x - totalW / 2;

  return (
    <G>
      {items.map((it, idx) => {
        const ix = startX + idx * itemW;
        return (
          <G key={`${it.label}-${idx}`}>
            <Rect x={ix} y={y - 9} width={10} height={10} rx={2} fill={it.color} />
            <SvgText
              x={ix + 14}
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
    textAlign: 'center',
  },
});