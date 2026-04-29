import React, { Component, ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, colorScales, typography } from '@/shared/theme';

interface ChartFallbackProps {
  data: Array<{ x: string; revenue: number; orders?: number }>;
  title?: string;
}

export function TrendChartFallback({ data, title }: ChartFallbackProps) {
  return (
    <View>
      {title && (
        <Text style={styles.title}>{title}</Text>
      )}
      <View style={styles.container}>
        {data.map((d, i) => {
          const isHighest = d.revenue === Math.max(...data.map(item => item.revenue));
          return (
            <View key={d.x} style={styles.row}>
              <Text style={styles.label}>{d.x}</Text>
              <View style={[styles.barContainer, isHighest && styles.barContainerHighlight]}>
                <View
                  style={[
                    styles.bar,
                    {
                      height: Math.max(4, (d.revenue / (Math.max(...data.map(item => item.revenue)) || 1)) * 100),
                    },
                    isHighest && styles.barHighlight,
                  ]}
                />
              </View>
              <Text style={[styles.value, isHighest && styles.valueHighlight]}>
                {d.revenue >= 1000000
                  ? `${(d.revenue / 1000000).toFixed(1)}M`
                  : d.revenue >= 1000
                    ? `${(d.revenue / 1000).toFixed(0)}K`
                    : d.revenue.toLocaleString()}
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
      {data.map((item, index) => (
        <View key={index} style={styles.channelRow}>
          <View style={[styles.channelDot, { backgroundColor: item.color }]} />
          <Text style={styles.channelLabel}>{item.label}</Text>
          <Text style={styles.channelValue}>
            {((item.value / total) * 100).toFixed(0)}%
          </Text>
        </View>
      ))}
    </View>
  );
}

interface SafeChartProps {
  children: ReactNode;
  fallback: ReactNode;
}

export function SafeChart({ children, fallback }: SafeChartProps) {
  return (
    <ErrorBoundary fallback={<>{fallback}</>}>
      {children}
    </ErrorBoundary>
  );
}

const ErrorBoundary: Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> = class extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
};

const styles = StyleSheet.create({
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.secondary,
    marginBottom: spacing[3],
  },
  container: {
    gap: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  label: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    width: 50,
  },
  barContainer: {
    flex: 1,
    height: 24,
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.xs,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  bar: {
    borderRadius: borderRadius.xs,
    backgroundColor: colorScales.gray[300],
    width: '100%',
  },
  barContainerHighlight: {
    backgroundColor: colors.primaryLight,
  },
  barHighlight: {
    backgroundColor: colors.primary,
  },
  value: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    width: 50,
    textAlign: 'right',
  },
  valueHighlight: {
    color: colors.primary,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  channelDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  channelLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  channelValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
});
