import { useState, useCallback, type ReactNode } from 'react';
import { View, Pressable, Dimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { colorScales } from '@/shared/theme';
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
    <View style={styles.container}>
      <Header title={title} onMenuPress={openDrawer} />

      <View style={styles.flex}>
        {children}
      </View>

      {drawerOpen && (
        <Pressable
          style={[styles.overlay, { zIndex: 40 }]}
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
              zIndex: 50,
            },
          ]}
        >
          <DrawerMenu currentRoute={pathname} onClose={closeDrawer} variant={variant} />
        </View>
      )}
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
