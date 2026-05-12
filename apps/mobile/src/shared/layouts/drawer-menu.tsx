import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, typography, spacing, borderRadius } from '@/shared/theme';

interface MenuItem {
  label: string;
  icon: string;
  href: string;
}

const storeMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/(store-admin)/dashboard' },
  { label: 'POS', icon: 'shopping-cart', href: '/(store-admin)/pos' },
  { label: 'Productos', icon: 'package', href: '/(store-admin)/products' },
  { label: 'Órdenes', icon: 'clipboard-list', href: '/(store-admin)/orders' },
  { label: 'Inventario', icon: 'warehouse', href: '/(store-admin)/inventory' },
  { label: 'Clientes', icon: 'users', href: '/(store-admin)/customers' },
  { label: 'Facturación', icon: 'file-text', href: '/(store-admin)/invoicing' },
  { label: 'Contabilidad', icon: 'calculator', href: '/(store-admin)/accounting' },
  { label: 'Gastos', icon: 'receipt', href: '/(store-admin)/expenses' },
  { label: 'Analíticas', icon: 'bar-chart', href: '/(store-admin)/analytics' },
  { label: 'Configuración', icon: 'settings', href: '/(store-admin)/settings' },
];

const orgMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/(org-admin)/dashboard' },
  { label: 'Tiendas', icon: 'store', href: '/(org-admin)/stores' },
  { label: 'Usuarios', icon: 'users', href: '/(org-admin)/users' },
  { label: 'Roles', icon: 'shield', href: '/(org-admin)/roles' },
  { label: 'Órdenes', icon: 'clipboard-list', href: '/(org-admin)/orders' },
  { label: 'Suscripciones', icon: 'credit-card', href: '/(org-admin)/subscriptions' },
  { label: 'Configuración', icon: 'settings', href: '/(org-admin)/settings' },
];

const superMenuItems: MenuItem[] = [
  { label: 'Dashboard', icon: 'home', href: '/(super-admin)/dashboard' },
  { label: 'Organizaciones', icon: 'building-2', href: '/(super-admin)/organizations' },
  { label: 'Tiendas', icon: 'store', href: '/(super-admin)/stores' },
  { label: 'Usuarios', icon: 'users', href: '/(super-admin)/users' },
  { label: 'Suscripciones', icon: 'credit-card', href: '/(super-admin)/subscriptions' },
  { label: 'AI Engine', icon: 'cpu', href: '/(super-admin)/ai-engine' },
  { label: 'Monitoreo', icon: 'activity', href: '/(super-admin)/monitoring' },
  { label: 'Configuración', icon: 'settings', href: '/(super-admin)/settings' },
];

const variantConfig = {
  store: { items: storeMenuItems, icon: 'store' as const, label: 'Tienda' },
  org: { items: orgMenuItems, icon: 'building-2' as const, label: 'Organización' },
  super: { items: superMenuItems, icon: 'shield' as const, label: 'Vendix Admin' },
};

interface DrawerMenuProps {
  currentRoute: string;
  onClose: () => void;
  variant?: 'store' | 'org' | 'super';
}

export function DrawerMenu({ currentRoute, onClose, variant = 'store' }: DrawerMenuProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const config = variantConfig[variant];
  const displayName = user?.store?.name || user?.organizations?.name || 'Vendix';

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href as never);
  };

  const handleLogout = () => {
    onClose();
    logout();
    router.replace('/(auth)/login');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Icon name={config.icon} size={20} color="#fff" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.displayName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.email}>
              {user?.email || config.label}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {config.items.map((item) => {
          const isActive = currentRoute.includes(item.href.split('/').pop() || '');
          return (
            <Pressable
              key={item.href}
              onPress={() => handleNavigate(item.href)}
              style={[styles.menuItem, isActive && styles.menuItemActive]}
            >
              <View style={[styles.menuIcon, isActive ? styles.menuIconActive : styles.menuIconInactive]}>
                <Icon
                  name={item.icon}
                  size={18}
                  color={isActive ? colors.primary : colors.text.secondary}
                />
              </View>
              <Text style={[styles.menuLabel, isActive ? styles.menuLabelActive : styles.menuLabelInactive]}>
                {item.label}
              </Text>
              {isActive && <View style={styles.activeDot} />}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom || 12 }]}>
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed && styles.logoutButtonPressed,
          ]}
        >
          <View style={styles.logoutIcon}>
            <Icon name="logout" size={18} color={colors.error} />
          </View>
          <Text style={styles.logoutText}>Cerrar Sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.card,
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[6],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  headerText: {
    flex: 1,
  },
  displayName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  email: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  scrollContent: {
    paddingVertical: spacing[2],
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginHorizontal: spacing[2],
    borderRadius: borderRadius.lg,
  },
  menuItemActive: {
    backgroundColor: colorScales.green[50],
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  menuIconActive: {
    backgroundColor: colorScales.green[100],
  },
  menuIconInactive: {
    backgroundColor: colorScales.gray[50],
  },
  menuLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    flex: 1,
  },
  menuLabelActive: {
    color: colorScales.green[700],
  },
  menuLabelInactive: {
    color: colorScales.gray[700],
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
  },
  logoutButtonPressed: {
    backgroundColor: colorScales.red[50],
  },
  logoutIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
    backgroundColor: colorScales.gray[50],
  },
  logoutText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.red[600],
  },
});
