import { View, Text } from 'react-native';
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
      <View className="p-6 items-center">
        <Text className="text-xl font-bold text-gray-900 mb-2">{title}</Text>
        <Text className="text-base text-gray-500 text-center mb-8">{message}</Text>
        <View className="flex-row w-full">
          <View className="flex-1 mr-2">
            <Button
              title={cancelLabel}
              onPress={onClose}
              variant="outline"
              fullWidth
            />
          </View>
          <View className="flex-1 ml-2">
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
