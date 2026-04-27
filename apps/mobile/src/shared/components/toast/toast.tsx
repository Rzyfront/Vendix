import { View, Text, Pressable, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, type ToastType } from './toast.store';

interface ToastProps extends ViewProps {
  type: ToastType;
  message: string;
  onDismiss?: () => void;
}

const typeConfig: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'bg-green-50',
    border: 'border-green-500',
    icon: '✓',
  },
  error: {
    bg: 'bg-red-50',
    border: 'border-red-500',
    icon: '✕',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-500',
    icon: '⚠',
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-500',
    icon: 'ℹ',
  },
};

function ToastItem({ type, message, onDismiss }: ToastProps) {
  const config = typeConfig[type];

  return (
    <View
      className={`
        flex-row items-center px-4 py-3 mx-4 rounded-lg border-l-4
        ${config.bg} ${config.border}
      `}
    >
      <Text className="text-lg mr-3">{config.icon}</Text>
      <Text className="flex-1 text-sm text-gray-800">{message}</Text>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <Text className="text-gray-400 text-lg">×</Text>
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
      className="absolute top-4 left-0 right-0 z-50"
      style={{ paddingBottom: insets.top }}
    >
      {toasts.map((t) => (
        <View key={t.id} className="mb-2">
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
