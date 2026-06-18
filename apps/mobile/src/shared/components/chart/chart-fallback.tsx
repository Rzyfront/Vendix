import { Component, type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, colorScales, typography } from '@/shared/theme';

interface ChartFallbackProps {
  data: Array<{ x: string; revenue: number; orders?: number }>;
  title?: string;
}

export function TrendChartFallback({ data, title }: ChartFallbackProps) {
  const maxRevenue = Math.max(...data.map(item => item.revenue)) || 1;

  return (
    <View>
      {title && (
        <Text style={styles.title}>{title}</Text>
      )}
      <View style={styles.container}>
        {data.map((d, i) => {
          const isHighest = d.revenue === maxRevenue;
          const percentage = (d.revenue / maxRevenue) * 100;
          const formattedValue = d.revenue >= 1000000
            ? `$${(d.revenue / 1000000).toFixed(1)}M`
            : d.revenue >= 1000
              ? `$${(d.revenue / 1000).toFixed(0)}K`
              : `$${d.revenue.toLocaleString()}`;

          return (
            <View key={d.x} style={styles.row}>
              <Text style={styles.label}>{d.x}</Text>
              <View style={styles.barContainer}>
                <View
                  style={[
                    styles.bar,
                    {
                      width: `${Math.max(4, percentage)}%`,
                    },
                    isHighest && styles.barHighlight,
                  ]}
                />
              </View>
              <Text style={[styles.value, isHighest && styles.valueHighlight]}>
                {formattedValue}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
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
    gap: spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    width: 45,
  },
  barContainer: {
    flex: 1,
    height: 8,
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[300],
  },
  barHighlight: {
    backgroundColor: colors.primary,
  },
  value: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    width: 60,
    textAlign: 'right',
  },
  valueHighlight: {
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
