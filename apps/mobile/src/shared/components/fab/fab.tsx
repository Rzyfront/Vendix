import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, colorScales, shadows, spacing, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

type FabPosition = 'bottom-right' | 'bottom-center';

interface FabProps {
  onPress: () => void;
  icon: string;
  position?: FabPosition;
  accessibilityLabel?: string;
  style?: ViewStyle;
  disabled?: boolean;
}

export function Fab({
  onPress,
  icon,
  position = 'bottom-right',
  accessibilityLabel,
  style,
  disabled = false,
}: FabProps) {
  return (
    <View pointerEvents="box-none" style={[styles.wrapper, positionStyles[position]]}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'Floating action button'}
        style={({ pressed }) => [
          styles.fab,
          pressed && styles.fabPressed,
          disabled && styles.disabled,
          style,
        ]}
      >
        <Icon name={icon} size={24} color={colors.background} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
  },
  fab: {
    ...shadows.lg,
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colorScales.green[700],
  },
  fabPressed: {
    transform: [{ scale: 0.95 }],
    backgroundColor: colorScales.green[700],
  },
  disabled: {
    opacity: 0.5,
  },
});

const positionStyles = StyleSheet.create({
  'bottom-right': {
    right: spacing[5],
    bottom: spacing[5],
  },
  'bottom-center': {
    alignSelf: 'center',
    bottom: spacing[5],
  },
});

export type { FabProps, FabPosition };