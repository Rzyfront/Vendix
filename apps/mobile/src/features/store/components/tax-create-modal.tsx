import { useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { Modal, Input, Selector, Textarea, Button } from '@/shared/components';
import { toastSuccess } from '@/shared/components/toast/toast.store';
import { colors, spacing } from '@/shared/theme';

interface TaxCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (tax: { id: number; name: string }) => void;
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
  const [name, setName] = useState('');
  const [calcType, setCalcType] = useState('percentage');
  const [fiscalClass, setFiscalClass] = useState('iva');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');

  function reset() {
    setName('');
    setCalcType('percentage');
    setFiscalClass('iva');
    setRate('');
    setDescription('');
  }

  function handleSubmit() {
    if (!name.trim()) {
      toastSuccess('Funcionalidad próximamente');
      return;
    }
    const fakeId = Date.now();
    onCreated?.({ id: fakeId, name: name.trim() });
    toastSuccess('Impuesto agregado (local)');
    reset();
    onClose();
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
              fullWidth
            />
          </View>
        </View>
      </ScrollView>
    </Modal>
  );
}
