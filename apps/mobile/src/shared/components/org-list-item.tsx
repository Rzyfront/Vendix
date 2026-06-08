import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgBadge } from './org-badge';

interface OrgListItemProps {
  title: string;
  subtitle?: string;
  description?: string;
  leftIcon?: string;
  leftIconColor?: string;
  rightBadge?: { label: string; variant?: 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'primary' | 'muted' };
  rightValue?: string;
  rightMeta?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  chevron?: boolean;
}

export function OrgListItem({
  title,
  subtitle,
  description,
  leftIcon,
  leftIconColor,
  rightBadge,
  rightValue,
  rightMeta,
  onPress,
  style,
  chevron = true,
}: OrgListItemProps) {
  const Container: any = onPress ? Card : View;
  return (
    <Container
      style={[styles.card, style]}
      onPress={onPress as any}
      activeOpacity={0.7}
    >
      <View style={styles.row}>
        {leftIcon ? (
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: (leftIconColor ?? colors.primary) + '15' },
            ]}
          >
            <Icon name={leftIcon} size={18} color={leftIconColor ?? colors.primary} />
          </View>
        ) : null}
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
          {description ? <Text style={styles.description} numberOfLines={2}>{description}</Text> : null}
        </View>
        <View style={styles.right}>
          {rightBadge ? <OrgBadge {...rightBadge} /> : null}
          {rightValue ? <Text style={styles.rightValue} numberOfLines={1}>{rightValue}</Text> : null}
          {rightMeta ? <Text style={styles.rightMeta} numberOfLines={1}>{rightMeta}</Text> : null}
          {chevron && onPress ? (
            <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
          ) : null}
        </View>
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  description: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    marginTop: 2,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  rightValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  rightMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
});
