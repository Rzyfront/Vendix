import { useState } from 'react';
import { ScrollView, Text, View, ActivityIndicator, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { apiClient, Endpoints } from '@/core/api';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

interface BulkImageUploadModalProps {
  visible: boolean;
  onClose: () => void;
}

export function BulkImageUploadModal({ visible, onClose }: BulkImageUploadModalProps) {
  const queryClient = useQueryClient();
  const [images, setImages] = useState<PickedImage[]>([]);
  const [picking, setPicking] = useState(false);

  async function pickFromGallery() {
    setPicking(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        toastError('Necesitamos permiso para acceder a la galería');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const picked: PickedImage[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.fileName ?? `image_${Date.now()}.jpg`,
        type: a.type ?? 'image/jpeg',
      }));
      setImages((prev) => [...prev, ...picked]);
    } catch (err) {
      toastError('No se pudo abrir la galería');
    } finally {
      setPicking(false);
    }
  }

  async function pickFromFiles() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*'],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked: PickedImage[] = result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        type: a.mimeType ?? 'image/jpeg',
      }));
      setImages((prev) => [...prev, ...picked]);
    } catch (err) {
      toastError('No se pudo abrir el selector de archivos');
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (images.length === 0) throw new Error('Selecciona al menos una imagen');
      const formData = new FormData();
      images.forEach((img, i) => {
        // @ts-expect-error RN FormData accepts file objects
        formData.append('files', {
          uri: img.uri,
          name: img.name,
          type: img.type,
        });
      });
      const res = await apiClient.post('/store/products/bulk-image-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: (data: any) => {
      const uploaded = data?.uploaded ?? data?.data?.uploaded ?? 0;
      toastSuccess(`${uploaded} imágenes subidas`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setImages([]);
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'No se pudieron subir las imágenes';
      toastError(typeof msg === 'string' ? msg : 'Error al subir imágenes');
    },
  });

  return (
    <Modal visible={visible} onClose={onClose} title="Carga de Imágenes" showCloseButton>
      <ScrollView contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }}>
          Seleccioná varias imágenes y se asignarán automáticamente a los productos según el nombre del archivo (debe coincidir con el SKU).
        </Text>

        {/* Add buttons */}
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Desde galería"
              variant="outline"
              leftIcon={<Icon name="image" size={16} color={colors.text.primary} />}
              onPress={pickFromGallery}
              loading={picking}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Desde archivos"
              variant="outline"
              leftIcon={<Icon name="folder" size={16} color={colors.text.primary} />}
              onPress={pickFromFiles}
              fullWidth
            />
          </View>
        </View>

        {/* Image grid */}
        {images.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
            {images.map((img, i) => (
              <View
                key={`${img.uri}-${i}`}
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: borderRadius.md,
                  backgroundColor: colorScales.gray[100],
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="image" size={28} color={colors.text.muted} />
                </View>
                <Pressable
                  onPress={() => removeImage(i)}
                  hitSlop={6}
                  style={{
                    position: 'absolute',
                    top: 2,
                    right: 2,
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: colors.error,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="x" size={14} color={colors.background} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {uploadMutation.isPending && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }}>
              Subiendo {images.length} imágenes...
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Cancelar"
              variant="outline"
              onPress={() => { setImages([]); onClose(); }}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title={`Subir ${images.length || ''} imagen${images.length === 1 ? '' : 'es'}`}
              variant="primary"
              leftIcon={<Icon name="upload" size={16} color={colors.background} />}
              onPress={() => uploadMutation.mutate()}
              loading={uploadMutation.isPending}
              disabled={images.length === 0}
              fullWidth
            />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}