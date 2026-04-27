import { View, Text, type ViewProps } from 'react-native';
import { Button } from '../button/button';

interface EmptyStateProps extends ViewProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
  ...props
}: EmptyStateProps) {
  return (
    <View
      className={`flex-1 items-center justify-center px-8 py-12 ${className}`}
      {...props}
    >
      {icon && (
        <View className="mb-4 text-gray-400">
          {icon}
        </View>
      )}
      <Text className="text-lg font-semibold text-gray-900 text-center mb-2">
        {title}
      </Text>
      {description && (
        <Text className="text-sm text-gray-500 text-center mb-6 max-w-xs">
          {description}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant="primary"
          size="md"
        />
      )}
    </View>
  );
}
