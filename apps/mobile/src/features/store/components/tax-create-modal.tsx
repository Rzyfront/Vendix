import { useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input, Selector, Textarea, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { ProductService } from '@/features/store/services';
import type { CreateTaxCategoryDto } from '@/features/store/services/product.service';
import type { TaxCategory } from '@/features/store/types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface TaxCreateModalProps {
  visible: boolean;
  onClose: () => void;
  /** Llamado cuando el impuesto se crea exitosamente. Devuelve el tax real con id del backend. */
  onCreated?: (tax: TaxCategory) => void;
}

const CALC_TYPE_OPTIONS = [
  { label: 'Porcentaje', value: 'percentage' },
  { label: 'Fijo', value: 'fixed' },
];

const FISCAL_CLASS_OPTIONS = [
  { label: 'IVA', value: 'iva' },
  { label: 'Impoconsumo (INC)', value: 'inc' },
  { label: 'ICA', value: 'ica' },
  { label: 'Retención', value: 'withholding' },
  { label: 'ReteIVA', value: 'reteiva' },
  { label: 'ReteICA', value: 'reteica' },
];

export function TaxCreateModal({ visible, onClose, onCreated }: TaxCreateModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [calcType, setCalcType] = useState('percentage');
  const [fiscalClass, setFiscalClass] = useState('iva');
  const [rate, setRate] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      rate: number;
      type: 'percentage' | 'fixed';
      tax_type: CreateTaxCategoryDto['tax_type'];
      description?: string;
    }) =>
      ProductService.createTaxCategory({
        name: data.name,
        rate: data.rate,
        type: data.type,
        tax_type: data.tax_type,
        description: data.description,
      }),
    onSuccess: (created) => {
      toastSuccess(`Impuesto "${created.name}" creado`);
      // Refrescar la query de taxes para que la nueva aparezca en la lista
      queryClient.invalidateQueries({ queryKey: ['product-taxes'] });
      onCreated?.(created);
      reset();
      onClose();
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'No se pudo crear la categoría de impuesto';
      toastError(message);
    },
  });

  function reset() {
    setName('');
    setCalcType('percentage');
    setFiscalClass('iva');
    setRate('');
    setDescription('');
  }

  function handleClose() {
    if (createMutation.isPending) return;
    reset();
    onClose();
  }

  function handleSubmit() {
    const trimmedName = name.trim();
    const numericRate = Number(rate);

    if (!trimmedName) {
      toastError('Ingresa el nombre del impuesto');
      return;
    }
    if (!Number.isFinite(numericRate) || numericRate < 0) {
      toastError('Ingresa una tasa válida (>= 0)');
      return;
    }

    createMutation.mutate({
      name: trimmedName,
      rate: calcType === 'percentage' ? numericRate / 100 : numericRate,
      type: calcType as 'percentage' | 'fixed',
      tax_type: fiscalClass as CreateTaxCategoryDto['tax_type'],
      description: description.trim() || undefined,
    });
  }

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Crear Nueva Categoría de Impuesto
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { backgroundColor: colorScales.gray[100] },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Icon name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Input
                label="Nombre de la Categoría"
                value={name}
                onChangeText={setName}
                placeholder="Ej. IVA, IVA Reducido"
                required
                maxLength={120}
                editable={!createMutation.isPending}
              />
              <Selector
                label="Tipo de cálculo"
                value={calcType}
                onChange={(v) => setCalcType(v as string)}
                options={CALC_TYPE_OPTIONS}
                placeholder="Seleccionar tipo"
                required
                disabled={createMutation.isPending}
              />
              <Selector
                label="Clasificación fiscal"
                value={fiscalClass}
                onChange={(v) => setFiscalClass(v as string)}
                options={FISCAL_CLASS_OPTIONS}
                placeholder="Seleccionar clasificación"
                required
                disabled={createMutation.isPending}
              />
              <Input
                label="Tasa"
                value={rate}
                onChangeText={setRate}
                placeholder={calcType === 'percentage' ? 'Ej. 19' : 'Ej. 5000'}
                keyboardType="decimal-pad"
                required
                rightIcon={<Text style={styles.suffixText}>{calcType === 'percentage' ? '%' : '$'}</Text>}
                editable={!createMutation.isPending}
              />
              <Textarea
                label="Descripción"
                value={description}
                onChangeText={setDescription}
                placeholder="Descripción de la categoría de impuesto (opcional)"
                rows={3}
                maxLength={500}
                editable={!createMutation.isPending}
              />
            </ScrollView>

            <View style={styles.footer}>
              <View style={styles.footerButtonWrap}>
                <Button
                  title="Cancelar"
                  variant="outline"
                  onPress={handleClose}
                  fullWidth
                  disabled={createMutation.isPending}
                />
              </View>
              <View style={styles.footerButtonWrap}>
                <Button
                  title={createMutation.isPending ? 'Creando…' : 'Crear Impuesto'}
                  variant="primary"
                  onPress={handleSubmit}
                  fullWidth
                  loading={createMutation.isPending}
                />
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const CARD_MAX_WIDTH = 480;

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
    maxHeight: '90%',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  footerButtonWrap: {
    flex: 1,
  },
  suffixText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
  },
});
