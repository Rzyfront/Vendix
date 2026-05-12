import { useWindowDimensions } from 'react-native';

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

type Breakpoint = keyof typeof BREAKPOINTS;

interface UseResponsiveReturn {
  width: number;
  height: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSmallMobile: boolean;
  breakpoint: Breakpoint | 'base';
}

export function useResponsive(): UseResponsiveReturn {
  const { width, height } = useWindowDimensions();

  const isSmallMobile = width < 375;
  const isMobile = width < BREAKPOINTS.md;
  const isTablet = width >= BREAKPOINTS.md && width < BREAKPOINTS.lg;
  const isDesktop = width >= BREAKPOINTS.lg;

  let breakpoint: Breakpoint | 'base' = 'base';
  if (width >= BREAKPOINTS.xl) breakpoint = 'xl';
  else if (width >= BREAKPOINTS.lg) breakpoint = 'lg';
  else if (width >= BREAKPOINTS.md) breakpoint = 'md';
  else if (width >= BREAKPOINTS.sm) breakpoint = 'sm';

  return {
    width,
    height,
    isMobile,
    isTablet,
    isDesktop,
    isSmallMobile,
    breakpoint,
  };
}
