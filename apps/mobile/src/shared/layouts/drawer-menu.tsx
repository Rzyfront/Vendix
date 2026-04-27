import { View, Text, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@/core/store/auth.store';
import { Icon } from '@/shared/components/icon/icon';
import { colors } from '@/shared/theme/colors';

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
  const userSettings = useAuthStore((s) => s.user_settings);
  const storeSettings = useAuthStore((s) => s.store_settings);
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
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="px-4 py-6 border-b border-gray-200">
        <View className="flex-row items-center">
          <View className="w-10 h-10 rounded-lg bg-primary items-center justify-center mr-3">
            <Icon name={config.icon} size={20} color="#fff" />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-gray-900" numberOfLines={1}>
              {displayName}
            </Text>
            <Text className="text-xs text-gray-500 mt-0.5">
              {user?.email || config.label}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView className="flex-1 py-2" showsVerticalScrollIndicator={false}>
        {config.items.map((item) => {
          const isActive = currentRoute.includes(item.href.split('/').pop() || '');
          return (
            <Pressable
              key={item.href}
              onPress={() => handleNavigate(item.href)}
              className={`flex-row items-center px-4 py-3 mx-2 rounded-lg ${
                isActive ? 'bg-green-50' : ''
              }`}
            >
              <View
                className={`w-8 h-8 rounded-lg items-center justify-center mr-3 ${
                  isActive ? 'bg-green-100' : 'bg-gray-50'
                }`}
              >
                <Icon
                  name={item.icon}
                  size={18}
                  color={isActive ? colors.primary : colors.text.secondary}
                />
              </View>
              <Text
                className={`text-sm font-medium flex-1 ${
                  isActive ? 'text-green-700' : 'text-gray-700'
                }`}
              >
                {item.label}
              </Text>
              {isActive && <View className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </Pressable>
          );
        })}
      </ScrollView>

      <View
        className="px-4 py-3 border-t border-gray-200"
        style={{ paddingBottom: insets.bottom || 12 }}
      >
        <Pressable
          onPress={handleLogout}
          className="flex-row items-center px-4 py-3 rounded-lg active:bg-red-50"
        >
          <View className="w-8 h-8 rounded-lg items-center justify-center mr-3 bg-gray-50">
            <Icon name="logout" size={18} color={colors.error} />
          </View>
          <Text className="text-sm font-medium text-red-600">Cerrar Sesión</Text>
        </Pressable>
      </View>
    </View>
  );
}
