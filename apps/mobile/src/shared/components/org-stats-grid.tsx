import React from 'react';
import { View, Text, StyleSheet, ScrollView, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

interface OrgStatItem {
  label: string;
  value: string | number;
  icon?: string;
  /** Color del ícono (hex). El background se genera al 15% de opacity. */
  color?: string;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string };
  subText?: string;
}

interface OrgStatsGridProps {
  stats: OrgStatItem[];
  /** Layout: 'scroll' = scroll horizontal de 160px (mobile, igual que web). 'grid' = grid de 2/3/4 columnas. */
  layout?: 'scroll' | 'grid';
  columns?: 2 | 3 | 4;
  style?: StyleProp<ViewStyle>;
}

/**
 * @deprecated Use `StatsGrid` + `StatsCard` from `@/shared/components/stats-card/stats-grid`
 *             instead. The horizontal scroll layout used by the dashboard, audit,
 *             domains, orders, payroll, subscriptions, reports and fiscal screens
 *             is now the canonical pattern; `OrgStatsGrid` is retained only because
 *             `config/payment-methods.tsx` explicitly requests `layout="grid"`.
 *             Will be removed once payment-methods.tsx is migrated.
 *
 * Stats grid mobile-first, espejo de `StatsComponent` + `.stats-container` de la web.
 *
 *   • En mobile (`layout="scroll"`, default) es un **scroll horizontal** de
 *     cards de 160 px de ancho, sticky-top. Card layout: ícono en la
 *     esquina superior derecha, título uppercase small, valor xl, subtext xs.
 *   • En desktop (`layout="grid"`) es un grid de `columns` columnas.
 */
export function OrgStatsGrid({ stats, layout = 'scroll', columns = 4, style }: OrgStatsGridProps) {
  if (layout === 'grid') {
    return (
      <View style={[styles.grid, { gap: spacing[3] }, style]}>
        {stats.map((s, i) => (
          <StatCard key={i} stat={s} layout="grid" columns={columns} />
        ))}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { gap: spacing[3] }, style]}
      style={styles.scrollRoot}
    >
      {stats.map((s, i) => (
        <View key={i} style={styles.scrollCell}>
          <StatCard stat={s} layout="scroll" columns={columns} />
        </View>
      ))}
    </ScrollView>
  );
}

function StatCard({
  stat,
  layout,
  columns,
}: {
  stat: OrgStatItem;
  layout: 'scroll' | 'grid';
  columns: 2 | 3 | 4;
}) {
  const color = stat.color ?? colors.primary;
  const cardStyle = layout === 'grid'
    ? StyleSheet.flatten([styles.card, { flex: 1 / columns } as any])
    : styles.card;

  return (
    <Card style={cardStyle}>
      <View style={styles.cardHeader}>
        {stat.trend ? (
          <View style={styles.trendRow}>
            <Icon
              name={
                stat.trend.direction === 'up'
                  ? 'trending-up'
                  : stat.trend.direction === 'down'
                    ? 'trending-down'
                    : 'minus'
              }
              size={12}
              color={
                stat.trend.direction === 'up'
                  ? colors.success
                  : stat.trend.direction === 'down'
                    ? colors.error
                    : colorScales.gray[400]
              }
            />
            <Text style={styles.trendText}>{stat.trend.value}</Text>
          </View>
        ) : (
          <View />
        )}
        {stat.icon ? (
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: color + '15' },
            ]}
          >
            <Icon name={stat.icon} size={18} color={color} />
          </View>
        ) : null}
      </View>
      <Text style={styles.value} numberOfLines={1}>
        {stat.value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {stat.label}
      </Text>
      {stat.subText ? (
        <Text style={styles.subText} numberOfLines={1}>
          {stat.subText}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  scrollRoot: {
    overflow: 'visible',
  },
  scrollContent: {
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[1],
  },
  scrollCell: {
    width: 168,
    flexShrink: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    minHeight: 96,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
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
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 2,
  },
  subText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.medium,
    color: colors.success,
    marginTop: 2,
  },
});
