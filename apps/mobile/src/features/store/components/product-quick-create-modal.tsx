import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Modal, Input, MultiSelector, Button } from '@/shared/components';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { ProductService } from '@/features/store/services/product.service';
import { colors, spacing } from '@/shared/theme';

interface ProductQuickCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (productId: number) => void;
}

export function ProductQuickCreateModal({ visible, onClose, onCreated }: ProductQuickCreateModalProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [sku, setSku] = useState('');
  const [taxIds, setTaxIds] = useState<number[]>([]);

  const { data: taxesResp } = useQuery({
    queryKey: ['product-taxes'],
    queryFn: () => ProductService.getTaxes(),
    enabled: visible,
  });

  const taxes: any[] = Array.isArray(taxesResp) ? taxesResp : ((taxesResp as any)?.data ?? []);

  const mutation = useMutation({
    mutationFn: () =>
      ProductService.create({
        name: name.trim(),
        base_price: Number(basePrice) || 0,
        sku: sku.trim() || undefined,
        tax_category_ids: taxIds.length > 0 ? taxIds : undefined,
        product_type: 'physical',
        pricing_type: 'unit',
        state: 'active',
      }),
    onSuccess: (product) => {
      toastSuccess('Producto creado');
      onCreated?.(product.id);
      reset();
      onClose();
    },
    onError: (err: any) => {
      toastError(err?.response?.data?.message || 'No se pudo crear el producto');
    },
  });

  function reset() {
    setName('');
    setBasePrice('');
    setSku('');
    setTaxIds([]);
  }

  function handleSubmit() {
    if (!name.trim()) {
      toastError('El nombre es obligatorio');
      return;
    }
    if (!basePrice || Number(basePrice) <= 0) {
      toastError('Indicá un precio válido');
      return;
    }
    mutation.mutate();
  }

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title="Nuevo Producto"
      showCloseButton
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing[4], gap: spacing[3] }}
        keyboardShouldPersistTaps="handled"
      >
        <Input
          label="Nombre *"
          value={name}
          onChangeText={setName}
          placeholder="Ej: Camiseta deportiva"
          maxLength={255}
        />
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Input
              label="Precio *"
              value={basePrice}
              onChangeText={setBasePrice}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="SKU"
              value={sku}
              onChangeText={setSku}
              placeholder="opcional"
            />
          </View>
        </View>
        {taxes.length > 0 && (
          <MultiSelector
            label="Impuestos"
            values={taxIds}
            onChange={setTaxIds}
            options={taxes.map((t: any) => ({ label: t.name, value: t.id }))}
            placeholder="Seleccionar impuestos"
          />
        )}
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Cancelar"
              variant="outline"
              onPress={() => {
                reset();
                onClose();
              }}
              fullWidth
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Crear Producto"
              variant="primary"
              onPress={handleSubmit}
              loading={mutation.isPending}
              fullWidth
            />
          </View>
        </View>
        <Button
          title="Configuración Avanzada"
          variant="ghost"
          onPress={() => {
            onClose();
            router.push('/(store-admin)/products/create');
          }}
          fullWidth
        />
      </ScrollView>
    </Modal>
  );
}