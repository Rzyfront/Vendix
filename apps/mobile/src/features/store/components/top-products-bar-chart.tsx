import { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, G, Text as SvgText, Line } from 'react-native-svg';
import { colorScales, spacing, typography, colors, borderRadius } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';
import type { SalesByProduct } from '@/features/store/types';

// Paleta idéntica a la web (apps/frontend/.../sales-by-product.component.ts → updateChart).
// Web itera por índice `i % colors.length` sobre los 10 productos top.
const BAR_COLORS = [
  '#3b82f6', // blue-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // purple-500 (purple)
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#f97316', // orange-500
  '#8b5cf6', // purple-500 (duplicado intencional — paridad con web)
];

// Eje Y con 5 marcas como en echarts (grid + splitLine).
const Y_TICKS = 5;
const LEGEND_LABEL = 'Productos';
const BAR_MAX_WIDTH = 50; // Paridad con `barMaxWidth: 50` del web.
const CHART_HEIGHT = 400; // Paridad con `.chart-container.large { min-height: 400px }` del web.

/**
 * Formato corto del eje Y — mismo patrón que usa el web en `formatCurrency(Math.round(v))`.
 * Para COP se manejan valores grandes: $1.2M, $30K, etc.
 */
function shortCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

interface Props {
  products: SalesByProduct[];
}

/**
 * Gráfico de barras verticales — paridad exacta con `sales-by-product.component.ts` (web).
 *
 * - Top 10 productos ordenados por revenue DESC.
 * - Cada barra con color único del palette BAR_COLORS (mismo orden que la web).
 * - Eje Y: revenue formateado (cortos para evitar overflow).
 * - Eje X: nombre del producto (truncado si excede el ancho disponible).
 * - Leyenda "Productos" centrada en la parte inferior — paridad con `legend: { data: ['Productos'] }`.
 */
export function TopProductsBarChart({ products }: Props) {
  const { width: screenWidth } = useWindowDimensions();

  const top10 = useMemo(
    () => [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    [products],
  );

  if (top10.length === 0) return null;

  // Padding del view del chart — coincide con echarts `grid: { left: '3%', right: '4%', top: '3%', bottom: '25%' }`.
  // En SVG usamos valores fijos (en px) equivalentes al ~3–4% del ancho.
  const PAD_LEFT = 56;   // Eje Y (ancho para labels)
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;    // ~3% reserva
  const PAD_BOTTOM = 100; // ~25% reserva para eje X (2 líneas) + leyenda

  const innerW = Math.max(100, screenWidth - spacing[4] * 2 - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxRevenue = Math.max(...top10.map((p) => p.revenue), 1);

  // Calcular ancho de barra — cap a BAR_MAX_WIDTH pero no exceder el slot por categoría.
  const slot = innerW / top10.length;
  const barW = Math.min(BAR_MAX_WIDTH, slot * 0.6);

  // Ticks del eje Y (5 marcas desde 0 hasta maxRevenue).
  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxRevenue / Y_TICKS) * i);

  // Truncar nombre de producto si excede ancho del slot.
  const truncate = (name: string, maxChars: number) =>
    name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;

  // Determinar chars disponibles según el ancho del slot.
  const nameMaxChars = Math.max(6, Math.floor(slot / 7));

  return (
    <View style={styles.wrapper}>
      <Svg
        width={screenWidth - spacing[4] * 2}
        height={CHART_HEIGHT}
        accessibilityLabel="Gráfico de productos más vendidos"
      >
        {/* Grid horizontal (splitLine) — paridad con web splitLine.borderColor */}
        <G>
          {ticks.map((t, i) => {
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

        {/* Eje Y labels — paridad con formatter del web */}
        <G>
          {ticks.map((t, i) => {
            const y = PAD_TOP + innerH - (t / maxRevenue) * innerH;
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
          {top10.map((p, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const h = (p.revenue / maxRevenue) * innerH;
            const y = PAD_TOP + innerH - h;
            const x = cx - barW / 2;
            return (
              <Rect
                key={p.product_id}
                x={x}
                y={y}
                width={barW}
                height={Math.max(1, h)}
                rx={3}
                fill={BAR_COLORS[i % BAR_COLORS.length]}
                // Tooltip equivalente (Pressable wrapper más abajo).
              />
            );
          })}
        </G>

        {/* Eje X labels — nombres de productos (2 líneas si hay espacio) */}
        <G>
          {top10.map((p, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const name = truncate(p.product_name, nameMaxChars);
            // Línea 1 — primera mitad
            // Línea 2 — segunda mitad (si excede el ancho, mostramos el resto)
            const half = Math.ceil(name.length / 2);
            const line1 = name.slice(0, half);
            const line2 = name.slice(half);
            return (
              <G key={`x-${p.product_id}`}>
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

        {/* Leyenda inferior — paridad con web `legend: { data: ['Productos'], bottom: 30 }` */}
        <G>
          {/* Cuadrado de color */}
          <Rect
            x={PAD_LEFT + innerW / 2 - 60}
            y={CHART_HEIGHT - 24}
            width={12}
            height={12}
            rx={2}
            fill={BAR_COLORS[0]}
          />
          <SvgText
            x={PAD_LEFT + innerW / 2 - 44}
            y={CHART_HEIGHT - 14}
            fontSize={12}
            fill={colorScales.gray[500]}
          >
            {LEGEND_LABEL}
          </SvgText>
        </G>
      </Svg>

      {/* Tooltip equivalente — muestra los valores formateados como en echarts.
          Se muestra siempre la lista debajo del chart para paridad visual completa. */}
      <View style={styles.tooltipHint}>
        <Text style={styles.tooltipHintText}>
          {top10.length} productos — Top: {top10[0].product_name} •{' '}
          {formatCurrency(top10[0].revenue).replace('$ ', '$')}
        </Text>
      </View>
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