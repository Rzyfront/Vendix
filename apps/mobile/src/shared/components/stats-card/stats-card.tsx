import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Card } from '../card/card';

interface StatsCardProps extends ViewProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; positive: boolean };
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  cardContent: {
    padding: spacing[4],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontWeight: '500',
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: '700',
    color: colorScales.gray[900],
    marginTop: spacing[2],
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[1],
  },
  trendText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
  },
  trendPositive: {
    color: colorScales.green[600],
  },
  trendNegative: {
    color: colorScales.red[600],
  },
  trendLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[400],
    marginLeft: spacing[1],
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
  return (
    <Card style={style} {...props}>
      <View style={styles.cardContent}>
        <View style={styles.topRow}>
          <Text style={styles.label}>{label}</Text>
          {icon && (
            <View style={styles.iconContainer}>
              {icon}
            </View>
          )}
        </View>
        <Text style={styles.value}>{value}</Text>
        {trend && (
          <View style={styles.trendRow}>
            <Text style={[styles.trendText, trend.positive ? styles.trendPositive : styles.trendNegative]}>
              {trend.positive ? '+' : ''}
              {trend.value}%
            </Text>
            <Text style={styles.trendLabel}>vs last period</Text>
          </View>
        )}
      </View>
    </Card>
  );
}
