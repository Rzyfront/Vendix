import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import type { PopSupplier, PopLocation, ShippingMethod } from '../types';
import { SHIPPING_METHOD_LABELS } from '../constants';

interface PopHeaderProps {
  supplierName?: string;
  locationName?: string;
  orderDate: string;
  expectedDate?: string;
  shippingMethod?: ShippingMethod;
  paymentTerms?: string;
  notes?: string;
  suppliers: PopSupplier[];
  locations: PopLocation[];
  showConfigWarning?: boolean;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  onSupplierChange: (id?: number, name?: string) => void;
  onLocationChange: (id?: number, name?: string) => void;
  onOrderDateChange: (date: string) => void;
  onExpectedDateChange: (date?: string) => void;
  onShippingMethodChange: (method?: ShippingMethod) => void;
  onPaymentTermsChange: (terms?: string) => void;
  onNotesChange: (notes?: string) => void;
  onQuickAddSupplier?: () => void;
  onQuickAddLocation?: () => void;
  title?: string;
  subtitle?: string;
  badge?: string;
  icon?: string;
}

export default function PopHeader({
  supplierName,
  locationName,
  orderDate,
  expectedDate,
  shippingMethod,
  paymentTerms,
  notes,
  suppliers,
  locations,
  showConfigWarning,
  settingsOpen: settingsOpenProp,
  onSettingsOpenChange,
  onSupplierChange,
  onLocationChange,
  onOrderDateChange,
  onExpectedDateChange,
  onShippingMethodChange,
  onPaymentTermsChange,
  onNotesChange,
  onQuickAddSupplier,
  onQuickAddLocation,
  title = 'POP',
  subtitle = 'Punto de Compra',
  badge,
  icon = 'bag-handle',
}: PopHeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showSuppliers, setShowSuppliers] = useState(false);
  const [showLocations, setShowLocations] = useState(false);
  const [showShipping, setShowShipping] = useState(false);

  const [datePickerTarget, setDatePickerTarget] = useState<'order' | 'expected' | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const [supplierDims, setSupplierDims] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const [locationDims, setLocationDims] = useState({ top: 0, left: 0, width: 0, height: 0 });
  const supplierSelectorRef = useRef<View>(null);
  const locationSelectorRef = useRef<View>(null);
  const containerRef = useRef<View>(null);

  const measureSupplier = () => {
    containerRef.current?.measureInWindow((_cx, cy) => {
      supplierSelectorRef.current?.measureInWindow((x, y, w, h) => {
        setSupplierDims({ top: y - cy, left: x, width: w, height: h });
      });
    });
  };
  const measureLocation = () => {
    containerRef.current?.measureInWindow((_cx, cy) => {
      locationSelectorRef.current?.measureInWindow((x, y, w, h) => {
        setLocationDims({ top: y - cy, left: x, width: w, height: h });
      });
    });
  };

  useEffect(() => {
    if (settingsOpenProp) {
      setShowSettings(true);
    }
  }, [settingsOpenProp]);

  const toggleSettings = () => {
    const next = !showSettings;
    setShowSettings(next);
    if (onSettingsOpenChange) {
      onSettingsOpenChange(next);
    }
  };

  const handleDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (!selectedDate || !datePickerTarget) return;
    const formatted = selectedDate.toISOString().slice(0, 10);
    if (datePickerTarget === 'order') {
      onOrderDateChange(formatted);
    } else {
      onExpectedDateChange(formatted);
    }
  };

  const openDatePicker = (target: 'order' | 'expected') => {
    setDatePickerTarget(target);
    setShowDatePicker(true);
  };

  const hasConfig = !!supplierName || !!locationName || !!expectedDate;

  return (
    <View ref={containerRef} style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.titleRow}>
          <View style={styles.titleIcon}>
            <Ionicons name={icon as any} size={20} color="#22C55E" />
          </View>
          <View style={styles.titleBlock}>
            <View style={styles.titleBadgeRow}>
              <Text style={styles.title}>{title}</Text>
              {badge && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
            </View>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.settingsToggle} onPress={toggleSettings}>
          <Ionicons name={showSettings ? 'chevron-up' : 'settings-outline'} size={18} color="#374151" />
          <Text style={styles.settingsToggleText}>{showSettings ? 'Ocultar' : 'Ajustes'}</Text>
        </TouchableOpacity>
      </View>

      {!showSettings && hasConfig && (
        <View style={styles.pillsRow}>
          {supplierName && (
            <View style={[styles.pill, styles.pillSupplier]}>
              <Ionicons name="car" size={12} color="#22C55E" />
              <Text style={[styles.pillText, styles.pillTextSupplier]} numberOfLines={1}>{supplierName}</Text>
            </View>
          )}
          {supplierName && locationName && (
            <Ionicons name="chevron-forward" size={12} color="#9ca3af" />
          )}
          {locationName && (
            <View style={[styles.pill, styles.pillLocation]}>
              <Ionicons name="business" size={12} color="#059669" />
              <Text style={[styles.pillText, styles.pillTextLocation]} numberOfLines={1}>{locationName}</Text>
            </View>
          )}
          {locationName && expectedDate && (
            <Ionicons name="chevron-forward" size={12} color="#9ca3af" />
          )}
          {expectedDate && (
            <View style={[styles.pill, styles.pillDate]}>
              <Ionicons name="calendar" size={12} color="#d97706" />
              <Text style={[styles.pillText, styles.pillTextDate]}>{expectedDate?.slice(5)}</Text>
            </View>
          )}
        </View>
      )}

      {showSettings && (
        <View style={styles.settingsPanel}>
          <View style={[styles.fieldsRow, showConfigWarning && styles.configWarning]}>
            <View style={styles.fieldWrapper}>
              <Text style={styles.label}>Proveedor <Text style={styles.required}>*</Text></Text>
              <View style={styles.fieldRow}>
                <View ref={supplierSelectorRef} style={styles.selectorWrapper} onLayout={measureSupplier}>
                  <TouchableOpacity style={styles.selector} onPress={() => { setShowSuppliers(!showSuppliers); setShowLocations(false); setShowShipping(false); measureSupplier(); }}>
                    <Text style={supplierName ? styles.value : styles.placeholder} numberOfLines={1}>
                      {supplierName || 'Seleccionar'}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color="#6b7280" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.quickAddBtn} onPress={onQuickAddSupplier}>
                  <Ionicons name="add" size={18} color="#22C55E" />
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.fieldWrapper}>
              <Text style={styles.label}>Bodega <Text style={styles.required}>*</Text></Text>
              <View style={styles.fieldRow}>
                <View ref={locationSelectorRef} style={styles.selectorWrapper} onLayout={measureLocation}>
                  <TouchableOpacity style={styles.selector} onPress={() => { setShowLocations(!showLocations); setShowSuppliers(false); setShowShipping(false); measureLocation(); }}>
                    <Text style={locationName ? styles.value : styles.placeholder} numberOfLines={1}>
                      {locationName || 'Seleccionar'}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color="#6b7280" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={styles.quickAddBtn} onPress={onQuickAddLocation}>
                  <Ionicons name="add" size={18} color="#22C55E" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={styles.fieldsRow}>
            <View style={styles.field}>
              <Text style={styles.label}>Fecha Orden</Text>
              <TouchableOpacity style={styles.dateInput} onPress={() => openDatePicker('order')}>
                <Ionicons name="calendar-outline" size={14} color="#6b7280" />
                <Text style={orderDate ? styles.dateValue : styles.datePlaceholder}>
                  {orderDate || 'Seleccionar'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Fecha Entrega</Text>
              <TouchableOpacity style={styles.dateInput} onPress={() => openDatePicker('expected')}>
                <Ionicons name="calendar-outline" size={14} color="#6b7280" />
                <Text style={expectedDate ? styles.dateValue : styles.datePlaceholder}>
                  {expectedDate || 'Seleccionar'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {showDatePicker && (
            <DateTimePicker
              value={datePickerTarget === 'order'
                ? (orderDate ? new Date(orderDate + 'T12:00:00') : new Date())
                : (expectedDate ? new Date(expectedDate + 'T12:00:00') : new Date())
              }
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
            />
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Método Envío</Text>
            <TouchableOpacity style={styles.selector} onPress={() => setShowShipping(!showShipping)}>
              <Text style={shippingMethod ? styles.value : styles.placeholder}>
                {shippingMethod ? SHIPPING_METHOD_LABELS[shippingMethod] : 'Elegir método...'}
              </Text>
              <Ionicons name="chevron-down" size={14} color="#6b7280" />
            </TouchableOpacity>
            {showShipping && (
              <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
                {(Object.keys(SHIPPING_METHOD_LABELS) as ShippingMethod[]).map((key) => (
                  <TouchableOpacity key={key} style={styles.dropdownItem} onPress={() => { onShippingMethodChange(key); setShowShipping(false); }}>
                    <Text style={styles.dropdownText}>{SHIPPING_METHOD_LABELS[key]}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      )}

      {showSuppliers && supplierDims.width > 0 && (
        <View style={[styles.dropdownOverlay, { top: supplierDims.top + supplierDims.height, left: supplierDims.left, width: supplierDims.width }]}>
          <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
            {suppliers.map((s) => (
              <TouchableOpacity key={s.id} style={styles.dropdownItem} onPress={() => { onSupplierChange(s.id, s.name); setShowSuppliers(false); }}>
                <Text style={styles.dropdownText}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {showLocations && locationDims.width > 0 && (
        <View style={[styles.dropdownOverlay, { top: locationDims.top + locationDims.height, left: locationDims.left, width: locationDims.width }]}>
          <ScrollView style={styles.dropdownScroll} nestedScrollEnabled>
            {locations.map((l) => (
              <TouchableOpacity key={l.id} style={styles.dropdownItem} onPress={() => { onLocationChange(l.id, l.name); setShowLocations(false); }}>
                <Text style={styles.dropdownText}>{l.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center' },
  titleBlock: {},
  titleBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '800', color: '#111827' },
  badge: { backgroundColor: '#dcfce7', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, fontWeight: '700', color: '#22C55E' },
  subtitle: { fontSize: 11, color: '#6b7280', fontWeight: '500', marginTop: 1 },
  settingsToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#fff' },
  settingsToggleText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  pillsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingBottom: 10, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  pillSupplier: { backgroundColor: '#dcfce7' },
  pillLocation: { backgroundColor: '#d1fae5' },
  pillDate: { backgroundColor: '#fef3c7' },
  pillText: { fontSize: 11, fontWeight: '600' },
  pillTextSupplier: { color: '#22C55E' },
  pillTextLocation: { color: '#059669' },
  pillTextDate: { color: '#d97706' },
  settingsPanel: { paddingHorizontal: 16, paddingBottom: 12 },
  fieldsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  configWarning: { backgroundColor: '#fffbeb', borderWidth: 2, borderColor: '#f59e0b', padding: 6, borderRadius: 8 },
  fieldWrapper: { flex: 1 },
  field: { flex: 1 },
  fieldRow: { flexDirection: 'row', gap: 6 },
  label: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 6, paddingLeft: 2 },
  required: { color: '#ef4444' },
  selector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff', height: 38 },
  dateInput: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff', height: 38 },
  dateValue: { fontSize: 13, color: '#111827', flex: 1 },
  datePlaceholder: { fontSize: 13, color: '#9ca3af', flex: 1 },
  quickAddBtn: { width: 38, height: 38, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  selectorWrapper: { flex: 1 },
  value: { fontSize: 13, color: '#111827', flex: 1, marginRight: 4 },
  placeholder: { fontSize: 13, color: '#9ca3af', flex: 1, marginRight: 4 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 },
  dropdownOverlay: { position: 'absolute', zIndex: 10000, elevation: 30 },
  dropdownScroll: { maxHeight: 150, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, backgroundColor: '#fff', marginTop: 2, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 },
  dropdownItem: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  dropdownText: { fontSize: 13, color: '#374151' },
});
