import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface PosHeaderProps {
  onOpenDrawer: () => void;
  onOpenSearch?: () => void;
  onOpenNotifications: () => void;
  onOpenUserMenu: () => void;
  notificationCount?: number;
  userInitials: string;
  title?: string;
  breadcrumb?: string;
}

export function PosHeader({
  onOpenDrawer,
  onOpenSearch,
  onOpenNotifications,
  onOpenUserMenu,
  notificationCount = 0,
  userInitials,
  title = 'Punto de venta',
  breadcrumb,
}: PosHeaderProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing[2] }]}>
      {/* Left: Logo + Chevron + (Breadcrumb / Title) */}
      <View style={styles.headerLeft}>
        <Pressable onPress={onOpenDrawer} hitSlop={8} style={styles.logoBox}>
          <Image
            source={require('@/assets/logo.png')}
            style={styles.logoImage}
            resizeMode="cover"
          />
        </Pressable>
        <Icon name="chevron-right" size={16} color={colorScales.gray[300]} style={styles.separator} />
        <View style={styles.titleContainer}>
          {breadcrumb ? <Text style={styles.breadcrumb} numberOfLines={1}>{breadcrumb}</Text> : null}
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
      </View>

      {/* Right: Search + Notifications + User */}
      <View style={styles.headerRight}>
        <Pressable
          onPress={onOpenSearch || (() => {})}
          hitSlop={8}
          style={styles.iconButton}
        >
          <Icon name="search" size={18} color={colorScales.gray[500]} />
        </Pressable>

        <Pressable onPress={onOpenNotifications} hitSlop={8} style={styles.iconButton}>
          <View style={styles.iconWrapper}>
            <Icon name="bell" size={18} color={colorScales.gray[500]} />
            {notificationCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </View>
        </Pressable>

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
    paddingBottom: spacing[3],
    backgroundColor: 'transparent',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    flex: 1,
    minWidth: 0,
  },
  logoBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  logoImage: {
    width: 36,
    height: 36,
  },
  separator: {
    marginHorizontal: 2,
  },
  titleContainer: {
    flexDirection: 'column',
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  breadcrumb: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.normal,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    position: 'relative',
  },
  notificationBadge: {
    position: 'absolute',
    top: -3,
    right: -5,
    minWidth: 14,
    height: 14,
    backgroundColor: colors.error,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  notificationBadgeText: {
    fontSize: 8,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  // Avatar de usuario más pequeño y verde menta (como la web)
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  userInitials: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.green[800],
  },
  userStatusDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#F97316',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
});
