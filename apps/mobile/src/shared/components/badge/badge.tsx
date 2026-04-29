import { View, Text, StyleSheet, type ViewProps, type ViewStyle } from 'react-native';
import { colorScales, borderRadius, spacing, typography } from '@/shared/theme';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';
type BadgeSize = 'sm' | 'md';

interface BadgeProps extends ViewProps {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  style?: ViewStyle;
}

const variantStyles = StyleSheet.create({
  default: { backgroundColor: colorScales.gray[100] },
  success: { backgroundColor: colorScales.green[100] },
  warning: { backgroundColor: colorScales.amber[100] },
  error: { backgroundColor: colorScales.red[100] },
  info: { backgroundColor: colorScales.blue[100] },
});

const variantTextColors: Record<BadgeVariant, string> = {
  default: colorScales.gray[700],
  success: colorScales.green[700],
  warning: colorScales.amber[700],
  error: colorScales.red[700],
  info: colorScales.blue[700],
};

const sizeContainerStyles = StyleSheet.create({
  sm: { paddingHorizontal: spacing[2], paddingVertical: spacing[0.5] },
  md: { paddingHorizontal: spacing[2.5], paddingVertical: spacing[1] },
});

const sizeTextStyles: Record<BadgeSize, { fontSize: number }> = {
  sm: { fontSize: typography.fontSize.xs },
  md: { fontSize: typography.fontSize.sm },
};

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    fontWeight: typography.fontWeight.medium as any,
  },
});

export function Badge({
  label,
  variant = 'default',
  size = 'md',
  style,
  ...props
}: BadgeProps) {
  return (
    <View
      style={[styles.base, variantStyles[variant], sizeContainerStyles[size], style]}
      {...props}
    >
      <Text style={[{ color: variantTextColors[variant], fontWeight: typography.fontWeight.medium as any }, sizeTextStyles[size]]}>
        {label}
      </Text>
    </View>
  );
}
