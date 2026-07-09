import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { useQuery } from '@tanstack/react-query';
import { ProductService } from '@/features/store/services';
import type { TaxCategory } from '@/features/store/types';

interface PosCustomItemModalProps {
  visible: boolean;
  onClose: () => void;
  onAdd: (data: { name: string; description?: string; quantity: number; price: number; taxRate?: number }) => void;
}

function getTaxRate(category: TaxCategory | null): number {
  if (!category?.tax_rates) return 0;
  return category.tax_rates.reduce((sum, r) => sum + Number(r.rate || 0), 0);
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function PosCustomItemModal({ visible, onClose, onAdd }: PosCustomItemModalProps) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [selectedTaxCategory, setSelectedTaxCategory] = useState<TaxCategory | null>(null);
  const [showTaxDropdown, setShowTaxDropdown] = useState(false);

  const { data: taxCategories = [], isLoading: taxLoading } = useQuery({
    queryKey: ['tax-categories'],
    queryFn: () => ProductService.getTaxes(),
    enabled: visible,
  });

  const parsedQty = parseInt(quantity, 10) || 1;
  const parsedPrice = parseFloat(price) || 0;
  const taxRate = getTaxRate(selectedTaxCategory);
  const basePrice = taxRate > 0 ? parsedPrice / (1 + taxRate) : parsedPrice;
  const taxAmountPerUnit = parsedPrice - basePrice;
  const totalTax = taxAmountPerUnit * parsedQty;
  const totalLine = parsedPrice * parsedQty;
  const isValid = name.trim().length > 0 && parsedPrice > 0;

  const handleAdd = () => {
    if (!isValid) return;
    onAdd({
      name: name.trim(),
      description: description.trim() || undefined,
      quantity: parsedQty,
      price: taxRate > 0 ? basePrice : parsedPrice,
      taxRate: taxRate > 0 ? taxRate : undefined,
    });
    setName('');
    setDescription('');
    setQuantity('1');
    setPrice('');
    setSelectedTaxCategory(null);
    onClose();
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setQuantity('1');
    setPrice('');
    setSelectedTaxCategory(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable
            style={[styles.container, { paddingBottom: 0 }]}
            onPress={(e) => e.stopPropagation()}
          >
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Icon name="file-plus" size={20} color={colors.primary} />
            </View>
            <Text style={styles.title}>Ítem personalizado</Text>
          </View>
          <Pressable onPress={handleClose} style={styles.closeBtn}>
            <Icon name="x" size={24} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        <ScrollView style={styles.form} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Nombre *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Ej: Servicio de instalación"
            placeholderTextColor={colorScales.gray[400]}
            autoFocus
          />

          <Text style={styles.label}>Descripción</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={description}
            onChangeText={setDescription}
            placeholder="Descripción opcional"
            placeholderTextColor={colorScales.gray[400]}
            multiline
            numberOfLines={3}
          />

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>Cantidad</Text>
              <View style={styles.qtyRow}>
                <Pressable
                  onPress={() => setQuantity(Math.max(1, parsedQty - 1).toString())}
                  style={styles.qtyBtn}
                >
                  <Icon name="minus" size={14} color={colorScales.gray[600]} />
                </Pressable>
                <TextInput
                  style={styles.qtyInput}
                  value={quantity}
                  onChangeText={(v) => setQuantity(v.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  textAlign="center"
                />
                <Pressable
                  onPress={() => setQuantity((parsedQty + 1).toString())}
                  style={[styles.qtyBtn, styles.qtyBtnPlus]}
                >
                  <Icon name="plus" size={14} color={colors.primary} />
                </Pressable>
              </View>
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Precio final *</Text>
              <View style={styles.priceInputWrapper}>
                <Text style={styles.currencySign}>$</Text>
                <TextInput
                  style={styles.priceInput}
                  value={price}
                  onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))}
                  placeholder="0.00"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </View>

          {/* IVA / Impuesto */}
          <View style={styles.field}>
            <Text style={styles.label}>IVA / Impuesto</Text>
            <Pressable
              style={styles.selectInput}
              onPress={() => {
                Keyboard.dismiss();
                setShowTaxDropdown(!showTaxDropdown);
              }}
            >
              <Text style={!selectedTaxCategory ? styles.selectPlaceholder : styles.selectText}>
                {selectedTaxCategory
                  ? `${selectedTaxCategory.name} (${formatRate(taxRate)})`
                  : 'Sin impuesto'}
              </Text>
              {taxLoading ? (
                <ActivityIndicator size="small" color={colorScales.gray[400]} />
              ) : (
                <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
              )}
            </Pressable>
            {showTaxDropdown && (
              <View style={styles.dropdown}>
                <Pressable
                  style={[styles.dropdownItem, !selectedTaxCategory && styles.dropdownItemActive]}
                  onPress={() => {
                    setSelectedTaxCategory(null);
                    setShowTaxDropdown(false);
                  }}
                >
                  <Text style={[styles.dropdownItemText, !selectedTaxCategory && styles.dropdownItemTextActive]}>
                    Sin impuesto
                  </Text>
                  {!selectedTaxCategory && <Icon name="check" size={16} color={colors.primary} />}
                </Pressable>
                {taxCategories.map((tax) => {
                  const rate = getTaxRate(tax);
                  const isActive = selectedTaxCategory?.id === tax.id;
                  return (
                    <Pressable
                      key={tax.id}
                      style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                      onPress={() => {
                        setSelectedTaxCategory(tax);
                        setShowTaxDropdown(false);
                      }}
                    >
                      <Text style={[styles.dropdownItemText, isActive && styles.dropdownItemTextActive]}>
                        {tax.name} ({formatRate(rate)})
                      </Text>
                      {isActive && <Icon name="check" size={16} color={colors.primary} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Price breakdown */}
          {parsedPrice > 0 && (
            <View style={styles.breakdown}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Base</Text>
                <Text style={styles.breakdownValue}>
                  ${(basePrice * parsedQty).toLocaleString('es-CO', { minimumFractionDigits: 2 })}
                </Text>
              </View>
              {taxRate > 0 && (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>IVA / impuesto ({formatRate(taxRate)})</Text>
                  <Text style={styles.breakdownValue}>
                    ${totalTax.toLocaleString('es-CO', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              )}
              <View style={styles.breakdownTotal}>
                <Text style={styles.breakdownTotalLabel}>Total línea</Text>
                <Text style={styles.breakdownTotalValue}>
                  ${totalLine.toLocaleString('es-CO', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            </View>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[3] }]}>
          <Pressable style={styles.cancelBtn} onPress={handleClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={[styles.addBtn, !isValid && styles.addBtnDisabled]}
            onPress={handleAdd}
            disabled={!isValid}
          >
            <Icon name="plus" size={18} color="#FFFFFF" />
            <Text style={styles.addText}>Agregar</Text>
          </Pressable>
        </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  closeBtn: {
    padding: spacing[1],
  },
  form: {
    flex: 1,
  },
  formContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[1],
  },
  input: {
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: spacing[2],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  halfField: {
    flex: 1,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  qtyBtn: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  qtyBtnPlus: {
    backgroundColor: colorScales.green[50],
  },
  qtyInput: {
    flex: 1,
    height: 44,
    textAlign: 'center',
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  priceInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
  },
  currencySign: {
    paddingLeft: spacing[3],
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  priceInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: spacing[2],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  field: {
    gap: spacing[1],
  },
  selectInput: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.background,
  },
  selectText: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    flex: 1,
  },
  selectPlaceholder: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    flex: 1,
  },
  dropdown: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownItemActive: {
    backgroundColor: colorScales.green[50],
  },
  dropdownItemText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    flex: 1,
  },
  dropdownItemTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  breakdown: {
    backgroundColor: colorScales.blue[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    gap: spacing[2],
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.blue[700],
  },
  breakdownValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.blue[700],
  },
  breakdownTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.blue[200],
  },
  breakdownTotalLabel: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.blue[800],
  },
  breakdownTotalValue: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.blue[800],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  cancelText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  addBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
