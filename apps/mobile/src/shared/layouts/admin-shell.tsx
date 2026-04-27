import { useState, useCallback } from 'react';
import { Drawer } from '@react-navigation/drawer';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { Header } from './header';
import { DrawerMenu } from './drawer-menu';

interface AdminShellProps {
  children: React.ReactNode;
  title?: string;
}

export function AdminShell({ children, title = 'Vendix' }: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <Drawer
      open={drawerOpen}
      onOpen={openDrawer}
      onClose={closeDrawer}
      drawerContent={() => <DrawerMenu currentRoute={pathname} onClose={closeDrawer} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        overlayModifiesStatusBar: true,
        swipeEnabled: true,
        swipeEdgeWidth: 50,
      }}
    >
      <View className="flex-1 bg-gray-50">
        <Header title={title} onMenuPress={openDrawer} />
        <View className="flex-1" style={{ paddingTop: insets.top }}>
          {children}
        </View>
      </View>
    </Drawer>
  );
}
