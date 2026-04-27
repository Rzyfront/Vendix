import { useState, useCallback, type ReactNode } from 'react';
import { View, Pressable, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { Header } from './header';
import { DrawerMenu } from './drawer-menu';

interface AdminShellProps {
  children: ReactNode;
  title?: string;
  variant?: 'store' | 'org' | 'super';
}

export function AdminShell({ children, title = 'Vendix', variant = 'store' }: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <View className="flex-1 bg-gray-50">
      <Header title={title} onMenuPress={openDrawer} />

      <View className="flex-1">
        {children}
      </View>

      {drawerOpen && (
        <Pressable
          className="absolute inset-0 bg-black/40"
          style={{ zIndex: 40 }}
          onPress={closeDrawer}
        >
          <View className="flex-1" />
        </Pressable>
      )}

      {drawerOpen && (
        <View
          className="absolute top-0 left-0 bottom-0"
          style={{
            width: Dimensions.get('window').width * 0.8,
            paddingTop: insets.top,
            zIndex: 50,
          }}
        >
          <DrawerMenu currentRoute={pathname} onClose={closeDrawer} variant={variant} />
        </View>
      )}
    </View>
  );
}
