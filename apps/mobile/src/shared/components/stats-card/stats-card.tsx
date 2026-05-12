import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Card } from '../card/card';
import { Icon } from '../icon/icon';

interface StatsCardProps extends ViewProps {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  trend?: { value: number; positive: boolean };
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  cardContent: {
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
  },
  label: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  iconContainer: {
    width: 26,
    height: 26,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colorScales.gray[900],
    marginTop: spacing[1.5],
    lineHeight: 22,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[0.5],
    flexWrap: 'nowrap',
  },
  trendText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '600',
  },
  trendPositive: {
    color: colorScales.green[600],
  },
  trendNegative: {
    color: colorScales.red[600],
  },
  trendLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
    marginLeft: spacing[1],
    flexShrink: 1,
  },
});

export function StatsCard({
  label,
  value,
  icon,
  trend,
  style,
  ...props
}: StatsCardProps) {
  const iconContent =
    typeof icon === 'string'
      ? <Icon name={icon} size={14} color={colorScales.green[600]} />
      : icon;

  return (
    <Card style={style} {...props}>
      <View style={styles.cardContent}>
        <View style={styles.topRow}>
          <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
            {label}
          </Text>
          {iconContent && (
            <View style={styles.iconContainer}>
              {iconContent}
            </View>
          )}
        </View>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </Text>
        {trend && (
          <View style={styles.trendRow}>
            <Text
              style={[styles.trendText, trend.positive ? styles.trendPositive : styles.trendNegative]}
              numberOfLines={1}
            >
              {trend.positive ? '+' : ''}
              {trend.value}%
            </Text>
            <Text style={styles.trendLabel} numberOfLines={1}>
              vs anterior
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}
