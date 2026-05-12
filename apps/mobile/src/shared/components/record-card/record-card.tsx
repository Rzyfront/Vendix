import { type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Avatar } from '../avatar/avatar';
import { Badge } from '../badge/badge';
import { Card } from '../card/card';
import { Icon } from '../icon/icon';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface RecordCardBadge {
  label: string;
  variant?: BadgeVariant;
}

export interface RecordCardDetail {
  label: string;
  value: string | number;
  icon?: string | ReactNode;
}

export interface RecordCardMedia {
  imageUri?: string | null;
  avatarName?: string;
  icon?: string;
}

interface RecordCardProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  media?: RecordCardMedia;
  badges?: RecordCardBadge[];
  details?: RecordCardDetail[];
  footerLabel?: string;
  footerValue?: string | number;
  footerTone?: 'default' | 'success' | 'warning' | 'error';
  onPress?: () => void;
  style?: ViewStyle;
}

const footerToneColor: Record<NonNullable<RecordCardProps['footerTone']>, string> = {
  default: colorScales.gray[900],
  success: colorScales.green[700],
  warning: colorScales.amber[700],
  error: colorScales.red[700],
};

function renderDetailIcon(icon?: string | ReactNode) {
  if (!icon) return null;
  if (typeof icon === 'string') {
    return <Icon name={icon} size={14} color={colorScales.gray[400]} />;
  }
  return icon;
}

function MediaBlock({ media, title }: { media?: RecordCardMedia; title: string }) {
  if (media?.imageUri) {
    return (
      <Image
        source={{ uri: media.imageUri }}
        style={styles.mediaImage}
        resizeMode="cover"
      />
    );
  }

  if (media?.avatarName) {
    return <Avatar name={media.avatarName} size="lg" />;
  }

  return (
    <View style={styles.iconMedia}>
      <Icon name={media?.icon || 'file-text'} size={22} color={colors.primary} />
      <Text style={styles.iconInitial} numberOfLines={1}>
        {title.trim().charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export function RecordCard({
  title,
  subtitle,
  eyebrow,
  media,
  badges = [],
  details = [],
  footerLabel,
  footerValue,
  footerTone = 'default',
  onPress,
  style,
}: RecordCardProps) {
  const cardStyle = style ? { ...styles.card, ...style } : styles.card;

  const content = (
    <Card style={cardStyle}>
      <View style={styles.header}>
        <View style={styles.mediaWrap}>
          <MediaBlock media={media} title={title} />
        </View>

        <View style={styles.titleBlock}>
          {eyebrow && <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text>}
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          {subtitle && <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>}
        </View>

        {badges.length > 0 && (
          <View style={styles.badgeColumn}>
            {badges.slice(0, 2).map((badge) => (
              <Badge
                key={`${badge.label}-${badge.variant || 'default'}`}
                label={badge.label}
                variant={badge.variant || 'default'}
                size="sm"
              />
            ))}
          </View>
        )}
      </View>

      {details.length > 0 && (
        <View style={styles.details}>
          {details.map((detail) => (
            <View key={`${detail.label}-${detail.value}`} style={styles.detailItem}>
              <View style={styles.detailLabelRow}>
                {renderDetailIcon(detail.icon)}
                <Text style={styles.detailLabel} numberOfLines={1}>{detail.label}</Text>
              </View>
              <Text style={styles.detailValue} numberOfLines={1}>{detail.value}</Text>
            </View>
          ))}
        </View>
      )}

      {footerValue !== undefined && (
        <View style={styles.footer}>
          {footerLabel && <Text style={styles.footerLabel}>{footerLabel}</Text>}
          <Text style={[styles.footerValue, { color: footerToneColor[footerTone] }]} numberOfLines={1}>
            {footerValue}
          </Text>
        </View>
      )}
    </Card>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: '100%',
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.995 }],
  },
  card: {
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
  },
  mediaWrap: {
    width: 56,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaImage: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
  },
  iconMedia: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.green[50],
    borderWidth: 1,
    borderColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInitial: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.green[800],
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing[0.5],
  },
  title: {
    fontSize: typography.fontSize.base,
    lineHeight: 21,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: {
    marginTop: spacing[1],
    fontSize: typography.fontSize.sm,
    lineHeight: 18,
    color: colorScales.gray[500],
  },
  badgeColumn: {
    maxWidth: 112,
    alignItems: 'flex-end',
    gap: spacing[1],
  },
  details: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  detailItem: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 126,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  detailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    marginTop: spacing[0.5],
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[800],
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    backgroundColor: colorScales.gray[50],
  },
  footerLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  footerValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
});
