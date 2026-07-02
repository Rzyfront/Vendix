import { Pressable, Text, ActivityIndicator, StyleSheet, type ViewStyle } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, spacing, borderRadius, typography } from '@/shared/theme';

interface ExportButtonProps {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  label?: string;
  style?: ViewStyle;
}

// Web parity: <vendix-export-button> — botón compacto con icon download + label "Exportar".
// En web dispara la descarga del reporte (NgRx effect). En mobile el handler es inyectado
// por la pantalla; mientras el backend no exponga el endpoint de export mobile-side,
// las pantallas pueden llamar al mismo endpoint que usa el web (cross-app reference).
const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
});

export function ExportButton({
  onPress,
  loading = false,
  disabled = false,
  label = 'Exportar',
  style,
}: ExportButtonProps) {
  const isDisabled = loading || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        pressed && !isDisabled && { opacity: 0.7 },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
      hitSlop={4}
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.text.secondary} />
      ) : (
        <Icon name="download" size={14} color={colors.text.primary} />
      )}
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
