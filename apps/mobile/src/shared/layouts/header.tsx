import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from '@/shared/components/icon/icon';
import { colors } from '@/shared/theme/colors';

interface HeaderProps {
  title: string;
  onMenuPress: () => void;
  rightAction?: React.ReactNode;
  showBack?: boolean;
}

export function Header({ title, onMenuPress, rightAction, showBack = false }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View
      className="bg-white border-b border-gray-100"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-4 h-14">
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            className="w-10 h-10 items-center justify-center -ml-2"
          >
            <Icon name="arrow-left" size={22} color={colors.text.primary} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onMenuPress}
            hitSlop={8}
            className="w-10 h-10 items-center justify-center -ml-2"
          >
            <Icon name="list" size={22} color={colors.text.primary} />
          </Pressable>
        )}
        <Text className="text-base font-semibold text-gray-900 flex-1 text-center" numberOfLines={1}>
          {title}
        </Text>
        {rightAction ? (
          <View className="w-10 items-end">{rightAction}</View>
        ) : (
          <View className="w-10" />
        )}
      </View>
    </View>
  );
}
