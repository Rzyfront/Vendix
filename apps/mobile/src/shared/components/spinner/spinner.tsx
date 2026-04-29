import { ActivityIndicator, StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';

type SpinnerSize = 'sm' | 'md' | 'lg';

interface SpinnerProps extends ViewProps {
  size?: SpinnerSize;
  color?: string;
  style?: ViewStyle;
}

const sizeMap: Record<SpinnerSize, 'small' | 'large'> = {
  sm: 'small',
  md: 'small',
  lg: 'large',
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function Spinner({ size = 'md', color = '#2F6F4E', style, ...props }: SpinnerProps) {
  return (
    <View style={[styles.container, style]} {...props}>
      <ActivityIndicator size={sizeMap[size]} color={color} />
    </View>
  );
}

export function FullScreenSpinner({ size = 'lg', color = '#2F6F4E' }: Omit<SpinnerProps, 'style'>) {
  return (
    <View style={styles.fullScreen}>
      <Spinner size={size} color={color} />
    </View>
  );
}
