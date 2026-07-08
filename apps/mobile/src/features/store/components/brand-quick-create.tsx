import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Input, Textarea, Toggle, Button } from '@/shared/components';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { BrandService } from '@/features/store/services/brand.service';
import type { Brand } from '@/features/store/types';
import { colors, spacing } from '@/shared/theme';

interface BrandQuickCreateProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (brand: Brand) => void;
}

export function BrandQuickCreate({ visible, onClose, onCreated }: BrandQuickCreateProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isFeatured, setIsFeatured] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      BrandService.create({
        name: name.trim(),
        description: description.trim() || undefined,
        is_featured: isFeatured,
        state: 'active',
      }),
    onSuccess: (brand) => {
      toastSuccess('Marca creada');
      queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands-stats'] });
      onCreated(brand);
      reset();
      onClose();
    },
    onError: (err: any) => {
      toastError(err?.response?.data?.message || 'No se pudo crear la marca');
    },
  });

  function reset() {
    setName('');
    setDescription('');
    setIsFeatured(false);
  }

  function handleSubmit() {
    if (!name.trim()) {
      toastError('El nombre es obligatorio');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Nueva Marca"
      showCloseButton
    >
      <ScrollView contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }} keyboardShouldPersistTaps="handled">
        <Input
          label="Nombre *"
          value={name}
          onChangeText={setName}
          placeholder="Ej: Samsung"
          maxLength={100}
        />
        <Textarea
          label="Descripción"
          value={description}
          onChangeText={setDescription}
          rows={3}
          maxLength={1000}
        />
        <Toggle value={isFeatured} onChange={setIsFeatured} label="Destacada" />
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button title="Cancelar" variant="outline" onPress={() => { reset(); onClose(); }} fullWidth />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Crear" variant="primary" onPress={handleSubmit} loading={mutation.isPending} fullWidth />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}