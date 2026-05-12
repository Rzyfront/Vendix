import { View, Text, StyleSheet } from 'react-native';
import { spacing, typography, colorScales } from '@/shared/theme';
import { Button } from '../button/button';
import { Modal } from '../modal/modal';

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

const styles = StyleSheet.create({
  content: {
    padding: spacing[6],
    alignItems: 'center',
  },
  title: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  message: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[500],
    textAlign: 'center',
    marginBottom: spacing[8],
  },
  actions: {
    flexDirection: 'row',
    width: '100%',
  },
  cancelWrap: {
    flex: 1,
    marginRight: spacing[2],
  },
  confirmWrap: {
    flex: 1,
    marginLeft: spacing[2],
  },
});

export function ConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} onClose={onClose} showHeader={false}>
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <View style={styles.cancelWrap}>
            <Button
              title={cancelLabel}
              onPress={onClose}
              variant="outline"
              fullWidth
            />
          </View>
          <View style={styles.confirmWrap}>
            <Button
              title={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'destructive' : 'primary'}
              fullWidth
              loading={loading}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}
