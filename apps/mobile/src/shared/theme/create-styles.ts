import { StyleSheet } from 'react-native';
import type { Theme } from './theme.context';
import { colors, colorScales } from './colors';
import { spacing, borderRadius, shadows } from './spacing';
import { typography } from './typography';

export type DesignTokens = {
  colors: typeof colors;
  spacing: typeof spacing;
  borderRadius: typeof borderRadius;
  shadows: typeof shadows;
  typography: typeof typography;
  colorScales: typeof colorScales;
};

const tokens: DesignTokens = {
  colors,
  spacing,
  borderRadius,
  shadows,
  typography,
  colorScales,
};

export function createStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: Theme, tokens: DesignTokens) => T,
) {
  return factory;
}

export { tokens };
