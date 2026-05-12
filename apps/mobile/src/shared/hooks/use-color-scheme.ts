import { useColorScheme as useSystemColorScheme } from 'react-native';

type ColorScheme = 'light' | 'dark' | 'no-preference';

interface UseColorSchemeReturn {
  colorScheme: ColorScheme;
  isDark: boolean;
  isLight: boolean;
}

export function useColorScheme(): UseColorSchemeReturn {
  const systemColorScheme = useSystemColorScheme();

  return {
    colorScheme: systemColorScheme || 'no-preference',
    isDark: systemColorScheme === 'dark',
    isLight: systemColorScheme === 'light',
  };
}
