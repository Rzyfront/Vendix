import { Modal as RNModal, View, Text, Pressable, ScrollView, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ModalProps extends ViewProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  footer?: React.ReactNode;
}

export function Modal({
  visible,
  onClose,
  title,
  children,
  showCloseButton = true,
  showHeader = true,
  showFooter = false,
  footer,
  className = '',
  ...props
}: ModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <RNModal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View className={`flex-1 bg-white ${className}`} {...props}>
        {showHeader && (
          <View
            className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200"
            style={{ paddingTop: insets.top || 16 }}
          >
            <View className="w-10" />
            {title && (
              <Text className="text-lg font-semibold text-gray-900 flex-1 text-center">
                {title}
              </Text>
            )}
            {showCloseButton ? (
              <Pressable onPress={onClose} hitSlop={8} className="w-10 items-end">
                <Text className="text-gray-400 text-2xl">×</Text>
              </Pressable>
            ) : (
              <View className="w-10" />
            )}
          </View>
        )}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {showFooter && footer && (
          <View
            className="px-4 py-4 border-t border-gray-200"
            style={{ paddingBottom: insets.bottom || 16 }}
          >
            {footer}
          </View>
        )}
      </View>
    </RNModal>
  );
}
