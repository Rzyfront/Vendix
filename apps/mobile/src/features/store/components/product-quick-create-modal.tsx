import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { ProductService } from '@/features/store/services/product.service';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface ProductQuickCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (productId: number) => void;
}

function Field({
  label,
  required,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>
        {label.toUpperCase()}
        {required && <Text style={styles.fieldRequired}> *</Text>}
      </Text>
      {children}
      {helper && <Text style={styles.fieldHelper}>{helper}</Text>}
    </View>
  );
}

export function ProductQuickCreateModal({ visible, onClose, onCreated }: ProductQuickCreateModalProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [taxIds, setTaxIds] = useState<number[]>([]);
  const [taxesOpen, setTaxesOpen] = useState(false);

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
        barcode: barcode.trim() || undefined,
        tax_category_ids: taxIds.length > 0 ? taxIds : undefined,
        product_type: 'physical',
        pricing_type: 'unit',
        state: 'active',
      }),
    onSuccess: (product) => {
      toastSuccess('Producto creado exitosamente');
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
    setBarcode('');
    setTaxIds([]);
    setTaxesOpen(false);
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

  const selectedTaxes = taxes.filter((t: any) => taxIds.includes(t.id));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.centered}
      >
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Nuevo Producto</Text>
              <Text style={styles.subtitle}>Configura los productos esenciales</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeButton}>
              <Icon name="x" size={22} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <Field label="Nombre del producto" required>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Ej. Camiseta Algodón Premium"
                placeholderTextColor={colorScales.gray[400]}
                maxLength={255}
              />
            </Field>

            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <View style={{ flex: 1.3 }}>
                  <Field label="Precio base" required>
                    <TextInput
                      style={styles.input}
                      value={basePrice}
                      onChangeText={setBasePrice}
                      placeholder="0"
                      placeholderTextColor={colorScales.gray[400]}
                      keyboardType="numeric"
                    />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="SKU" helper="Opcional">
                    <TextInput
                      style={styles.input}
                      value={sku}
                      onChangeText={setSku}
                      placeholder="Ej. CAM-001"
                      placeholderTextColor={colorScales.gray[400]}
                    />
                  </Field>
                </View>
              </View>

            <Field label="Código de barras">
              <TextInput
                style={styles.input}
                value={barcode}
                onChangeText={setBarcode}
                placeholder="Escanea o escribe"
                placeholderTextColor={colorScales.gray[400]}
              />
              <Text style={styles.fieldHelperBelow}>
                Código escaneable (EAN/UPC) único en la tienda.
              </Text>
            </Field>

            {/* Banner azul de info */}
            <View style={styles.infoBanner}>
              <Text style={styles.infoBannerText}>
                Se creará como definición comercial, sin stock ni costos. Regístralos luego en Inventario &gt; POG.
              </Text>
            </View>

            {/* Selector de Impuestos (IVA) */}
            <Field label="Impuestos (IVA)">
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <Pressable
                  onPress={() => setTaxesOpen(!taxesOpen)}
                  style={({ pressed }) => [
                    styles.taxSelect,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.taxSelectText,
                      taxIds.length > 0 ? styles.taxSelectTextActive : styles.taxSelectTextPlaceholder,
                    ]}
                    numberOfLines={1}
                  >
                    {taxIds.length === 0
                      ? 'Seleccionar impuestos…'
                      : taxIds.length === 1
                        ? selectedTaxes[0]?.name
                        : `${taxIds.length} impuestos seleccionados`}
                  </Text>
                  <Icon
                    name={taxesOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (taxes.length > 0 && taxIds.length < taxes.length) {
                      setTaxIds(taxes.map((t: any) => t.id));
                    }
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.7 }]}
                >
                  <Icon name="plus" size={18} color={colors.primary} />
                </Pressable>
              </View>
              {taxesOpen && (
                <View style={styles.taxList}>
                  {taxes.map((tax: any, index: number) => {
                    const isSelected = taxIds.includes(tax.id);
                    return (
                      <Pressable
                        key={tax.id}
                        onPress={() => {
                          if (isSelected) {
                            setTaxIds(taxIds.filter((id) => id !== tax.id));
                          } else {
                            setTaxIds([...taxIds, tax.id]);
                          }
                        }}
                        style={({ pressed }) => [
                          styles.taxOption,
                          isSelected && styles.taxOptionActive,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.taxOptionText,
                            isSelected && styles.taxOptionTextActive,
                          ]}
                        >
                          {tax.name}
                        </Text>
                        {isSelected && <Icon name="check" size={16} color={colors.primary} />}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </Field>

            {/* Separator "Opcional" + Configuración avanzada */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>Opcional</Text>
              <View style={styles.dividerLine} />
            </View>
            <Pressable
              onPress={() => {
                onClose();
                router.push('/(store-admin)/products/create');
              }}
              style={({ pressed }) => [styles.advancedBtn, pressed && { opacity: 0.6 }]}
            >
              <Icon name="settings" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.advancedTitle}>Configuración avanzada</Text>
                <Text style={styles.advancedSubtitle} numberOfLines={1}>
                  Variantes, imágenes, descripción y…
                </Text>
              </View>
              <Icon name="arrow-right" size={16} color={colors.primary} />
            </Pressable>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing[5],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: '700',
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 4,
  },
  closeButton: {
    padding: 4,
    marginLeft: spacing[2],
    marginTop: -2,
  },
  body: {
    padding: spacing[4],
    paddingTop: spacing[3],
    gap: spacing[3],
  },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colorScales.gray[700],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldRequired: {
    color: colors.error,
    fontWeight: '700',
  },
  fieldHelper: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 4,
  },
  fieldHelperBelow: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 4,
  },
  input: {
    backgroundColor: colorScales.gray[50],
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    fontFamily: typography.fontFamily,
  },
  infoBanner: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3],
  },
  infoBannerText: {
    fontSize: typography.fontSize.xs,
    color: '#1E40AF',
  },
  taxSelect: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
  },
  taxSelectText: {
    fontSize: typography.fontSize.sm,
    flex: 1,
  },
  taxSelectTextActive: {
    color: colorScales.gray[800],
  },
  taxSelectTextPlaceholder: {
    color: colorScales.gray[500],
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxList: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: 10,
    backgroundColor: colors.background,
    overflow: 'hidden',
    marginTop: spacing[1],
  },
  taxOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  taxOptionActive: {
    backgroundColor: colorScales.green[50],
  },
  taxOptionText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    fontWeight: '500',
  },
  taxOptionTextActive: {
    fontWeight: '700',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colorScales.gray[200],
  },
  dividerText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  advancedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
  },
  advancedTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600',
    color: colors.text.primary,
  },
  advancedSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[2],
    padding: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
});