import React from 'react';
import {
  View,
  Text,
  Pressable,
  Modal as RNModal,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components/icon/icon';
import {
  borderRadius,
  colorScales,
  colors,
  spacing,
  typography,
} from '@/shared/theme';

export type OrgModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface OrgCenteredModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  size?: OrgModalSize;
  showCloseButton?: boolean;
  closeOnBackdrop?: boolean;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const SIZE_MAX_WIDTH: Record<OrgModalSize, number> = {
  sm: 380,
  md: 560,
  lg: 720,
  xl: 960,
};

/**
 * Espejo del `app-modal` de la web.
 *
 * Modal centrado sobre un backdrop semitransparente, NO slide-up
 * fullscreen. Header con title + subtitle + botón X; body con scroll;
 * footer opcional con borde superior.
 */
export function OrgCenteredModal({
  visible,
  onClose,
  title,
  subtitle,
  size = 'md',
  showCloseButton = true,
  closeOnBackdrop = true,
  children,
  footer,
  style,
}: OrgCenteredModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdrop}
          onPress={closeOnBackdrop ? onClose : undefined}
        >
          <Pressable
            style={[
              styles.container,
              { maxWidth: SIZE_MAX_WIDTH[size] },
              { marginBottom: insets.bottom },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.surface, style]}>
              {(title || subtitle || showCloseButton) ? (
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    {title ? (
                      <Text style={styles.title} numberOfLines={1}>
                        {title}
                      </Text>
                    ) : null}
                    {subtitle ? (
                      <Text style={styles.subtitle} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {showCloseButton ? (
                    <Pressable
                      onPress={onClose}
                      hitSlop={8}
                      style={styles.closeBtn}
                      accessibilityLabel="Cerrar modal"
                    >
                      <Icon name="x" size={20} color={colorScales.gray[500]} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>

              {footer ? (
                <View
                  style={[
                    styles.footer,
                    { paddingBottom: insets.bottom ? spacing[3] : spacing[3] },
                  ]}
                >
                  {footer}
                </View>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxHeight: '90%',
  },
  surface: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
});
