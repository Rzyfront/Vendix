import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography, interFonts } from '@/shared/theme';
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
    width: 160,
    height: 90,
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: 12,
    position: 'relative',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    fontFamily: interFonts.bold,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    maxWidth: '75%',
  },
  value: {
    fontSize: 20,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
    lineHeight: 24,
    marginTop: 2,
  },
  description: {
    fontSize: 10,
    fontFamily: interFonts.medium,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  iconContainer: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    flexWrap: 'nowrap',
  },
  trendText: {
    fontSize: 10,
    fontFamily: interFonts.bold,
  },
  trendPositive: {
    color: colorScales.green[600],
  },
  trendNegative: {
    color: colorScales.red[600],
  },
  trendLabel: {
    fontSize: 10,
    fontFamily: interFonts.medium,
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
      ? <Icon name={icon} size={13} color={iconColor} />
      : icon;

  return (
    <View style={[styles.card, style]} {...props}>
      {iconContent && (
        <View style={[styles.iconContainer, { backgroundColor: iconBg }]}>
          {iconContent}
        </View>
      )}
      <View style={styles.content}>
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
    </View>
  );
}

