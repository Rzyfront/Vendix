import { useCallback } from 'react';
import { View, Modal, Pressable, Dimensions, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SnapPoint = 'partial' | 'full';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoint?: SnapPoint;
  enableDrag?: boolean;
}

const snapHeights: Record<SnapPoint, string> = {
  partial: '50%',
  full: '90%',
};

export function BottomSheet({
  visible,
  onClose,
  children,
  snapPoint = 'partial',
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const height = snapHeights[snapPoint];

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable className="flex-1" onPress={handleClose} />
      <View
        className="bg-white rounded-t-2xl"
        style={{ height: Dimensions.get('window').height * (snapPoint === 'full' ? 0.9 : 0.5), paddingBottom: insets.bottom || 16 }}
      >
        <View className="w-full items-center pt-2 pb-4">
          <Pressable onPress={handleClose} hitSlop={12}>
            <View className="w-10 h-1 bg-gray-300 rounded-full" />
          </Pressable>
        </View>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
