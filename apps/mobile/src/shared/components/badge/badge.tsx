import { View, Text, StyleSheet, type ViewProps, type ViewStyle } from 'react-native';
import { colorScales, borderRadius, spacing, typography, colors } from '@/shared/theme';

type BadgeVariant =
  | 'default'
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'service';

type BadgeSize = 'xsm' | 'xs' | 'sm' | 'md';

type BadgeStyle = 'solid' | 'outline';

interface BadgeProps extends ViewProps {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  badgeStyle?: BadgeStyle;
  style?: ViewStyle;
}

// Solid backgrounds per variant
const variantBgSolid: Record<BadgeVariant, string> = {
  default: colorScales.gray[100],
  neutral: colorScales.gray[200],
  primary: colors.primary,
  success: colorScales.green[100],
  warning: colorScales.amber[100],
  error: colorScales.red[100],
  info: colorScales.blue[100],
  service: colorScales.purple[100] ?? '#F3E8FF',
};

// Outline styles = transparent bg + colored border + colored text
const variantBgOutline: Record<BadgeVariant, string> = {
  default: 'transparent',
  neutral: 'transparent',
  primary: 'transparent',
  success: 'transparent',
  warning: 'transparent',
  error: 'transparent',
  info: 'transparent',
  service: 'transparent',
};

const variantBorderOutline: Record<BadgeVariant, string> = {
  default: colorScales.gray[300],
  neutral: colorScales.gray[400],
  primary: colors.primary,
  success: colorScales.green[600] ?? '#16a34a',
  warning: colorScales.amber[600] ?? '#d97706',
  error: colorScales.red[600] ?? '#dc2626',
  info: colorScales.blue[600] ?? '#2563eb',
  service: colorScales.purple[500] ?? '#a855f7',
};

const variantTextSolid: Record<BadgeVariant, string> = {
  default: colorScales.gray[700],
  neutral: colorScales.gray[800],
  primary: colors.background,
  success: colorScales.green[700] ?? '#15803d',
  warning: colorScales.amber[700] ?? '#b45309',
  error: colorScales.red[700] ?? '#b91c1c',
  info: colorScales.blue[700] ?? '#1d4ed8',
  service: colorScales.purple[700] ?? '#7e22ce',
};

const variantTextOutline: Record<BadgeVariant, string> = {
  default: colorScales.gray[700],
  neutral: colorScales.gray[700],
  primary: colors.primary,
  success: colorScales.green[700] ?? '#15803d',
  warning: colorScales.amber[700] ?? '#b45309',
  error: colorScales.red[700] ?? '#b91c1c',
  info: colorScales.blue[700] ?? '#1d4ed8',
  service: colorScales.purple[700] ?? '#7e22ce',
};

const sizeContainerStyles = StyleSheet.create({
  xsm: { paddingHorizontal: spacing[1.5], paddingVertical: 1 },
  xs: { paddingHorizontal: spacing[2], paddingVertical: 2 },
  sm: { paddingHorizontal: spacing[2], paddingVertical: spacing[0.5] },
  md: { paddingHorizontal: spacing[2.5], paddingVertical: spacing[1] },
});

const sizeTextStyles: Record<BadgeSize, { fontSize: number }> = {
  xsm: { fontSize: 10 },
  xs: { fontSize: 11 },
  sm: { fontSize: typography.fontSize.xs },
  md: { fontSize: typography.fontSize.sm },
};

export function Badge({
  label,
  variant = 'default',
  size = 'md',
  badgeStyle = 'solid',
  style,
  ...props
}: BadgeProps) {
  const bg = badgeStyle === 'outline' ? variantBgOutline[variant] : variantBgSolid[variant];
  const text = badgeStyle === 'outline' ? variantTextOutline[variant] : variantTextSolid[variant];
  const borderColor = badgeStyle === 'outline' ? variantBorderOutline[variant] : 'transparent';

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: bg, borderColor, borderWidth: badgeStyle === 'outline' ? 1 : 0 },
        sizeContainerStyles[size],
        style,
      ]}
      {...props}
    >
      <Text
        style={[
          {
            color: text,
            fontWeight: typography.fontWeight.medium as any,
            fontFamily: typography.fontFamily,
          },
          sizeTextStyles[size],
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
});

export type { BadgeProps, BadgeVariant, BadgeSize, BadgeStyle };