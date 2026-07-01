import { useState } from 'react';
import { ScrollView, Text, View, ActivityIndicator, Pressable } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { apiClient, Endpoints } from '@/core/api';
import { downloadEmptyTemplate } from '@/features/store/utils/xlsx';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface BulkUploadModalProps {
  visible: boolean;
  onClose: () => void;
}

export function BulkUploadModal({ visible, onClose }: BulkUploadModalProps) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<{ name: string; uri: string; size?: number } | null>(null);
  const [parsing, setParsing] = useState(false);

  async function handlePick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const picked = result.assets[0];
      setFile({ name: picked.name, uri: picked.uri, size: picked.size });
    } catch (err) {
      toastError('No se pudo seleccionar el archivo');
    }
  }

  async function handleDownloadTemplate() {
    try {
      await downloadEmptyTemplate();
      toastSuccess('Plantilla descargada');
    } catch (err) {
      toastError('No se pudo generar la plantilla');
    }
  }

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('Selecciona un archivo primero');
      const formData = new FormData();
      // @ts-expect-error RN FormData accepts file objects
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const res = await apiClient.post('/store/products/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data;
    },
    onSuccess: (data: any) => {
      const created = data?.created ?? data?.data?.created ?? 0;
      const updated = data?.updated ?? data?.data?.updated ?? 0;
      const errors = data?.errors ?? data?.data?.errors ?? [];
      toastSuccess(`Carga masiva: ${created} creados, ${updated} actualizados${errors.length ? `, ${errors.length} errores` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['product-stats'] });
      setFile(null);
      onClose();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'No se pudo procesar el archivo';
      toastError(typeof msg === 'string' ? msg : 'Error en la carga masiva');
    },
  });

  return (
    <Modal visible={visible} onClose={onClose} title="Carga Masiva de Productos" showCloseButton>
      <ScrollView contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }}>
          Subí un archivo XLSX con tus productos. La primera fila debe contener los encabezados: <Text style={{ fontWeight: '700' }}>Nombre, SKU, Precio base</Text> (mínimo).
        </Text>

        {/* Drop zone */}
        <Pressable
          onPress={handlePick}
          style={({ pressed }) => [
            {
              borderWidth: 1,
              borderColor: file ? colors.primary : colorScales.gray[300],
              borderStyle: 'dashed',
              borderRadius: borderRadius.md,
              padding: spacing[6],
              alignItems: 'center',
              backgroundColor: file ? colors.primaryLight : colorScales.gray[50],
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          {file ? (
            <>
              <Icon name="file-spreadsheet" size={32} color={colors.primary} />
              <Text style={{ fontSize: typography.fontSize.base, fontWeight: '600', color: colors.text.primary, marginTop: spacing[2] }}>
                {file.name}
              </Text>
              <Text style={{ fontSize: typography.fontSize.xs, color: colors.text.secondary, marginTop: spacing[1] }}>
                {file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'Toca para cambiar el archivo'}
              </Text>
            </>
          ) : (
            <>
              <Icon name="upload-cloud" size={32} color={colors.text.muted} />
              <Text style={{ fontSize: typography.fontSize.base, fontWeight: '600', color: colors.text.primary, marginTop: spacing[2] }}>
                Toca para seleccionar un archivo XLSX
              </Text>
              <Text style={{ fontSize: typography.fontSize.xs, color: colors.text.secondary, marginTop: spacing[1] }}>
                Tamaño máximo recomendado: 10 MB
              </Text>
            </>
          )}
        </Pressable>

        {uploadMutation.isPending && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <ActivityIndicator color={colors.primary} />
            <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.secondary }}>
              Procesando archivo...
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Descargar plantilla"
              variant="outline"
              leftIcon={<Icon name="download" size={16} color={colors.text.primary} />}
              onPress={handleDownloadTemplate}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Subir"
              variant="primary"
              leftIcon={<Icon name="upload" size={16} color={colors.background} />}
              onPress={() => uploadMutation.mutate()}
              loading={uploadMutation.isPending}
              disabled={!file}
              fullWidth
            />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}