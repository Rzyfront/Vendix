import { useEffect, useRef } from 'react';
import { View, Animated, type ViewProps } from 'react-native';

type SkeletonVariant = 'text' | 'circle' | 'rect';

interface SkeletonProps extends ViewProps {
  variant?: SkeletonVariant;
  width?: number | string;
  height?: number | string;
  className?: string;
}

export function Skeleton({
  variant = 'rect',
  width,
  height,
  className = '',
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

  const variantStyles: Record<SkeletonVariant, string> = {
    text: 'rounded',
    circle: 'rounded-full',
    rect: 'rounded-lg',
  };

  const defaultDimensions: Record<SkeletonVariant, { w: number | string; h: number | string }> = {
    text: { w: '100%', h: 16 },
    circle: { w: 48, h: 48 },
    rect: { w: '100%', h: 100 },
  };

  return (
    <Animated.View
      className={`bg-gray-200 ${variantStyles[variant]} ${className}`}
      style={[{ opacity, width: width ?? defaultDimensions[variant].w, height: height ?? defaultDimensions[variant].h } as any]}
      {...props}
    />
  );
}

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className = '' }: SkeletonCardProps) {
  return (
    <View className={`bg-white rounded-xl p-4 shadow-sm ${className}`}>
      <View className="flex-row items-center mb-4">
        <Skeleton variant="circle" width={48} height={48} className="mr-3" />
        <View className="flex-1">
          <Skeleton variant="text" width="60%" height={16} className="mb-2" />
          <Skeleton variant="text" width="40%" height={12} />
        </View>
      </View>
      <Skeleton variant="rect" height={80} />
    </View>
  );
}
