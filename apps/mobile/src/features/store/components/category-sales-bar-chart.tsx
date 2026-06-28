import { useMemo } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Rect, G, Text as SvgText, Line } from 'react-native-svg';
import { colorScales, spacing, typography, colors, borderRadius } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';
import type { SalesByCategory } from '@/features/store/types';

// Paleta idéntica a la web (sales-by-category.component.ts → updateChart).
// Web itera `colors[i % colors.length]` para Ingresos y `colors[(i+3) % colors.length]` para Unidades.
const BAR_COLORS = [
  '#3b82f6', // blue-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#8b5cf6', // purple-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
];

// Paridad con web `barMaxWidth: 40` (ECharts).
const BAR_MAX_WIDTH = 40;
const CHART_HEIGHT = 400; // Paridad con `.chart-container.large { min-height: 400px }` del web.
const Y_TICKS = 5;

/**
 * Formato corto del eje Y — mismo patrón que el web usa en `formatCurrency(Math.round(v))`.
 */
function shortCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value}`;
}

interface Props {
  categories: SalesByCategory[];
}

/**
 * Gráfico de barras dual — paridad exacta con `sales-by-category.component.ts` (web).
 *
 * - Top categorías ordenadas por revenue DESC.
 * - Dos series lado a lado: Ingresos (color `colors[i % 7]`) y Unidades (color `colors[(i+3) % 7]`).
 * - Eje Y: revenue formateado (cortos para evitar overflow).
 * - Eje X: nombre de categoría (truncado si excede slot).
 * - Leyenda inferior "Ingresos / Unidades" centrada — paridad con `legend: { data: ['Ingresos', 'Unidades'] }`.
 */
export function CategorySalesBarChart({ categories }: Props) {
  const { width: screenWidth } = useWindowDimensions();

  const sorted = useMemo(
    () => [...categories].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    [categories],
  );

  if (sorted.length === 0) return null;

  // Padding del view del chart — equivalente a echarts `grid: { left: '3%', right: '4%', top: '3%', bottom: '25%' }`.
  const PAD_LEFT = 56;   // Eje Y
  const PAD_RIGHT = 16;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 100; // Eje X + leyenda

  const innerW = Math.max(100, screenWidth - spacing[4] * 2 - PAD_LEFT - PAD_RIGHT);
  const innerH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxRevenue = Math.max(...sorted.map((c) => c.revenue), 1);

  // Slot por categoría — albergamos 2 barras (Ingresos + Unidades) lado a lado.
  const slot = innerW / sorted.length;
  const barW = Math.min(BAR_MAX_WIDTH, (slot / 2) * 0.8);
  const barGap = Math.max(2, slot * 0.1);

  // Ticks del eje Y (5 marcas desde 0 hasta maxRevenue).
  const ticks = Array.from({ length: Y_TICKS + 1 }, (_, i) => (maxRevenue / Y_TICKS) * i);

  // Truncar nombre si excede el ancho del slot.
  const truncate = (name: string, maxChars: number) =>
    name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
  const nameMaxChars = Math.max(6, Math.floor(slot / 7));

  return (
    <View style={styles.wrapper}>
      <Svg
        width={screenWidth - spacing[4] * 2}
        height={CHART_HEIGHT}
        accessibilityLabel="Gráfico de ventas por categoría"
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

        {/* Eje Y labels */}
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

        {/* Barras — Ingresos (color[i % 7]) y Unidades (color[(i+3) % 7]) lado a lado */}
        <G>
          {sorted.map((c, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            // Ingresos (izquierda)
            const h1 = (c.revenue / maxRevenue) * innerH;
            const y1 = PAD_TOP + innerH - h1;
            const x1 = cx - barW - barGap / 2;
            return (
              <G key={c.category_id}>
                {/* Barra Ingresos — escalado por maxRevenue (eje Y) */}
                <Rect
                  x={x1}
                  y={y1}
                  width={barW}
                  height={Math.max(1, h1)}
                  rx={3}
                  fill={BAR_COLORS[i % BAR_COLORS.length]}
                />
                {/* Barra Unidades — paridad con web: mismo eje Y (revenue) */}
                <UnitsBar
                  cx={cx + barGap / 2}
                  innerH={innerH}
                  padTop={PAD_TOP}
                  barW={barW}
                  value={c.units_sold || 0}
                  maxRevenue={maxRevenue}
                  color={BAR_COLORS[(i + 3) % BAR_COLORS.length]}
                />
              </G>
            );
          })}
        </G>

        {/* Eje X labels */}
        <G>
          {sorted.map((c, i) => {
            const cx = PAD_LEFT + slot * i + slot / 2;
            const name = truncate(c.category_name, nameMaxChars);
            const half = Math.ceil(name.length / 2);
            const line1 = name.slice(0, half);
            const line2 = name.slice(half);
            return (
              <G key={`x-${c.category_id}`}>
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

        {/* Leyenda inferior — paridad con web `legend: { data: ['Ingresos', 'Unidades'], bottom: 30 }` */}
        <LegendRow
          x={PAD_LEFT + innerW / 2}
          y={CHART_HEIGHT - 16}
          items={[
            { label: 'Ingresos', color: BAR_COLORS[0] },
            { label: 'Unidades', color: BAR_COLORS[3] },
          ]}
        />
      </Svg>

      {/* Tooltip resumen — muestra valor del top */}
      <View style={styles.tooltipHint}>
        <Text style={styles.tooltipHintText}>
          {sorted.length} categorías — Top: {sorted[0].category_name} •{' '}
          {formatCurrency(sorted[0].revenue).replace('$ ', '$')} ({sorted[0].units_sold.toLocaleString()} und.)
        </Text>
      </View>
    </View>
  );
}

/** Sub-componente: barra de Unidades.
 *  Paridad con web: usa el MISMO eje Y (revenue) que la serie Ingresos — ambos se
 *  grafican contra `value` formateado como currency. Esto replica exactamente
 *  el comportamiento del echarts del web (sin dual-axis). */
function UnitsBar({
  cx,
  innerH,
  padTop,
  barW,
  value,
  maxRevenue,
  color,
}: {
  cx: number;
  innerH: number;
  padTop: number;
  barW: number;
  value: number;
  maxRevenue: number;
  color: string;
}) {
  const h = (value / maxRevenue) * innerH;
  const y = padTop + innerH - h;
  return (
    <Rect
      x={cx - barW / 2}
      y={y}
      width={barW}
      height={Math.max(1, h)}
      rx={3}
      fill={color}
    />
  );
}

/** Sub-componente: leyenda horizontal centrada. */
function LegendRow({
  x,
  y,
  items,
}: {
  x: number;
  y: number;
  items: Array<{ label: string; color: string }>;
}) {
  // Centrar: calculamos ancho total aproximado.
  const itemW = 90; // ancho reservado por item
  const totalW = items.length * itemW;
  const startX = x - totalW / 2;

  return (
    <G>
      {items.map((it, idx) => {
        const ix = startX + idx * itemW;
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