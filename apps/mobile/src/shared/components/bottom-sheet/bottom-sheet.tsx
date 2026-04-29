import { useCallback } from 'react';
import { View, Modal, Pressable, Dimensions, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, borderRadius, colorScales, spacing } from '@/shared/theme';

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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: borderRadius['2xl'],
    borderTopRightRadius: borderRadius['2xl'],
  },
  handleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: spacing[2],
    paddingBottom: spacing[4],
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: colorScales.gray[300],
    borderRadius: borderRadius.full,
  },
  scrollContent: {
    flex: 1,
  },
});

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
      <Pressable style={styles.backdrop} onPress={handleClose} />
      <View
        style={[
          styles.sheet,
          {
            height: Dimensions.get('window').height * (snapPoint === 'full' ? 0.9 : 0.5),
            paddingBottom: insets.bottom || spacing[4],
          },
        ]}
      >
        <View style={styles.handleContainer}>
          <Pressable onPress={handleClose} hitSlop={12}>
            <View style={styles.handle} />
          </Pressable>
        </View>
        <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}
