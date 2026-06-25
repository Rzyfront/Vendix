import { type ReactNode, useEffect } from 'react';
import { View, Text, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colorScales, spacing, borderRadius, typography, interFonts, motion } from '@/shared/theme';
import { Icon } from '../icon/icon';

interface StatsCardProps extends ViewProps {
  label: string;
  value: string | number;
  icon?: ReactNode | string;
  description?: string;
  iconBg?: string;
  iconColor?: string;
  trend?: { value: number; positive: boolean };
  /** When true, renders 3 skeleton bars instead of value/description. */
  loading?: boolean;
  /**
   * Index used to stagger entrance animations across a `StatsGrid`.
   * 40ms delay per index — los primeros 8 cards terminan de entrar en ~320ms.
   * Si no se provee, no hay delay (entrada inmediata).
   */
  enterIndex?: number;
  /** Disable entrance animation (ej: cuando se quiere render inmediato en re-mounts). */
  animateEntrance?: boolean;
  style?: ViewStyle;
}

const ENTER_STAGGER_MS = 40;
const ENTER_BASE_MS = 60;
const SLIDE_OFFSET = 8;

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
  skeleton: {
    backgroundColor: colorScales.gray[100],
    borderRadius: 4,
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
  loading,
  enterIndex = 0,
  animateEntrance = true,
  style,
  ...props
}: StatsCardProps) {
  const iconContent =
    typeof icon === 'string'
      ? <Icon name={icon} size={13} color={iconColor} />
      : icon;

  // Entrance animation — fade-in + small slide-up, staggered by index.
  const opacity = useSharedValue(animateEntrance ? 0 : 1);
  const translateY = useSharedValue(animateEntrance ? SLIDE_OFFSET : 0);

  useEffect(() => {
    if (!animateEntrance) return;
    const delay = ENTER_BASE_MS + enterIndex * ENTER_STAGGER_MS;
    opacity.value = withDelay(
      delay,
      withTiming(1, {
        duration: motion.duration.base,
        easing: motion.easing.standard,
      }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, {
        duration: motion.duration.base,
        easing: motion.easing.standard,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (loading) {
    return (
      <Animated.View style={[styles.card, animatedStyle, style]} {...props}>
        <View style={styles.content}>
          <View style={[styles.skeleton, { height: 10, width: '50%' }]} />
          <View style={[styles.skeleton, { height: 20, width: '75%', marginTop: 4 }]} />
          <View style={[styles.skeleton, { height: 10, width: '40%', marginTop: 4 }]} />
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[styles.card, animatedStyle, style]} {...props}>
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
    </Animated.View>
  );
}
