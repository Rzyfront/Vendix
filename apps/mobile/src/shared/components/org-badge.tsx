import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle, type TextStyle } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

type Variant = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary' | 'muted';

interface OrgBadgeProps {
  label: string;
  variant?: Variant;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const variantStyles: Record<Variant, { bg: string; fg: string }> = {
  neutral: { bg: colorScales.gray[100], fg: colorScales.gray[700] },
  success: { bg: colorScales.green[100], fg: colorScales.green[700] },
  warning: { bg: colorScales.amber[100], fg: colorScales.amber[700] },
  error: { bg: colorScales.red[100], fg: colorScales.red[700] },
  info: { bg: colorScales.blue[100], fg: colorScales.blue[700] },
  primary: { bg: colorScales.green[100], fg: colorScales.green[800] },
  muted: { bg: colorScales.gray[50], fg: colorScales.gray[500] },
};

export function OrgBadge({ label, variant = 'neutral', size = 'sm', style, textStyle }: OrgBadgeProps) {
  const v = variantStyles[variant];
  return (
    <View
      style={[
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        { backgroundColor: v.bg },
        style,
      ]}
    >
      <Text
        style={[
          size === 'sm' ? styles.textSm : styles.textMd,
          { color: v.fg },
          textStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: borderRadius.full,
  },
  sm: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  textSm: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
  },
  textMd: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
});
