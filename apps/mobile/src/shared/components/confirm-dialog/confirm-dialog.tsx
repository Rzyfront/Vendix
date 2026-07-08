import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { spacing, typography, colorScales, colors, borderRadius } from '@/shared/theme';

interface ConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Título del modal. Centrado en el header del modal (sin background/color). */
  title: string;
  /** Cuerpo del mensaje. Se muestra debajo del header. */
  message: string;
  /** Texto del botón de confirmar. Default: 'Confirmar'. */
  confirmLabel?: string;
  /** Texto del botón de cancelar. Default: 'Cancelar'. */
  cancelLabel?: string;
  /**
   * Si es true, el botón de confirmar usa estilo destructivo (rojo).
   * Si es false, usa primario (verde). Default: false.
   */
  destructive?: boolean;
  /** Muestra spinner en el botón de confirmar mientras la acción está en curso. */
  loading?: boolean;
}

const CARD_MAX_WIDTH = 480;

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
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        {/* Backdrop — tap cierra el diálogo. */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Card centrado — mirror del app-modal web [size]="'sm'" para confirm dialogs. */}
        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            {/* Header — título grande centrado, sin background/color/ícono.
                Coincide con la estructura del web confirmation modal. */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>{title}</Text>
            </View>

            {/* Body — mensaje centrado. */}
            <View style={styles.body}>
              <Text style={styles.message}>{message}</Text>
            </View>

            {/* Footer — border-top + botones right-aligned.
                Cancelar usa outlinePrimary (verde, parity con el web).
                Confirmar usa destructive (rojo) o primary (verde). */}
            <View style={styles.footer}>
              <Pressable
                style={({ pressed }) => [
                  styles.btnOutline,
                  pressed && !loading && styles.btnOutlinePressed,
                  loading && styles.btnDisabled,
                ]}
                onPress={onClose}
                disabled={loading}
              >
                <Text style={styles.btnOutlineText}>{cancelLabel}</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.btnConfirm,
                  destructive ? styles.btnDestructive : styles.btnPrimary,
                  (pressed || loading) && styles.btnConfirmPressed,
                ]}
                onPress={onConfirm}
                disabled={loading}
              >
                {loading ? (
                  <Text style={styles.btnConfirmText}>{confirmLabel}…</Text>
                ) : (
                  <Text style={styles.btnConfirmText}>{confirmLabel}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
  // Header: título grande centrado — sin background, sin ícono,
  // sin border-bottom. Coincide con el header del modal del web.
  header: {
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[3],
    backgroundColor: colors.card,
  },
  headerTitle: {
    fontSize: typography.fontSize.xl,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    textAlign: 'center',
  },
  // Body: mensaje centrado debajo del header.
  body: {
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[4],
    backgroundColor: colors.card,
  },
  message: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
    textAlign: 'center',
    lineHeight: typography.fontSize.base * 1.6,
  },
  // Footer: border-top, botones right-aligned.
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  // Cancelar: outlinePrimary (verde, parity con el web).
  btnOutline: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2] + 2,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.green[600],
    backgroundColor: 'transparent',
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlinePressed: {
    backgroundColor: colorScales.green[50],
    borderColor: colorScales.green[700],
  },
  btnOutlineText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    fontWeight: '500',
    color: colorScales.green[600],
  },
  btnDisabled: {
    opacity: 0.6,
  },
  // Confirmar: primary (verde) o destructive (rojo).
  btnConfirm: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2] + 2,
    borderRadius: borderRadius.md,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  btnConfirmPressed: {
    opacity: 0.85,
  },
  btnPrimary: {
    backgroundColor: colorScales.green[600],
    shadowColor: 'rgba(34,197,94,0.4)',
  },
  btnDestructive: {
    backgroundColor: colorScales.red[600],
    shadowColor: 'rgba(220,38,38,0.4)',
  },
  btnConfirmText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    fontWeight: '600',
    color: '#fff',
  },
});
