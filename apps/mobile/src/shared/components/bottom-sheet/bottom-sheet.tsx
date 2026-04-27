import { useCallback, useEffect, useState } from 'react';
import { View, Modal, Pressable, Dimensions, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type SnapPoint = 'partial' | 'full';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoint?: SnapPoint;
  enableDrag?: boolean;
}

const snapPoints = {
  partial: SCREEN_HEIGHT * 0.5,
  full: SCREEN_HEIGHT * 0.9,
};

export function BottomSheet({
  visible,
  onClose,
  children,
  snapPoint = 'partial',
  enableDrag = true,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(snapPoints[snapPoint]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsOpen(true);
      translateY.value = withSpring(snapPoints[snapPoint], {
        damping: 50,
        stiffness: 400,
      });
    } else {
      translateY.value = withSpring(SCREEN_HEIGHT, {
        damping: 50,
        stiffness: 400,
      }, () => {
        runOnJS(setIsOpen)(false);
      });
    }
  }, [visible, snapPoint, translateY]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const panGesture = Gesture.Pan()
    .enabled(enableDrag)
    .onUpdate((event) => {
      const newTranslateY = snapPoints[snapPoint] + event.translationY;
      translateY.value = Math.max(newTranslateY, 0);
    })
    .onEnd((event) => {
      if (event.translationY > 100 || event.velocityY > 500) {
        runOnJS(handleClose)();
      } else {
        translateY.value = withSpring(snapPoints[snapPoint], {
          damping: 50,
          stiffness: 400,
        });
      }
    });

  const animatedStyle: ViewStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={handleClose}>
      <View className="flex-1 bg-black/50 justify-end">
        <Pressable className="flex-1" onPress={handleClose} />
        <GestureDetector gesture={panGesture}>
          <Animated.View
            className="bg-white rounded-t-2xl"
            style={[
              animatedStyle,
              { paddingBottom: insets.bottom || 16 },
            ]}
          >
            <View className="w-full items-center pt-2 pb-4">
              <View className="w-10 h-1 bg-gray-300 rounded-full" />
            </View>
            <View className="max-h-full">{children}</View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}
