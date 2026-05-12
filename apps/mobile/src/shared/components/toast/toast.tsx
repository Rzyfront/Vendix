import { View, Text, Pressable, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, borderRadius, colorScales, typography } from '@/shared/theme';
import { useToastStore, type ToastType } from './toast.store';

interface ToastProps extends ViewProps {
  type: ToastType;
  message: string;
  onDismiss?: () => void;
  style?: ViewStyle;
}

const typeConfig: Record<ToastType, { backgroundColor: string; borderLeftColor: string; icon: string }> = {
  success: {
    backgroundColor: colorScales.green[50],
    borderLeftColor: colorScales.green[500],
    icon: '✓',
  },
  error: {
    backgroundColor: colorScales.red[50],
    borderLeftColor: colorScales.red[500],
    icon: '✕',
  },
  warning: {
    backgroundColor: colorScales.amber[50],
    borderLeftColor: colorScales.amber[500],
    icon: '⚠',
  },
  info: {
    backgroundColor: colorScales.blue[50],
    borderLeftColor: colorScales.blue[500],
    icon: 'ℹ',
  },
};

const styles = StyleSheet.create({
  toastItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginHorizontal: spacing[4],
    borderRadius: borderRadius.lg,
    borderLeftWidth: 4,
  },
  icon: {
    fontSize: typography.fontSize.lg,
    marginRight: spacing[3],
  },
  message: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[800],
  },
  dismiss: {
    color: colorScales.gray[400],
    fontSize: typography.fontSize.lg,
  },
  container: {
    position: 'absolute',
    top: spacing[4],
    left: 0,
    right: 0,
    zIndex: 50,
  },
  spacer: {
    marginBottom: spacing[2],
  },
});

function ToastItem({ type, message, onDismiss }: ToastProps) {
  const config = typeConfig[type];

  return (
    <View
      style={[styles.toastItem, { backgroundColor: config.backgroundColor, borderLeftColor: config.borderLeftColor }]}
    >
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={styles.message}>{message}</Text>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <Text style={styles.dismiss}>×</Text>
      </Pressable>
    </View>
  );
}

export function ToastContainer() {
  const insets = useSafeAreaInsets();
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <View
      style={[styles.container, { paddingBottom: insets.top }]}
    >
      {toasts.map((t) => (
        <View key={t.id} style={styles.spacer}>
          <ToastItem
            type={t.type}
            message={t.message}
            onDismiss={() => removeToast(t.id)}
          />
        </View>
      ))}
    </View>
  );
}
