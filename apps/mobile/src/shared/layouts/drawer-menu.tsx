import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface MenuItem {
  label: string;
  icon: string;
  href: string;
}

interface DrawerMenuProps {
  currentRoute: string;
  onClose: () => void;
}

const menuItems: MenuItem[] = [
  { label: 'Dashboard', icon: '🏠', href: '/dashboard' },
  { label: 'Products', icon: '📦', href: '/products' },
  { label: 'Orders', icon: '🛒', href: '/orders' },
  { label: 'Customers', icon: '👥', href: '/customers' },
  { label: 'Settings', icon: '⚙️', href: '/settings' },
];

export function DrawerMenu({ currentRoute, onClose }: DrawerMenuProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleNavigate = (href: string) => {
    onClose();
    router.push(href as any);
  };

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="px-4 py-6 border-b border-gray-200">
        <Text className="text-2xl font-bold text-primary-600">Vendix</Text>
        <Text className="text-sm text-gray-500 mt-1">Store Admin</Text>
      </View>
      <View className="flex-1 py-4">
        {menuItems.map((item) => {
          const isActive = currentRoute.includes(item.href);
          return (
            <Pressable
              key={item.href}
              onPress={() => handleNavigate(item.href)}
              className={`
                flex-row items-center px-4 py-3 mx-2 rounded-lg
                ${isActive ? 'bg-primary-50' : 'active:bg-gray-50'}
              `}
            >
              <Text className="text-xl mr-3">{item.icon}</Text>
              <Text
                className={`text-base font-medium ${
                  isActive ? 'text-primary-600' : 'text-gray-700'
                }`}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="px-4 py-4 border-t border-gray-200">
        <Pressable
          onPress={() => {
            onClose();
            router.push('/(auth)/login');
          }}
          className="flex-row items-center px-4 py-3 rounded-lg active:bg-gray-50"
        >
          <Text className="text-xl mr-3">🚪</Text>
          <Text className="text-base font-medium text-gray-700">Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}
