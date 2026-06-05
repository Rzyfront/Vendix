import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '../icon/icon';

interface StatsCardProps extends ViewProps {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  card: {
    width: 150,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 1,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    color: colorScales.gray[500],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 2,
    maxWidth: '85%',
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: colorScales.gray[900],
    marginTop: 2,
  },
  description: {
    fontSize: 9,
    fontWeight: '500',
    color: '#059669',
    marginTop: 1,
  },
  iconContainer: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 1,
    flexWrap: 'nowrap',
  },
  trendText: {
    fontSize: 9,
    fontWeight: '600',
  },
  trendPositive: {
    color: colorScales.green[600],
  },
  trendNegative: {
    color: colorScales.red[600],
  },
  trendLabel: {
    fontSize: 9,
    color: colorScales.gray[400],
    marginLeft: spacing[1],
    flexShrink: 1,
  },
});

export function StatsCard({
  label,
  value,
  icon,
  description,
  iconBg = '#dbeafe',
  iconColor = '#2563eb',
  trend,
  style,
  ...props
}: StatsCardProps) {
  const iconContent =
    typeof icon === 'string'
      ? <Icon name={icon} size={12} color={iconColor} />
      : icon;

  return (
    <View style={[styles.card, style]} {...props}>
      {iconContent && (
        <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
          {iconContent}
        </View>
      )}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={styles.value}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {description && (
        <Text style={styles.description} numberOfLines={1}>
          {description}
        </Text>
      )}
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
            vs mes pasado
          </Text>
        </View>
      )}
    </View>
  );
}
