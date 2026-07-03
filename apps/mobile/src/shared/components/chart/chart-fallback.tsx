import { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Circle, Line, Text as SvgText, G } from 'react-native-svg';
import { colors, spacing, borderRadius, colorScales, typography } from '@/shared/theme';

interface ChartFallbackProps {
  data: Array<{ x: string; revenue: number; orders?: number }>;
  title?: string;
}

const CHART_HEIGHT = 160;
const CHART_PADDING_X = 16;
const CHART_PADDING_TOP = 12;
const CHART_PADDING_BOTTOM = 24;

/**
 * TrendChartFallback — line chart con doble eje Y como en la web.
 *  - Eje Y izquierdo: $ Ingresos (0 a maxRevenue, redondeado)
 *  - Eje Y derecho: Órdenes (0 a maxOrders)
 *  - Eje X: tiempo según granularidad (hour o day)
 *  - Línea + área rellenada para Ingresos
 *  - Puntos en cada marca
 *  - Leyenda inferior: "Ingresos" + "Órdenes"
 */
export function TrendChartFallback({ data, title, granularity }: ChartFallbackProps & { granularity?: string }) {
  const { width: SCREEN_WIDTH } = Dimensions.get('window');
  // Ancho disponible: container con marginHorizontal: 6 (parent) + padding interno
  const containerWidth = SCREEN_WIDTH - 12 - 24;
  // Reservamos espacio a la izquierda y derecha para los labels de los ejes Y
  const Y_AXIS_WIDTH = 32;
  const chartWidth = containerWidth - CHART_PADDING_X * 2 - Y_AXIS_WIDTH * 2;
  const chartHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

  if (!data || data.length === 0) {
    return null;
  }

  const maxRevenue = Math.max(...data.map((d) => d.revenue)) || 1;
  const maxOrders = Math.max(...data.map((d) => d.orders ?? 0)) || 1;

  // Redondear maxRevenue al entero más cercano con un mínimo de 1
  const maxRevenueRounded = Math.max(1, Math.ceil(maxRevenue));

  // Calcular puntos del line chart (con labels formateados)
  const stepX = chartWidth / Math.max(1, data.length - 1);
  const offsetX = CHART_PADDING_X + Y_AXIS_WIDTH;
  const points = data.map((d, i) => ({
    x: offsetX + i * stepX,
    y: CHART_PADDING_TOP + chartHeight - (d.revenue / maxRevenue) * chartHeight,
    data: d,
    label: formatChartPeriod(d.x, granularity),
  }));

  // Construir el path del line chart
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // Construir el path del área rellenada
  const areaPath =
    `M ${points[0].x} ${CHART_PADDING_TOP + chartHeight} ` +
    points.map((p) => `L ${p.x} ${p.y}`).join(' ') +
    ` L ${points[points.length - 1].x} ${CHART_PADDING_TOP + chartHeight} Z`;

  // Encontrar el punto más alto
  const highestIndex = data.findIndex((d) => d.revenue === maxRevenue);

  // Labels del eje Y izquierdo (Ingresos $)
  const leftYLabels = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = Math.round(maxRevenueRounded * ratio);
    return { y: CHART_PADDING_TOP + chartHeight - ratio * chartHeight, value };
  });

  // Labels del eje Y derecho (Órdenes)
  const rightYLabels = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = (maxOrders * ratio).toFixed(1).replace(/\.0$/, '');
    return { y: CHART_PADDING_TOP + chartHeight - ratio * chartHeight, value };
  });

  return (
    <View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <View style={styles.chartWrapper}>
        <Svg width={containerWidth} height={CHART_HEIGHT}>
          {/* Grid lines horizontales (5 líneas) */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
            const y = CHART_PADDING_TOP + chartHeight * ratio;
            return (
              <Line
                key={`grid-${i}`}
                x1={CHART_PADDING_X + Y_AXIS_WIDTH}
                y1={y}
                x2={CHART_PADDING_X + Y_AXIS_WIDTH + chartWidth}
                y2={y}
                stroke={colorScales.gray[200]}
                strokeWidth={1}
              />
            );
          })}

          {/* Área rellenada bajo la línea */}
          <Path d={areaPath} fill={colors.primary} fillOpacity={0.12} />

          {/* Línea de tendencia */}
          <Path
            d={linePath}
            stroke={colors.primary}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Puntos de datos */}
          {points.map((p, i) => {
            const isHighest = i === highestIndex;
            return (
              <G key={`point-${i}`}>
                <Circle
                  cx={p.x}
                  cy={p.y}
                  r={isHighest ? 5 : 3.5}
                  fill={colors.primary}
                  stroke={colors.card}
                  strokeWidth={1.5}
                />
              </G>
            );
          })}

          {/* Labels del eje Y izquierdo ($) */}
          {leftYLabels.map((l, i) => (
            <SvgText
              key={`y-left-${i}`}
              x={CHART_PADDING_X + Y_AXIS_WIDTH - 4}
              y={l.y + 3}
              fontSize={9}
              fill={colorScales.gray[500]}
              textAnchor="end"
            >
              {`$${l.value}`}
            </SvgText>
          ))}

          {/* Labels del eje Y derecho (Órdenes) */}
          {rightYLabels.map((l, i) => (
            <SvgText
              key={`y-right-${i}`}
              x={CHART_PADDING_X + Y_AXIS_WIDTH + chartWidth + 4}
              y={l.y + 3}
              fontSize={9}
              fill={colorScales.gray[500]}
              textAnchor="start"
            >
              {l.value}
            </SvgText>
          ))}

          {/* Labels del eje X (abajo) — solo algunos para no saturar */}
          {points.map((p, i) => {
            // Mostrar solo cada 2-3 labels según la cantidad
            const showLabel = data.length <= 7 || i % Math.ceil(data.length / 6) === 0;
            if (!showLabel) return null;
            return (
              <SvgText
                key={`x-label-${i}`}
                x={p.x}
                y={CHART_HEIGHT - 4}
                fontSize={9}
                fill={colorScales.gray[500]}
                textAnchor="middle"
              >
                {p.label}
              </SvgText>
            );
          })}
        </Svg>

        {/* Leyenda inferior como en la web */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendLine, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendText}>Ingresos</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendRect, { backgroundColor: colorScales.green[200] }]} />
            <Text style={styles.legendText}>Órdenes</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

/**
 * Formatea el periodo del chart según la granularidad.
 * Misma lógica que `formatChartPeriod` de la web:
 *  - year: "2024"
 *  - month: "ene 25"
 *  - hour: "14:00"
 *  - day (default): "24 mar"
 */
function formatChartPeriod(period: string, granularity?: string): string {
  if (granularity === 'year') return period;
  if (granularity === 'month') {
    const [year, month] = period.split('-');
    const date = new Date(Date.UTC(Number(year), Number(month) - 1));
    return date.toLocaleDateString('es', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  if (granularity === 'hour') {
    const parts = period.split('T');
    return parts[1] || period;
  }
  try {
    const date = new Date(period);
    return date.toLocaleDateString('es', { day: '2-digit', month: 'short', timeZone: 'UTC' });
  } catch {
    return period;
  }
}

interface ChannelListFallbackProps {
  data: Array<{ label: string; value: number; color: string }>;
  title?: string;
}

export function ChannelListFallback({ data, title }: ChannelListFallbackProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;

  return (
    <View>
      {title && (
        <Text style={styles.title}>{title}</Text>
      )}
      <View style={styles.container}>
        {data.map((item, index) => {
          const percentage = (item.value / total) * 100;
          const formattedValue = item.value >= 1000000
            ? `$${(item.value / 1000000).toFixed(1)}M`
            : item.value >= 1000
              ? `$${(item.value / 1000).toFixed(0)}K`
              : `$${item.value.toLocaleString()}`;

          return (
            <View key={index} style={styles.channelItem}>
              <View style={styles.channelHeaderRow}>
                <View style={styles.channelDotAndLabel}>
                  <View style={[styles.channelDot, { backgroundColor: item.color }]} />
                  <Text style={styles.channelLabel}>{item.label}</Text>
                </View>
                <Text style={styles.channelValue}>
                  {percentage.toFixed(0)}% <Text style={styles.channelValueAmount}>({formattedValue})</Text>
                </Text>
              </View>
              <View style={styles.channelTrack}>
                <View
                  style={[
                    styles.channelFill,
                    {
                      backgroundColor: item.color,
                      width: `${Math.max(2, percentage)}%`,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface SafeChartProps {
  children: ReactNode;
  fallback: ReactNode;
}

export function SafeChart({ children, fallback }: SafeChartProps) {
  return (
    <ChartErrorBoundary fallback={fallback}>
      {children}
    </ChartErrorBoundary>
  );
}

class ChartErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    marginBottom: spacing[3],
  },
  container: {
    flex: 1,
  },
  chartWrapper: {
    paddingTop: spacing[2],
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[4],
    marginTop: spacing[2],
    paddingHorizontal: spacing[1],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLine: {
    width: 14,
    height: 2,
    borderRadius: 1,
  },
  legendRect: {
    width: 14,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
  },
  highlightValue: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  channelItem: {
    gap: spacing[1],
  },
  channelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  channelDotAndLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  channelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  channelLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium,
  },
  channelValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
  },
  channelValueAmount: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    fontWeight: typography.fontWeight.normal,
  },
  channelTrack: {
    height: 6,
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  channelFill: {
    height: '100%',
    borderRadius: borderRadius.full,
  },
});
