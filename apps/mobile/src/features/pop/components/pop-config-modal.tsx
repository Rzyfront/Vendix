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
import type { PopProduct, PopProductVariant, PopProductConfigResult, LotInfo } from '../types';
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

  const [manageVariants, setManageVariants] = useState(false);
  const [manageLot, setManageLot] = useState(false);

  const variants = product?.product_variants || [];
  const isWeight = product?.pricing_type === 'weight';
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
      lot_info: manageLot ? {
        batch_number: batchNumber.trim() || undefined,
        manufacturing_date: manufacturingDate.trim() || undefined,
        expiration_date: expirationDate.trim() || undefined,
      } : undefined,
    });
  };

  if (!product) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
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

              <View style={styles.tabs}>
                {tabs.map((t) => (
                  <TouchableOpacity key={t.key} style={[styles.tab, tab === t.key && styles.tabActive]} onPress={() => setTab(t.key)}>
                    <Ionicons name={t.icon as any} size={14} color={tab === t.key ? '#fff' : '#6b7280'} />
                    <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

          <ScrollView style={styles.body}>
            {tab === 'general' && (
              <View>
                <Text style={styles.label}>Tipo de precio</Text>
                <View style={styles.pricingRow}>
                  <TouchableOpacity style={[styles.pricingChip, !isWeight && styles.pricingChipActive]}>
                    <Text style={[styles.pricingChipText, !isWeight && styles.pricingChipTextActive]}>Unidad</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.pricingChip, isWeight && styles.pricingChipActive]}>
                    <Text style={[styles.pricingChipText, isWeight && styles.pricingChipTextActive]}>Peso</Text>
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
              <Ionicons name="cart" size={16} color="#fff" />
              <Text style={styles.confirmText}>Agregar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerLeft: { flex: 1, marginRight: 12 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  headerSubtitle: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  tabs: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#f3f4f6' },
  tabActive: { backgroundColor: '#22C55E' },
  tabText: { fontSize: 11, color: '#6b7280', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  tabIconActive: { color: '#fff' },
  body: { padding: 20, maxHeight: 400 },
  label: { fontSize: 13, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#111827' },
  inputDate: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  inputDateText: { fontSize: 14, color: '#111827', flex: 1 },
  inputDatePlaceholder: { color: '#9ca3af' },
  lotDatesRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  lotDateField: { flex: 1 },
  lotFootnote: { fontSize: 11, color: '#6b7280', marginTop: 14, lineHeight: 16 },
  pricingRow: { flexDirection: 'row', gap: 8 },
  pricingChip: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center', backgroundColor: '#fff' },
  pricingChipActive: { borderColor: '#22C55E', backgroundColor: '#dcfce7' },
  pricingChipText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  pricingChipTextActive: { color: '#22C55E' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, fontSize: 18, fontWeight: '700', textAlign: 'center', color: '#111827' },
  costInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, backgroundColor: '#fff' },
  costPrefix: { fontSize: 16, fontWeight: '600', color: '#6b7280', marginRight: 4 },
  costInput: { flex: 1, fontSize: 16, fontWeight: '600', paddingVertical: 10, color: '#111827' },
  togglesSection: { marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e5e7eb', gap: 8 },
  settingToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  settingToggleInfo: { flex: 1, marginRight: 12 },
  settingToggleLabel: { fontSize: 12, fontWeight: '700', color: '#374151' },
  settingToggleDesc: { fontSize: 10, color: '#6b7280', marginTop: 3, lineHeight: 14 },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  totalPreviewLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  totalPreviewValue: { fontSize: 20, fontWeight: '800', color: '#059669' },
  emptyTab: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  emptyTabText: { fontSize: 14, color: '#9ca3af' },
  variantItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  variantItemActive: { borderColor: '#22C55E', backgroundColor: '#dcfce7' },
  variantLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  variantRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  variantRadioActive: { borderColor: '#22C55E' },
  variantRadioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' },
  variantInfo: { flex: 1 },
  variantName: { fontSize: 14, fontWeight: '600', color: '#111827' },
  variantSku: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  variantRight: { alignItems: 'flex-end' },
  variantPrice: { fontSize: 14, fontWeight: '700', color: '#059669' },
  variantStock: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 8, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
