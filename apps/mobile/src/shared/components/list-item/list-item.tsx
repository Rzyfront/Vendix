import { View, Text, Pressable, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { colors, spacing, borderRadius, colorScales, typography } from '@/shared/theme';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';

interface ListItemProps extends ViewProps {
  title: string;
  subtitle?: string;
  avatar?: { source?: string | null; name?: string };
  icon?: React.ReactNode;
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  rightText?: React.ReactNode;
  showChevron?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  avatarWrap: {
    marginRight: spacing[3],
  },
  iconWrap: {
    marginRight: spacing[3],
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: spacing[0.5],
  },
  badgeWrap: {
    marginRight: spacing[2],
  },
  rightText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginRight: spacing[2],
  },
  chevron: {
    color: colorScales.gray[400],
    fontSize: typography.fontSize.lg,
  },
  pressedContainer: {
    backgroundColor: colorScales.gray[50],
  },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.blue[50],
    borderRadius: borderRadius.lg,
    marginRight: spacing[2],
  },
  editLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.blue[600],
    fontWeight: typography.fontWeight.medium as any,
  },
  deleteButton: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.lg,
  },
  deleteLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.red[600],
    fontWeight: typography.fontWeight.medium as any,
  },
});

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
  style,
  ...props
}: ListItemProps) {
  const content = (
    <View style={[styles.container, style]} {...props}>
      {avatar && (
        <View style={styles.avatarWrap}>
          <Avatar source={avatar.source} name={avatar.name} size="md" />
        </View>
      )}
      {icon && <View style={styles.iconWrap}>{icon}</View>}
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {badge && (
        <View style={styles.badgeWrap}>
          <Badge label={badge} variant={badgeVariant} size="sm" />
        </View>
      )}
      {rightText && typeof rightText === 'string' && (
        <Text style={styles.rightText}>{rightText}</Text>
      )}
      {showChevron && <Text style={styles.chevron}>›</Text>}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressedContainer}>
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
        <View style={styles.swipeActions}>
          {onEdit && (
            <Pressable onPress={onEdit} style={styles.editButton} hitSlop={8}>
              <Text style={styles.editLabel}>{editLabel}</Text>
            </Pressable>
          )}
          {onDelete && (
            <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
              <Text style={styles.deleteLabel}>{deleteLabel}</Text>
            </Pressable>
          )}
        </View>
      }
      showChevron={false}
    />
  );
}
