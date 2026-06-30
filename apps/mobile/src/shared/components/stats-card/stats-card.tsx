import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colorScales, spacing, borderRadius, typography, interFonts } from '@/shared/theme';
import { Icon } from '../icon/icon';

interface StatsCardProps extends ViewProps {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
  /**
   * Secondary highlighted text rendered below the value with brand color.
   * Mirrors the web `app-stats` `smallText` prop (rendered as `text-emerald-500` on mobile).
   */
  smallText?: string;
  smallTextColor?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  style?: ViewStyle;
  /**
   * Render without background, border, and shadow. Use when the card sits
   * inside a parent container that already provides visual framing
   * (e.g. a wider grouped card or a transparent stats row).
   */
  bare?: boolean;
}

const styles = StyleSheet.create({
  card: {
    minWidth: 160,
    height: 92,
    backgroundColor: '#fff',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: 14,
    paddingVertical: 10,
    position: 'relative',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardBare: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
    paddingHorizontal: 0,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 40, // space for the icon
  },
  label: {
    fontSize: 10,
    fontFamily: interFonts.bold,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 20,
    fontFamily: interFonts.bold,
    color: colorScales.gray[900],
    lineHeight: 24,
    marginTop: 4,
  },
  description: {
    fontSize: 11,
    fontFamily: interFonts.medium,
    color: '#10b981', // emerald-500 — matches web `text-emerald-500`
    marginTop: 2,
  },
  smallText: {
    fontSize: 11,
    fontFamily: interFonts.medium,
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
  iconContainerBare: {
    // In bare mode the icon sits inside its colored circle but the card
    // itself has no chrome — keep the circle visible so the icon color
    // and bg still communicate meaning.
    top: 8,
    right: 0,
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
  smallText,
  smallTextColor = '#10b981',
  iconBg = '#dbeafe',
  iconColor = '#2563eb',
  trend,
  style,
  bare = false,
  ...props
}: StatsCardProps) {
  const iconContent =
    typeof icon === 'string'
      ? <Icon name={icon} size={13} color={iconColor} />
      : icon;

  return (
    <View
      style={[
        styles.card,
        bare && styles.cardBare,
        style,
      ]}
      {...props}
    >
      {iconContent && (
        <View
          style={[
            styles.iconContainer,
            { backgroundColor: iconBg },
            bare && styles.iconContainerBare,
          ]}
        >
          {iconContent}
        </View>
      )}
      <View style={styles.content}>
        <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
          {label}
        </Text>
        <Text
          style={styles.value}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
        >
          {value}
        </Text>
        {description && (
          <Text style={styles.description} numberOfLines={1}>
            {description}
          </Text>
        )}
        {smallText && (
          <Text
            style={[styles.smallText, { color: smallTextColor }]}
            numberOfLines={1}
          >
            {smallText}
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

