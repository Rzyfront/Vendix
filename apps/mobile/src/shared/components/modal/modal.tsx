import { Modal as RNModal, View, Text, Pressable, ScrollView, StyleSheet, type ViewStyle, type ViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography, colorScales } from '@/shared/theme';

interface ModalProps extends ViewProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  showCloseButton?: boolean;
  showHeader?: boolean;
  showFooter?: boolean;
  footer?: React.ReactNode;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerSpacer: {
    width: 40,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[900],
    flex: 1,
    textAlign: 'center',
  },
  closeButton: {
    width: 40,
    alignItems: 'flex-end',
  },
  closeIcon: {
    color: colorScales.gray[400],
    fontSize: typography.fontSize['2xl'],
  },
  scrollView: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
});

export function Modal({
  visible,
  onClose,
  title,
  children,
  showCloseButton = true,
  showHeader = true,
  showFooter = false,
  footer,
  style,
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
      <View style={[styles.root, style]} {...props}>
        {showHeader && (
          <View
            style={[styles.header, { paddingTop: insets.top || spacing[4] }]}
          >
            <View style={styles.headerSpacer} />
            {title && (
              <Text style={styles.title}>
                {title}
              </Text>
            )}
            {showCloseButton ? (
              <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
                <Text style={styles.closeIcon}>×</Text>
              </Pressable>
            ) : (
              <View style={styles.headerSpacer} />
            )}
          </View>
        )}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={{ paddingBottom: insets.bottom + spacing[4] }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
        {showFooter && footer && (
          <View
            style={[styles.footer, { paddingBottom: insets.bottom || spacing[4] }]}
          >
            {footer}
          </View>
        )}
      </View>
    </RNModal>
  );
}
