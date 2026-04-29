import { ActivityIndicator, Text, Pressable, View, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import { colorScales, spacing, borderRadius, typography, colors } from '@/shared/theme';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  containerStyle?: ViewStyle;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const baseStyle = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colorScales.green[600],
  } as ViewStyle,
  primaryPressed: {
    backgroundColor: colorScales.green[700],
  } as ViewStyle,
  primaryText: {
    color: colors.background,
  } as TextStyle,
  secondary: {
    backgroundColor: colorScales.gray[100],
  } as ViewStyle,
  secondaryPressed: {
    backgroundColor: colorScales.gray[200],
  } as ViewStyle,
  secondaryText: {
    color: colorScales.gray[900],
  } as TextStyle,
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  } as ViewStyle,
  outlinePressed: {
    backgroundColor: colorScales.gray[50],
  } as ViewStyle,
  outlineText: {
    color: colorScales.gray[700],
  } as TextStyle,
  ghost: {
    backgroundColor: 'transparent',
  } as ViewStyle,
  ghostPressed: {
    backgroundColor: colorScales.gray[100],
  } as ViewStyle,
  ghostText: {
    color: colorScales.gray[700],
  } as TextStyle,
  destructive: {
    backgroundColor: colorScales.red[600],
  } as ViewStyle,
  destructivePressed: {
    backgroundColor: colorScales.red[700],
  } as ViewStyle,
  destructiveText: {
    color: colors.background,
  } as TextStyle,
});

const sizeStyles = StyleSheet.create({
  sm: {
    height: 32,
    paddingHorizontal: spacing[3],
  } as ViewStyle,
  smText: {
    fontSize: typography.fontSize.sm,
  } as TextStyle,
  md: {
    height: 40,
    paddingHorizontal: spacing[4],
  } as ViewStyle,
  mdText: {
    fontSize: typography.fontSize.base,
  } as TextStyle,
  lg: {
    height: 48,
    paddingHorizontal: spacing[6],
  } as ViewStyle,
  lgText: {
    fontSize: typography.fontSize.lg,
  } as TextStyle,
});

const spinnerColors: Record<ButtonVariant, string> = {
  primary: colors.background,
  secondary: colorScales.gray[700],
  outline: colorScales.gray[700],
  ghost: colorScales.gray[700],
  destructive: colors.background,
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  containerStyle,
  leftIcon,
  rightIcon,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  const sizeTextKey = `${size}Text` as keyof typeof sizeStyles;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        baseStyle.button,
        variantStyles[variant],
        sizeStyles[size],
        pressed && variantStyles[`${variant}Pressed` as keyof typeof variantStyles],
        isDisabled && baseStyle.disabled,
        fullWidth && { width: '100%' },
        style,
        containerStyle,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={spinnerColors[variant]} />
      ) : (
        <View style={baseStyle.contentRow}>
          {leftIcon && <View style={{ marginRight: spacing[2] }}>{leftIcon}</View>}
          <Text style={[{ fontWeight: '500' as TextStyle['fontWeight'] }, sizeStyles[sizeTextKey], variantStyles[`${variant}Text` as keyof typeof variantStyles]]}>
            {title}
          </Text>
          {rightIcon && <View style={{ marginLeft: spacing[2] }}>{rightIcon}</View>}
        </View>
      )}
    </Pressable>
  );
}

export type { ButtonProps, ButtonVariant, ButtonSize };
