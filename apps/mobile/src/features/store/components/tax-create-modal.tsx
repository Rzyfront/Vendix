import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Input, Selector, Textarea, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { apiClient } from '@/core/api';
import { colors, spacing, borderRadius, typography } from '@/shared/theme';

interface TaxCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (tax: any) => void;
}

const CALC_TYPE_OPTIONS = [
  { label: 'Porcentaje', value: 'percentage' },
  { label: 'Fijo', value: 'fixed' },
];

const FISCAL_CLASS_OPTIONS = [
  { label: 'IVA', value: 'iva' },
  { label: 'INC', value: 'inc' },
  { label: 'Retefuente', value: 'retefuente' },
  { label: 'ReteICA', value: 'reteica' },
  { label: 'Otro', value: 'other' },
];

export function TaxCreateModal({ visible, onClose, onCreated }: TaxCreateModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [calcType, setCalcType] = useState('percentage');
  const [fiscalClass, setFiscalClass] = useState('iva');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  function reset() {
    setName('');
    setCalcType('percentage');
    setFiscalClass('iva');
    setRate('');
    setDescription('');
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toastError('El nombre es obligatorio');
      return;
    }
    if (!rate || Number(rate) <= 0) {
      toastError('Indicá una tasa válida');
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.post('/store/taxes/categories', {
        name: name.trim(),
        calculation_type: calcType,
        fiscal_class: fiscalClass,
        rate: Number(rate),
        description: description.trim() || undefined,
      });
      const tax = (res.data as any)?.data ?? res.data;
      toastSuccess('Impuesto creado');
      queryClient.invalidateQueries({ queryKey: ['product-taxes'] });
      onCreated?.(tax);
      reset();
      onClose();
    } catch (err: any) {
      toastError(err?.response?.data?.message || 'No se pudo crear el impuesto');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Crear Nueva Categoría de Impuesto"
      showCloseButton
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="Nombre de la categoría *"
          value={name}
          onChangeText={setName}
          placeholder="Ej: IVA, INC, ReteFuente"
          maxLength={120}
        />
        <Selector
          label="Tipo de cálculo *"
          value={calcType}
          onChange={(v) => setCalcType(v as string)}
          options={CALC_TYPE_OPTIONS}
        />
        <Selector
          label="Clasificación fiscal *"
          value={fiscalClass}
          onChange={(v) => setFiscalClass(v as string)}
          options={FISCAL_CLASS_OPTIONS}
        />
        <Input
          label="Tasa *"
          value={rate}
          onChangeText={setRate}
          placeholder="Ej. 19"
          keyboardType="decimal-pad"
        />
        <Textarea
          label="Descripción"
          value={description}
          onChangeText={setDescription}
          placeholder="Descripción de la categoría de impuesto (opcional)"
          rows={3}
          maxLength={500}
        />
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Cancelar"
              variant="outline"
              onPress={() => { reset(); onClose(); }}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Crear Impuesto"
              variant="primary"
              onPress={handleSubmit}
              loading={loading}
              fullWidth
            />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}
