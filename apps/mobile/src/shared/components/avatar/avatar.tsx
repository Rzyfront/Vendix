import { View, Text, Image, StyleSheet, type ViewProps, type ViewStyle } from 'react-native';
import { colorScales, borderRadius, typography, colors } from '@/shared/theme';

type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps extends ViewProps {
  source?: string | null;
  name?: string;
  size?: AvatarSize;
  style?: ViewStyle;
}

const sizeDimensions: Record<AvatarSize, { width: number; height: number }> = {
  sm: { width: 32, height: 32 },
  md: { width: 40, height: 40 },
  lg: { width: 48, height: 48 },
};

const sizeFontSizes: Record<AvatarSize, number> = {
  sm: typography.fontSize.sm,
  md: typography.fontSize.base,
  lg: typography.fontSize.lg,
};

function getInitials(name: string): string {
  const words = name.trim().split(' ');
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const avatarColors = [
  colorScales.red[500],
  '#F97316',
  colorScales.amber[500],
  '#EAB308',
  '#84CC16',
  colorScales.green[500],
  '#10B981',
  '#14B8A6',
  '#06B6D4',
  '#0EA5E9',
  colorScales.blue[500],
  '#6366F1',
  '#8B5CF6',
  '#A855F7',
  '#D946EF',
  '#EC4899',
  '#F43F5E',
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const styles = StyleSheet.create({
  fallback: {
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontWeight: typography.fontWeight.medium as any,
    color: colors.background,
  },
  image: {
    borderRadius: borderRadius.full,
  },
});

export function Avatar({ source, name = '', size = 'md', style, ...props }: AvatarProps) {
  const initials = getInitials(name || '?');
  const bgColor = getColorFromName(name || '');

  if (source) {
    return (
      <Image
        source={{ uri: source }}
        style={[styles.image, sizeDimensions[size], style] as any}
        {...props}
      />
    );
  }

  return (
    <View
      style={[styles.fallback, sizeDimensions[size], { backgroundColor: bgColor }, style]}
      {...props}
    >
      <Text style={[styles.initials, { fontSize: sizeFontSizes[size] }]}>
        {initials}
      </Text>
    </View>
  );
}
