import { View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HeaderProps {
  title: string;
  onMenuPress: () => void;
  rightAction?: React.ReactNode;
}

export function Header({ title, onMenuPress, rightAction }: HeaderProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="bg-white border-b border-gray-200"
      style={{ paddingTop: insets.top }}
    >
      <View className="flex-row items-center justify-between px-4 h-14">
        <Pressable
          onPress={onMenuPress}
          hitSlop={8}
          className="w-10 h-10 items-center justify-center -ml-2"
        >
          <Text className="text-2xl text-gray-600">☰</Text>
        </Pressable>
        <Text className="text-lg font-semibold text-gray-900 flex-1 text-center">
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
