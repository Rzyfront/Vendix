export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
};

// Border-radius aligned with apps/frontend/src/styles.scss
// --radius-* tokens (md=0.5rem=8, lg=0.75rem=12).
export const borderRadius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 12,
  '2xl': 16,
  full: 9999,
};

export const shadows = {
  sm: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  md: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3 },
  lg: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 5 },
  xl: { shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.1, shadowRadius: 25, elevation: 8 },
};

/**
 * Breakpoints alineados con Tailwind defaults (paridad web):
 *   sm:  640   (phone landscape, tablet portrait)
 *   md:  768   (tablet landscape — breakpoint principal de analytics)
 *   lg:  1024  (desktop)
 *   xl:  1280  (large desktop)
 *
 * Usar con `useWindowDimensions()` para comparaciones reactivas a
 * orientation/resize. NO usar `Dimensions.get('window')` — no se
 * actualiza en runtime.
 */
export const breakpoints = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;
export type Shadows = typeof shadows;
export type Breakpoints = typeof breakpoints;
