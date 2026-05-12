import { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, type ViewProps, type ViewStyle } from 'react-native';
import { colorScales, borderRadius, spacing, colors } from '@/shared/theme';

type SkeletonVariant = 'text' | 'circle' | 'rect';

interface SkeletonProps extends ViewProps {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  style?: ViewStyle;
}

const variantBorderRadii: Record<SkeletonVariant, number> = {
  text: borderRadius.sm,
  circle: borderRadius.full,
  rect: borderRadius.lg,
};

const defaultDimensions: Record<SkeletonVariant, { w: number | string; h: number | string }> = {
  text: { w: '100%', h: 16 },
  circle: { w: 48, h: 48 },
  rect: { w: '100%', h: 100 },
};

export function Skeleton({
  variant = 'rect',
  width,
  height,
  style,
  ...props
}: SkeletonProps) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          opacity,
          width: width ?? defaultDimensions[variant].w,
          height: height ?? defaultDimensions[variant].h,
          backgroundColor: colorScales.gray[200],
          borderRadius: variantBorderRadii[variant],
        } as any,
        style,
      ]}
      {...props}
    />
  );
}

const skeletonCardStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    ...{ shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  circle: {
    marginRight: spacing[3],
  },
  textBlock: {
    flex: 1,
  },
  titleLine: {
    marginBottom: spacing[2],
  },
});

export function SkeletonCard({ style }: { style?: ViewStyle }) {
  return (
    <View style={[skeletonCardStyles.card, style]}>
      <View style={skeletonCardStyles.header}>
        <Skeleton variant="circle" width={48} height={48} style={skeletonCardStyles.circle} />
        <View style={skeletonCardStyles.textBlock}>
          <Skeleton variant="text" width="60%" height={16} style={skeletonCardStyles.titleLine} />
          <Skeleton variant="text" width="40%" height={12} />
        </View>
      </View>
      <Skeleton variant="rect" height={80} />
    </View>
  );
}
