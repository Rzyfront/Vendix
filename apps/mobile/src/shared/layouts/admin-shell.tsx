import { useState, useCallback, type ReactNode } from 'react';
import { View, Pressable, Dimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { colorScales } from '@/shared/theme';
import { PosHeader } from '@/features/pos/components/pos-header';
import { DrawerMenu } from './drawer-menu';
import { HelpSearchModal } from '@/features/help/help-search-modal';
import { NotificationsModal } from '@/features/notifications/notifications-modal';
import { UserDropdownModal } from '@/features/user/user-dropdown-modal';
import { useAuthStore } from '@/core/store/auth.store';
import { ToastContainer } from '@/shared/components/toast/toast';

interface AdminShellProps {
  children: ReactNode;
  title?: string;
  variant?: 'store' | 'org' | 'super';
}

export function AdminShell({ children, title = 'Vendix', variant = 'store' }: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showHelpSearch, setShowHelpSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const userInitials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <View style={styles.container}>
      <PosHeader
        onOpenDrawer={openDrawer}
        onOpenHelp={() => setShowHelpSearch(true)}
        onOpenNotifications={() => setShowNotifications(true)}
        onOpenUserMenu={() => setShowUserMenu(true)}
        notificationCount={15}
        userInitials={userInitials}
        title={title}
        showBadge={variant === 'store'}
        badgeLabel={variant === 'store' ? 'Punto de venta' : undefined}
      />

      <View style={styles.flex}>
        {children}
      </View>

      <HelpSearchModal
        visible={showHelpSearch}
        onClose={() => setShowHelpSearch(false)}
        onSelectArticle={(article) => {
          // No toast on mobile for global help
        }}
      />

      <NotificationsModal
        visible={showNotifications}
        onClose={() => setShowNotifications(false)}
        onNavigate={(route) => {
          setShowNotifications(false);
          router.push(route as never);
        }}
      />

      <UserDropdownModal
        visible={showUserMenu}
        onClose={() => setShowUserMenu(false)}
      />

      {/* Drawer — rendered last to stay above all content */}
      {drawerOpen && (
        <Pressable
          style={[styles.overlay, { zIndex: 100 }]}
          onPress={closeDrawer}
        >
          <View style={styles.flex} />
        </Pressable>
      )}

      {drawerOpen && (
        <View
          style={[
            styles.drawer,
            {
              width: Dimensions.get('window').width * 0.8,
              paddingTop: insets.top,
              zIndex: 110,
            },
          ]}
        >
          <DrawerMenu currentRoute={pathname} onClose={closeDrawer} variant={variant} />
        </View>
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
