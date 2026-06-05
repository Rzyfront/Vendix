import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Platform,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colorScales, colors } from '@/shared/theme';
import type { PopProduct, PopProductVariant, PopProductConfigResult, PricingType } from '../types';
import { defaultUnitCost } from '../constants';

interface PopConfigModalProps {
  visible: boolean;
  product: PopProduct | null;
  onConfirm: (result: PopProductConfigResult) => void;
  onCancel: () => void;
}

type ConfigTab = 'general' | 'variants' | 'lot';

export default function PopConfigModal({ visible, product, onConfirm, onCancel }: PopConfigModalProps) {
  const [tab, setTab] = useState<ConfigTab>('general');
  const [selectedVariant, setSelectedVariant] = useState<PopProductVariant | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [unitCost, setUnitCost] = useState('0');
  const [batchNumber, setBatchNumber] = useState('');
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [showManufacturingPicker, setShowManufacturingPicker] = useState(false);
  const [showExpirationPicker, setShowExpirationPicker] = useState(false);
  const [pricingType, setPricingType] = useState<PricingType>('unit');

  const [manageVariants, setManageVariants] = useState(false);
  const [manageLot, setManageLot] = useState(false);

  const variants = product?.product_variants || [];
  const hasVariants = variants.length > 0;

  const tabs: { key: ConfigTab; label: string; icon: string }[] = [{ key: 'general', label: 'General', icon: 'settings-outline' }];
  if (manageVariants) tabs.push({ key: 'variants', label: 'Variantes', icon: 'layers-outline' });
  if (manageLot) tabs.push({ key: 'lot', label: 'Lote', icon: 'cube-outline' });

  useEffect(() => {
    if (visible) {
      setTab('general');
      setSelectedVariant(null);
      setQuantity('1');
      const def = product ? defaultUnitCost(product, null) : 0;
      setUnitCost(String(def));
      setBatchNumber('');
      setManufacturingDate('');
      setExpirationDate('');
      setManageVariants(false);
      setManageLot(false);
      setShowManufacturingPicker(false);
      setShowExpirationPicker(false);
      setPricingType(product?.pricing_type || 'unit');
    }
  }, [visible, product]);

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date, target?: 'manufacturing' | 'expiration') => {
    if (Platform.OS === 'android') {
      if (target === 'manufacturing') setShowManufacturingPicker(false);
      if (target === 'expiration') setShowExpirationPicker(false);
    }
    if (!selectedDate || !target) return;
    const formatted = selectedDate.toISOString().slice(0, 10);
    if (target === 'manufacturing') setManufacturingDate(formatted);
    else setExpirationDate(formatted);
  };

  const totalCost = Number(quantity) * Number(unitCost);

  const handleConfirm = () => {
    onConfirm({
      variant: selectedVariant,
      variants: selectedVariant ? undefined : variants,
      quantity: Math.max(1, Number(quantity) || 1),
      unit_cost: Number(unitCost) || 0,
      pricing_type: pricingType,
      lot_info: manageLot ? {
        batch_number: batchNumber.trim() || undefined,
        manufacturing_date: manufacturingDate.trim() || undefined,
        expiration_date: expirationDate.trim() || undefined,
      } : undefined,
    });
  };

  if (!product) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Configurar producto</Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>{product.name}</Text>
            </View>
            <TouchableOpacity onPress={onCancel}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

              {/* Tabs dinámicas — General siempre visible; Variantes/Lote aparecen al activar los toggles */}
              <View style={styles.tabsRow}>
                {tabs.map((t) => (
                  <TouchableOpacity
                    key={t.key}
                    style={[styles.tabPill, tab === t.key && styles.tabPillActive]}
                    onPress={() => setTab(t.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name={t.icon as any} size={14} color={tab === t.key ? '#fff' : '#6b7280'} />
                    <Text style={[styles.tabPillText, tab === t.key && styles.tabPillTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

          <ScrollView style={styles.body}>
            {tab === 'general' && (
            <View>
              {/* Card de info del producto — alineado con la web (icono + nombre + costo) */}
              <View style={styles.productInfoCard}>
                <View style={styles.productInfoIcon}>
                  <Ionicons name="cube-outline" size={20} color="#374151" />
                </View>
                <View style={styles.productInfoText}>
                  <Text style={styles.productInfoName} numberOfLines={1}>{product.name}</Text>
                  <Text style={styles.productInfoCost}>Costo: ${Number(unitCost || 0).toLocaleString()}</Text>
                </View>
              </View>

                <Text style={styles.label}>Unidad de medida</Text>
                <View style={styles.pricingRow}>
                  <TouchableOpacity
                    style={[styles.pricingChip, pricingType !== 'weight' && styles.pricingChipActive]}
                    onPress={() => setPricingType('unit')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pricingChipText, pricingType !== 'weight' && styles.pricingChipTextActive]}>Unidad</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.pricingChip, pricingType === 'weight' && styles.pricingChipActive]}
                    onPress={() => setPricingType('weight')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.pricingChipText, pricingType === 'weight' && styles.pricingChipTextActive]}>Peso (kg)</Text>
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { marginTop: 16 }]}>Cantidad</Text>
                <View style={styles.qtyRow}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>
                    <Ionicons name="remove" size={20} color="#374151" />
                  </TouchableOpacity>
                  <TextInput
                    style={styles.qtyInput}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                  />
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity(String(Number(quantity) + 1))}>
                    <Ionicons name="add" size={20} color="#374151" />
                  </TouchableOpacity>
                </View>

                <Text style={[styles.label, { marginTop: 16 }]}>Costo unitario</Text>
                <View style={styles.costInputWrap}>
                  <Text style={styles.costPrefix}>$</Text>
                  <TextInput
                    style={styles.costInput}
                    value={unitCost}
                    onChangeText={setUnitCost}
                    keyboardType="decimal-pad"
                  />
                </View>

                {/* Toggle switches for variants and lot */}
                <View style={styles.togglesSection}>
                  <TouchableOpacity style={styles.settingToggleRow} onPress={() => setManageVariants(!manageVariants)} activeOpacity={0.7}>
                    <View style={styles.settingToggleInfo}>
                      <Text style={styles.settingToggleLabel}>Gestionar variantes</Text>
                      <Text style={styles.settingToggleDesc}>
                        {hasVariants
                          ? 'Seleccionar variantes del producto para la orden'
                          : 'Crear variantes para este producto'}
                      </Text>
                    </View>
                    <Switch
                      value={manageVariants}
                      onValueChange={setManageVariants}
                      trackColor={{ false: '#d1d5db', true: '#86efac' }}
                      thumbColor={manageVariants ? '#22C55E' : '#f4f3f4'}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.settingToggleRow} onPress={() => setManageLot(!manageLot)} activeOpacity={0.7}>
                    <View style={styles.settingToggleInfo}>
                      <Text style={styles.settingToggleLabel}>Gestionar lote</Text>
                      <Text style={styles.settingToggleDesc}>Asignar número de lote y fechas de fabricación/vencimiento</Text>
                    </View>
                    <Switch
                      value={manageLot}
                      onValueChange={setManageLot}
                      trackColor={{ false: '#d1d5db', true: '#86efac' }}
                      thumbColor={manageLot ? '#22C55E' : '#f4f3f4'}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.totalPreview}>
                  <Text style={styles.totalPreviewLabel}>Total:</Text>
                  <Text style={styles.totalPreviewValue}>${totalCost.toLocaleString()}</Text>
                </View>
            </View>
            )}

            {tab === 'variants' && (
              <View>
                {variants.length === 0 ? (
                  <View style={styles.emptyTab}>
                    <Ionicons name="git-branch-outline" size={28} color="#d1d5db" />
                    <Text style={styles.emptyTabText}>Este producto no tiene variantes</Text>
                  </View>
                ) : (
                  variants.map((v) => {
                    const isActive = selectedVariant?.id === v.id;
                    return (
                      <TouchableOpacity
                        key={v.id}
                        style={[styles.variantItem, isActive && styles.variantItemActive]}
                        onPress={() => setSelectedVariant(isActive ? null : v)}
                      >
                        <View style={styles.variantLeft}>
                          <View style={[styles.variantRadio, isActive && styles.variantRadioActive]}>
                            {isActive && <View style={styles.variantRadioInner} />}
                          </View>
                          <View style={styles.variantInfo}>
                            <Text style={styles.variantName}>{v.name}</Text>
                            {v.sku && <Text style={styles.variantSku}>SKU: {v.sku}</Text>}
                          </View>
                        </View>
                        <View style={styles.variantRight}>
                          <Text style={styles.variantPrice}>${Number(v.cost_price || 0).toLocaleString()}</Text>
                          <Text style={styles.variantStock}>Stock: {v.stock_quantity ?? 0}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            )}

            {tab === 'lot' && (
              <View>
                <Text style={styles.label}>Número de lote</Text>
                <TextInput
                  style={styles.input}
                  value={batchNumber}
                  onChangeText={setBatchNumber}
                  placeholder="Ej: LOTE-2026-001"
                  placeholderTextColor="#9ca3af"
                />

                <View style={styles.lotDatesRow}>
                  <View style={styles.lotDateField}>
                    <Text style={styles.label}>Fecha de fabricación</Text>
                    <TouchableOpacity style={styles.inputDate} onPress={() => setShowManufacturingPicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color="#6b7280" />
                      <Text style={[styles.inputDateText, !manufacturingDate && styles.inputDatePlaceholder]}>
                        {manufacturingDate || 'Seleccionar'}
                      </Text>
                    </TouchableOpacity>
                    {showManufacturingPicker && (
                      <DateTimePicker
                        value={manufacturingDate ? new Date(manufacturingDate + 'T12:00:00') : new Date()}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(e, d) => handleDateChange(e, d, 'manufacturing')}
                      />
                    )}
                  </View>

                  <View style={styles.lotDateField}>
                    <Text style={styles.label}>Fecha de vencimiento</Text>
                    <TouchableOpacity style={styles.inputDate} onPress={() => setShowExpirationPicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color="#6b7280" />
                      <Text style={[styles.inputDateText, !expirationDate && styles.inputDatePlaceholder]}>
                        {expirationDate || 'Seleccionar'}
                      </Text>
                    </TouchableOpacity>
                    {showExpirationPicker && (
                      <DateTimePicker
                        value={expirationDate ? new Date(expirationDate + 'T12:00:00') : new Date()}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={(e, d) => handleDateChange(e, d, 'expiration')}
                      />
                    )}
                  </View>
                </View>

                <Text style={styles.lotFootnote}>Estos datos se enviarán al proveedor con la orden de compra.</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm}>
              <Text style={styles.confirmText}>Confirmar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  // Contenedor del modal — mismo estilo de card que customers.tsx
  modal: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  headerLeft: { flex: 1, marginRight: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colorScales.gray[900] },
  headerSubtitle: { fontSize: 12, color: colorScales.gray[500], marginTop: 2 },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: colorScales.gray[100] },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 11, color: colorScales.gray[500], fontWeight: '600' },
  tabTextActive: { color: colors.background },
  tabIconActive: { color: colors.background },
  // Tabs dinámicas — fila de pills (General siempre; Variantes/Lote aparecen al activar toggles)
  tabsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  tabPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9999, backgroundColor: colorScales.gray[100] },
  tabPillActive: { backgroundColor: colors.primary },
  tabPillText: { fontSize: 11, color: colorScales.gray[500], fontWeight: '600' },
  tabPillTextActive: { color: colors.background },
  // Card de info del producto (alineado con la web)
  productInfoCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, backgroundColor: colorScales.gray[100], borderWidth: 1, borderColor: colorScales.gray[200], marginBottom: 16 },
  productInfoIcon: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.background, borderWidth: 1, borderColor: colorScales.gray[200], alignItems: 'center', justifyContent: 'center' },
  productInfoText: { flex: 1 },
  productInfoName: { fontSize: 14, fontWeight: '600', color: colorScales.gray[900] },
  productInfoCost: { fontSize: 12, color: colorScales.gray[500], marginTop: 2 },
  body: { padding: 20, maxHeight: 400 },
  label: { fontSize: 13, fontWeight: '700', color: colorScales.gray[500], marginBottom: 8 },
  input: { borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colorScales.gray[900] },
  inputDate: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  inputDateText: { fontSize: 14, color: colorScales.gray[900], flex: 1 },
  inputDatePlaceholder: { color: colorScales.gray[400] },
  lotDatesRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  lotDateField: { flex: 1 },
  lotFootnote: { fontSize: 11, color: colorScales.gray[500], marginTop: 14, lineHeight: 16 },
  pricingRow: { flexDirection: 'row', gap: 8 },
  // Pill de "Unidad de medida" — estilo web: activo = blanco + borde + texto negro; inactivo = sin borde + texto gris
  pricingChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', backgroundColor: colorScales.gray[100] },
  pricingChipActive: { borderColor: colorScales.gray[900], backgroundColor: colors.background },
  pricingChipText: { fontSize: 13, fontWeight: '600', color: colorScales.gray[400] },
  pricingChipTextActive: { color: colorScales.gray[900] },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, fontSize: 18, fontWeight: '700', textAlign: 'center', color: colorScales.gray[900] },
  costInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 12, backgroundColor: colors.background },
  costPrefix: { fontSize: 16, fontWeight: '600', color: colorScales.gray[500], marginRight: 4 },
  costInput: { flex: 1, fontSize: 16, fontWeight: '600', paddingVertical: 10, color: colorScales.gray[900] },
  togglesSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: colorScales.gray[200], gap: 8 },
  settingToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  settingToggleInfo: { flex: 1, marginRight: 12 },
  settingToggleLabel: { fontSize: 12, fontWeight: '700', color: colorScales.gray[700] },
  settingToggleDesc: { fontSize: 10, color: colorScales.gray[500], marginTop: 3, lineHeight: 14 },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: colorScales.gray[200] },
  totalPreviewLabel: { fontSize: 15, fontWeight: '700', color: colorScales.gray[900] },
  totalPreviewValue: { fontSize: 20, fontWeight: '800', color: colorScales.green[700] },
  emptyTab: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyTabText: { fontSize: 14, color: colorScales.gray[400] },
  variantItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: colorScales.gray[200] },
  variantItemActive: { borderColor: colors.primary, backgroundColor: colorScales.green[50] },
  variantLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  variantRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colorScales.gray[300], alignItems: 'center', justifyContent: 'center' },
  variantRadioActive: { borderColor: colors.primary },
  variantRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
  variantInfo: { flex: 1 },
  variantName: { fontSize: 14, fontWeight: '600', color: colorScales.gray[900] },
  variantSku: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  variantRight: { alignItems: 'flex-end' },
  variantPrice: { fontSize: 14, fontWeight: '700', color: colorScales.green[700] },
  variantStock: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: colorScales.gray[200] },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colorScales.gray[300], alignItems: 'center', backgroundColor: colors.background },
  cancelText: { fontSize: 14, fontWeight: '600', color: colorScales.gray[700] },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmText: { fontSize: 14, fontWeight: '700', color: colors.background },
});
