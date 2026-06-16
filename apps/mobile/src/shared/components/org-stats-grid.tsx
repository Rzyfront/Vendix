import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

interface OrgStatsGridProps {
  stats: Array<{
    label: string;
    value: string | number;
    icon?: string;
    color?: string;
    trend?: { direction: 'up' | 'down' | 'flat'; value: string };
    subText?: string;
  }>;
  columns?: 2 | 3 | 4;
  style?: StyleProp<ViewStyle>;
}

export function OrgStatsGrid({ stats, columns = 2, style }: OrgStatsGridProps) {
  return (
    <View style={[styles.grid, { gap: spacing[3] }, style]}>
      {stats.map((s, i) => (
        <Card key={i} style={StyleSheet.flatten([styles.card, { flex: 1 / columns }] as any)}>
          <View style={styles.cardHeader}>
            {s.icon ? (
              <View
                style={[
                  styles.iconCircle,
                  { backgroundColor: (s.color ?? colors.primary) + '15' },
                ]}
              >
                <Icon name={s.icon} size={16} color={s.color ?? colors.primary} />
              </View>
            ) : null}
            {s.trend ? (
              <View style={styles.trendRow}>
                <Icon
                  name={
                    s.trend.direction === 'up'
                      ? 'trending-up'
                      : s.trend.direction === 'down'
                      ? 'trending-down'
                      : 'minus'
                  }
                  size={12}
                  color={
                    s.trend.direction === 'up'
                      ? colors.success
                      : s.trend.direction === 'down'
                      ? colors.error
                      : colorScales.gray[400]
                  }
                />
                <Text style={styles.trendText}>{s.trend.value}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.value}>{s.value}</Text>
          <Text style={styles.label} numberOfLines={2}>
            {s.label}
          </Text>
          {s.subText ? (
            <Text style={styles.subText} numberOfLines={1}>
              {s.subText}
            </Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    minWidth: 140,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trendText: {
    fontSize: 11,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium,
    marginLeft: 2,
  },
  value: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  label: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  subText: {
    fontSize: 10,
    color: colorScales.gray[400],
    marginTop: 2,
  },
});
