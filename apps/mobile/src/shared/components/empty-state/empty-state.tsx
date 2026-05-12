import { type ReactNode } from 'react';
import { View, Text, StyleSheet, type ViewProps, type ViewStyle } from 'react-native';
import { Button } from '../button/button';
import { Icon } from '../icon/icon';
import { colorScales, spacing, typography } from '@/shared/theme';

interface EmptyStateProps extends ViewProps {
  icon?: ReactNode | string;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[12],
  },
  iconWrapper: {
    marginBottom: spacing[4],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  description: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    textAlign: 'center',
    marginBottom: spacing[6],
    maxWidth: 320,
  },
});

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  style,
  ...props
}: EmptyStateProps) {
  const iconContent = typeof icon === 'string' ? (
    <Icon name={icon} size={42} color={colorScales.gray[400]} />
  ) : icon;

  return (
    <View style={[styles.container, style]} {...props}>
      {iconContent && (
        <View style={styles.iconWrapper}>
          {iconContent}
        </View>
      )}
      <Text style={styles.title}>
        {title}
      </Text>
      {description && (
        <Text style={styles.description}>
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
