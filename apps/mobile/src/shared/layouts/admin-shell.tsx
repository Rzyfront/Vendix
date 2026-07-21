import { useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { View, Pressable, Dimensions, StyleSheet, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { colorScales } from '@/shared/theme';
import { PosHeader } from '@/features/pos/components/pos-header';
import { DrawerMenu } from './drawer-menu';
import { HelpSearchModal } from '@/features/help/help-search-modal';
import { NotificationsModal } from '@/features/notifications/notifications-modal';
import { UserDropdownModal } from '@/features/user/user-dropdown-modal';
import { NotificationsService } from '@/features/notifications/notifications.service';
import { useAuthStore } from '@/core/store/auth.store';
import { ScopeChip } from '@/features/org/components/scope-chip';
import { ToastContainer } from '@/shared/components/toast/toast';

interface AdminShellProps {
  children: ReactNode;
  title?: string;
  breadcrumb?: string;
  variant?: 'store' | 'org' | 'super';
  /** Etiqueta del breadcrumb padre (super-admin). */
  parentLabel?: string;
  /** Icono del breadcrumb padre (super-admin). */
  parentIcon?: string;
  /** Etiqueta del breadcrumb actual (super-admin). */
  currentLabel?: string;
  /** Icono del breadcrumb actual (super-admin). */
  currentIcon?: string;
}

export function AdminShell({ children, title = 'Vendix', breadcrumb, variant = 'store' }: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const windowWidth = Dimensions.get('window').width;
  const DRAWER_WIDTH = Math.min(windowWidth * 0.8, 320);

  const [isMounted, setIsMounted] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (drawerOpen) {
      setIsMounted(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 250,
          easing: Easing.bezier(0.25, 0, 0, 1),
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 250,
          easing: Easing.bezier(0.25, 0, 0, 1),
          useNativeDriver: true,
        }),
      ]).start(() => {
        setIsMounted(false);
      });
    }
  }, [drawerOpen, DRAWER_WIDTH]);

  const userInitials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const queryClient = useQueryClient();

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['unread-notifications-count'],
    queryFn: () => NotificationsService.getUnreadCount(),
    refetchInterval: 30000,
  });

  // Scope chip — paridad con web `app-header` (sólo en ORG_ADMIN).
  // NO se muestra el icono fiscal — sólo el modo operativo.
  const operatingScope = user?.organizations?.operating_scope ?? user?.store?.organizations?.operating_scope ?? null;
  const showScopeChip = variant === 'org' && operatingScope != null;

  return (
    <View style={styles.container}>
      <PosHeader
        onOpenDrawer={openDrawer}
        onOpenSearch={() => setShowSearch(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenUserMenu={() => setShowUserMenu(true)}
        notificationCount={unreadCount}
        userInitials={userInitials}
        title={title}
        breadcrumb={breadcrumb}
        extraActions={
          showScopeChip ? <ScopeChip scope={operatingScope} /> : undefined
        }
      />

      <View style={styles.flex}>
        {children}
      </View>

      <NotificationsModal
        visible={showNotifications}
        onClose={() => {
          setShowNotifications(false);
          queryClient.invalidateQueries({ queryKey: ['unread-notifications-count'] });
        }}
        onNavigate={(route) => {
          setShowNotifications(false);
          router.push(route as never);
        }}
      />

      <HelpSearchModal
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        onSelectArticle={() => {
          // No toast on mobile for global help
        }}
      />

      <UserDropdownModal
        visible={showUserMenu}
        onClose={() => setShowUserMenu(false)}
        variant={variant}
      />

      {/* Drawer — rendered last to stay above all content */}
      {isMounted && (
        <Animated.View
          style={[
            styles.overlay,
            {
              opacity: fadeAnim,
              zIndex: 100,
            },
          ]}
        >
          <Pressable style={styles.flex} onPress={closeDrawer}>
            <View style={styles.flex} />
          </Pressable>
        </Animated.View>
      )}

      {isMounted && (
        <Animated.View
          style={[
            styles.drawer,
            {
              width: DRAWER_WIDTH,
              paddingTop: insets.top,
              zIndex: 110,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <DrawerMenu currentRoute={pathname} onClose={closeDrawer} variant={variant} />
        </Animated.View>
      )}

      {/* Toast notifications */}
      <ToastContainer />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  flex: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
  },
});
