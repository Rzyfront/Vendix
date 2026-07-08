import { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, G, Text as SvgText, Line } from 'react-native-svg';
import { colorScales, spacing, typography, colors, borderRadius } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';
import type { SalesByPaymentMethod } from '@/features/store/types';

// Paleta idéntica a la web (sales-by-payment.component.ts → updateChart).
// 9 colores (sin purple duplicado) — web itera `colors[i % colors.length]`.
const BAR_COLORS = [
  '#3b82f6', // blue-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // purple-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
];

// Paridad con web `barMaxWidth: 50` y `.chart-container.large` (min-height 400px).
const BAR_MAX_WIDTH = 50;
const CHART_HEIGHT = 400;
const Y_TICKS = 5;
const LEGEND_LABEL = 'Monto';

/** Formato corto del eje Y — paridad con echarts formatter. */
function shortCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

interface Props {
  methods: SalesByPaymentMethod[];
}

/**
 * Gráfico de barras verticales — paridad exacta con `sales-by-payment.component.ts` (web).
 *
 * - Métodos de pago ordenados por `total_amount` DESC.
 * - Cada barra con color único del palette BAR_COLORS (mismo orden que la web).
 * - Eje Y: total_amount formateado (cortos para evitar overflow).
 * - Eje X: nombre del método (truncado si excede slot).
 * - Leyenda "Monto" centrada en la parte inferior — paridad con `legend: { data: ['Monto'] }`.
 *
 * Tooltip del web: `{name}<br/>Monto: {currency}`.
 * En SVG resumo el equivalente en el footer del chart.
 */
export function PaymentMethodsBarChart({ methods }: Props) {
  const { width: screenWidth } = useWindowDimensions();

  const sorted = useMemo(
    () => [...methods].sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0)).slice(0, 10),
    [methods],
  );

  if (sorted.length === 0) return null;

  const PAD_LEFT = 56;
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 100;

  const innerW = Math.max(100, screenWidth - spacing[4] * 2 - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxAmount = Math.max(...sorted.map((m) => m.total_amount || 0), 1);

  const slot = innerW / sorted.length;
  const barW = Math.min(BAR_MAX_WIDTH, slot * 0.6);

  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxAmount / Y_TICKS) * i);

  const truncate = (name: string, maxChars: number) =>
    name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
  const nameMaxChars = Math.max(6, Math.floor(slot / 7));

  return (
    <View style={styles.wrapper}>
      <Svg
        width={screenWidth - spacing[4] * 2}
        height={CHART_HEIGHT}
        accessibilityLabel="Gráfico de ventas por método de pago"
      >
        {/* Grid horizontal — paridad con splitLine.borderColor */}
        <G>
          {ticks.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxAmount) * innerH;
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

        {/* Eje Y labels */}
        <G>
          {ticks.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxAmount) * innerH;
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

        {/* Barras */}
        <G>
          {sorted.map((m, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const h = ((m.total_amount || 0) / maxAmount) * innerH;
            const y = PAD_TOP + innerH - h;
            const x = cx - barW / 2;
            return (
              <Rect
                key={m.payment_method}
                x={x}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                rx={3}
                fill={BAR_COLORS[i % BAR_COLORS.length]}
              />
            );
          })}
        </G>

        {/* Eje X labels — nombres de métodos (2 líneas si exceden slot) */}
        <G>
          {sorted.map((m, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const name = truncate(m.display_name || m.payment_method, nameMaxChars);
            const half = Math.ceil(name.length / 2);
            const line1 = name.slice(0, half);
            const line2 = name.slice(half);
            return (
              <G key={`x-${m.payment_method}`}>
                <SvgText
                  x={cx}
                  y={PAD_TOP + innerH + 16}
                  fontSize={10}
                  fill={colorScales.gray[500]}
                  textAnchor="middle"
                >
                  {line1}
                </SvgText>
                {line2 && (
                  <SvgText
                    x={cx}
                    y={PAD_TOP + innerH + 28}
                    fontSize={10}
                    fill={colorScales.gray[500]}
                    textAnchor="middle"
                  >
                    {line2}
                  </SvgText>
                )}
              </G>
            );
          })}
        </G>

        {/* Leyenda inferior — paridad con web `legend: { data: ['Monto'], bottom: 30 }` */}
        <G>
          <Rect
            x={PAD_LEFT + innerW / 2 - 40}
            y={CHART_HEIGHT - 24}
            width={12}
            height={12}
            rx={2}
            fill={BAR_COLORS[0]}
          />
          <SvgText
            x={PAD_LEFT + innerW / 2 - 24}
            y={CHART_HEIGHT - 14}
            fontSize={12}
            fill={colorScales.gray[500]}
          >
            {LEGEND_LABEL}
          </SvgText>
        </G>
      </Svg>

      {/* Tooltip resumen — equivalente al formatter del web */}
      <View style={styles.tooltipHint}>
        <Text style={styles.tooltipHintText}>
          {sorted.length} métodos — Top: {sorted[0].display_name} •{' '}
          {formatCurrency(sorted[0].total_amount).replace('$ ', '$')} ({sorted[0].transaction_count} transacciones)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
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
