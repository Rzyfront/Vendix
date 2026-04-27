import { View, Text, Pressable, type ViewProps } from 'react-native';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';

interface ListItemProps extends ViewProps {
  title: string;
  subtitle?: string;
  avatar?: { source?: string | null; name?: string };
  icon?: React.ReactNode;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  rightText?: string;
  showChevron?: boolean;
  onPress?: () => void;
}

export function ListItem({
  title,
  subtitle,
  avatar,
  icon,
  badge,
  badgeVariant = 'default',
  rightText,
  showChevron = false,
  onPress,
  className = '',
  ...props
}: ListItemProps) {
  const content = (
    <View
      className={`flex-row items-center px-4 py-3 bg-white border-b border-gray-100 ${className}`}
      {...props}
    >
      {avatar && (
        <View className="mr-3">
          <Avatar source={avatar.source} name={avatar.name} size="md" />
        </View>
      )}
      {icon && <View className="mr-3">{icon}</View>}
      <View className="flex-1">
        <Text className="text-base font-medium text-gray-900">{title}</Text>
        {subtitle && <Text className="text-sm text-gray-500 mt-0.5">{subtitle}</Text>}
      </View>
      {badge && (
        <View className="mr-2">
          <Badge label={badge} variant={badgeVariant} size="sm" />
        </View>
      )}
      {rightText && (
        <Text className="text-sm text-gray-500 mr-2">{rightText}</Text>
      )}
      {showChevron && <Text className="text-gray-400 text-lg">›</Text>}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} className="active:bg-gray-50">
        {content}
      </Pressable>
    );
  }

  return content;
}

interface SwipeableListItemProps extends ListItemProps {
  onEdit?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  editLabel?: string;
}

export function SwipeableListItem({
  onEdit,
  onDelete,
  deleteLabel = 'Delete',
  editLabel = 'Edit',
  ...props
}: SwipeableListItemProps) {
  return (
    <ListItem
      {...props}
      rightText={
        <View className="flex-row items-center">
          {onEdit && (
            <Pressable
              onPress={onEdit}
              className="px-3 py-2 bg-blue-50 rounded-lg mr-2"
              hitSlop={8}
            >
              <Text className="text-sm text-blue-600 font-medium">{editLabel}</Text>
            </Pressable>
          )}
          {onDelete && (
            <Pressable
              onPress={onDelete}
              className="px-3 py-2 bg-red-50 rounded-lg"
              hitSlop={8}
            >
              <Text className="text-sm text-red-600 font-medium">{deleteLabel}</Text>
            </Pressable>
          )}
        </View>
      }
      showChevron={false}
    />
  );
}
