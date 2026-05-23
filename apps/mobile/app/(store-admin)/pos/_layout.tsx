import { Slot } from 'expo-router';
import { View } from 'react-native';
import { colors } from '@/shared/theme';

export default function PosLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Slot />
    </View>
  );
}
