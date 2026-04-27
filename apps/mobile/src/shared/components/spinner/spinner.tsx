import { ActivityIndicator, View, type ViewProps } from 'react-native';

type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps extends ViewProps {
  size?: SpinnerSize;
  color?: string;
}

const sizeMap: Record<SpinnerSize, 'small' | 'large'> = {
  sm: 'small',
  md: 'small',
  lg: 'large',
};

export function Spinner({ size = 'md', color = '#2F6F4E', className = '', ...props }: SpinnerProps) {
  return (
    <View className={`items-center justify-center ${className}`} {...props}>
      <ActivityIndicator size={sizeMap[size]} color={color} />
    </View>
  );
}

export function FullScreenSpinner({ size = 'lg', color = '#2F6F4E' }: Omit<SpinnerProps, 'className'>) {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Spinner size={size} color={color} />
    </View>
  );
}
