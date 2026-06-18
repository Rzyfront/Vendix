import { TextStyle } from 'react-native';

/**
 * Per-weight Inter font family names registered in app/_layout.tsx via
 * @expo-google-fonts/inter.  Use these instead of the generic 'Inter' string
 * so React Native resolves the correct loaded font face.
 */
export const interFonts = {
  regular: 'Inter_400Regular' as TextStyle['fontFamily'],
  medium: 'Inter_500Medium' as TextStyle['fontFamily'],
  semibold: 'Inter_600SemiBold' as TextStyle['fontFamily'],
  bold: 'Inter_700Bold' as TextStyle['fontFamily'],
};

export const typography = {
  /** Use interFonts.* for explicit weight variants (preferred). */
  fontFamily: 'Inter_400Regular' as TextStyle['fontFamily'],
  fontSize: {
    xs: 12,
    sm: 14,
    base: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  fontWeight: {
    normal: '400' as TextStyle['fontWeight'],
    medium: '500' as TextStyle['fontWeight'],
    semibold: '600' as TextStyle['fontWeight'],
    bold: '700' as TextStyle['fontWeight'],
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
};

export type Typography = typeof typography;
