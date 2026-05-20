import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';

interface PosHeaderProps {
  onOpenDrawer: () => void;
  onOpenHelp: () => void;
  onOpenNotifications: () => void;
  onOpenUserMenu: () => void;
  notificationCount?: number;
  userInitials: string;
}

export function PosHeader({
  onOpenDrawer,
  onOpenHelp,
  onOpenNotifications,
  onOpenUserMenu,
  notificationCount = 0,
  userInitials,
}: PosHeaderProps) {
  return (
    <View style={styles.header}>
      {/* Left: Logo + Title + Badge */}
      <View style={styles.headerLeft}>
        <Pressable onPress={onOpenDrawer} hitSlop={8} style={styles.logoBox}>
          <Icon name="shopping-cart" size={18} color="#FFFFFF" />
        </Pressable>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>POS</Text>
          <Badge label="Punto de venta" variant="success" size="sm" />
        </View>
      </View>

      {/* Right: Help + Notifications + User */}
      <View style={styles.headerRight}>
        {/* Help Icon */}
        <Pressable onPress={onOpenHelp} hitSlop={8} style={styles.iconButton}>
          <Icon name="help-circle" size={20} color={colorScales.gray[500]} />
        </Pressable>

        {/* Notifications Icon */}
        <Pressable onPress={onOpenNotifications} hitSlop={8} style={styles.iconButton}>
          <View style={styles.iconWrapper}>
            <Icon name="bell" size={20} color={colorScales.gray[500]} />
            {notificationCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

        {/* User Avatar */}
        <Pressable onPress={onOpenUserMenu} hitSlop={8} style={styles.userAvatar}>
          <Text style={styles.userInitials}>{userInitials}</Text>
          <View style={styles.userStatusDot} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  logoBox: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    backgroundColor: '#166534',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flexDirection: 'column',
    gap: 2,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingLeft: spacing[1],
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    backgroundColor: colors.error,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  notificationBadgeText: {
    fontSize: 9,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  userInitials: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  userStatusDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F97316',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
});
