import { useEffect } from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  withRepeat,
  withTiming,
  useSharedValue,
  withSequence,
} from 'react-native-reanimated';

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
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800 }),
        withTiming(0.3, { duration: 800 })
      ),
      -1,
      false
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: opacity.value,
    };
  });

  const variantStyles: Record<SkeletonVariant, string> = {
    text: 'rounded',
    circle: 'rounded-full',
    rect: 'rounded-lg',
  };

  const defaultDimensions: Record<SkeletonVariant, { width: number | string; height: number | string }> = {
    text: { width: '100%', height: 16 },
    circle: { width: 48, height: 48 },
    rect: { width: '100%', height: 100 },
  };

  return (
    <Animated.View
      className={`bg-gray-200 ${variantStyles[variant]} ${className}`}
      style={[
        animatedStyle,
        {
          width: width ?? defaultDimensions[variant].width,
          height: height ?? defaultDimensions[variant].height,
        },
      ]}
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
