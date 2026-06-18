import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { spacing, typography, colorScales, colors, interFonts } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface ConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  const { width } = useWindowDimensions();
  const dialogWidth = Math.min(width * 0.92, 448);

  const headerBg = destructive
    ? { backgroundColor: '#ef4444' }
    : null; // green gradient handled via inline style

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop — matches web .modal-backdrop-blur */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.dialog, { width: dialogWidth }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* ── Header — mirrors web .store-switch-modal .modal-header gradient ── */}
          <View
            style={[
              styles.header,
              destructive ? styles.headerDestructive : styles.headerPrimary,
            ]}
          >
            <View style={styles.headerInner}>
              {/* Icon */}
              <View style={styles.headerIconWrap}>
                <Icon
                  name={destructive ? 'alert-triangle' : 'store'}
                  size={22}
                  color="#fff"
                />
              </View>
              {/* Title */}
              <Text style={styles.headerTitle}>{title}</Text>
            </View>
          </View>

          {/* ── Body — mirrors web .modal-body ── */}
          <View style={styles.body}>
            <Text style={styles.message}>{message}</Text>
          </View>

          {/* ── Footer — mirrors web .modal-footer ── */}
          <View style={styles.footer}>
            {/* Cancel button */}
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.btnOutline,
                pressed && styles.btnOutlinePressed,
              ]}
              onPress={onClose}
              disabled={loading}
            >
              <Text style={styles.btnOutlineText}>{cancelLabel}</Text>
            </Pressable>

            {/* Confirm button */}
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                destructive ? styles.btnDestructive : styles.btnPrimary,
                (pressed || loading) && { opacity: 0.85 },
              ]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Backdrop — rgba(0,0,0,0.4) + subtle blur feel ──
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },

  // ── Dialog card — matches web .modal-content border-radius 12px ──
  dialog: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    // Shadow — iOS (matches web box-shadow)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    // Shadow — Android
    elevation: 16,
  },

  // ── Header — mirrors web .store-switch-modal .modal-header gradient ──
  header: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
  },
  headerPrimary: {
    backgroundColor: colors.primary,
  },
  headerDestructive: {
    backgroundColor: '#dc2626',
  },

  headerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  headerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .modal-title: font-size xl, font-weight semibold, color white
  headerTitle: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    fontFamily: interFonts.semibold,
    color: '#fff',
    lineHeight: typography.fontSize.lg * 1.3,
  },

  // ── Body ──
  body: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    backgroundColor: '#fff',
  },
  // .modal-body p: color text-secondary, line-height 1.6
  message: {
    fontSize: typography.fontSize.base,
    fontFamily: interFonts.regular,
    color: '#64748b', // Slate-500 / text-secondary
    lineHeight: typography.fontSize.base * 1.6,
  },

  // ── Footer — mirrors web .modal-footer ──
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },

  // Shared button base — min-width 100px, radius md
  btn: {
    minWidth: 100,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2] + 2,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },

  // Outline / cancel — matches web .btn-secondary
  btnOutline: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  btnOutlinePressed: {
    backgroundColor: colorScales.gray[50],
  },
  btnOutlineText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.medium,
    color: colorScales.gray[700],
  },

  // Primary — matches web .btn-primary gradient
  btnPrimary: {
    backgroundColor: colors.primary,
    shadowColor: 'rgba(34,197,94,0.4)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  // Destructive — red variant
  btnDestructive: {
    backgroundColor: '#dc2626',
    shadowColor: 'rgba(220,38,38,0.4)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  btnPrimaryText: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: '#fff',
  },
});
