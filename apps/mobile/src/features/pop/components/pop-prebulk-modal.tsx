import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PreBulkData } from '../types';

interface PopPrebulkModalProps {
  visible: boolean;
  onConfirm: (data: PreBulkData) => void;
  onCancel: () => void;
}

export default function PopPrebulkModal({ visible, onConfirm, onCancel }: PopPrebulkModalProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (visible) {
      setName('');
      setCode('');
      setDescription('');
      setUnitCost('');
      setBasePrice('');
      setQuantity('1');
      setNotes('');
    }
  }, [visible]);

  const totalPreview = useMemo(() => {
    return (Number(unitCost) || 0) * (Number(quantity) || 1);
  }, [unitCost, quantity]);

  const handleConfirm = () => {
    if (!name.trim() || !code.trim()) return;
    onConfirm({
      name: name.trim(),
      code: code.trim(),
      description: description.trim() || undefined,
      base_price: Number(basePrice) || undefined,
      unit_cost: Number(unitCost) || undefined,
      quantity: Math.max(1, Number(quantity) || 1),
      notes: notes.trim() || undefined,
    });
  };

  const isValid = name.trim().length > 0 && code.trim().length > 0;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>Agregar Producto Nuevo</Text>
              <Text style={styles.subtitle}>Se creará en tu catálogo al confirmar la orden</Text>
            </View>
            <TouchableOpacity onPress={onCancel} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Info banner */}
            <View style={styles.infoBanner}>
              <Ionicons name="information-circle" size={18} color="#2563eb" />
              <View style={styles.infoBannerText}>
                <Text style={styles.infoBannerTitle}>Producto nuevo</Text>
                <Text style={styles.infoBannerDesc}>
                  Se creará automáticamente en tu catálogo al confirmar la orden. Podrás editarlo luego desde Productos.
                </Text>
              </View>
            </View>

            {/* Section: Información básica */}
            <Text style={styles.sectionTitle}>INFORMACIÓN BÁSICA</Text>

            <Text style={styles.label}>Nombre del Producto <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Ej: Material genérico"
              placeholderTextColor="#9ca3af"
            />

            <View style={styles.row2}>
              <View style={styles.row2Field}>
                <Text style={styles.label}>SKU / Código <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="Ej: MAN-001"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              <View style={styles.row2Field}>
                <Text style={styles.label}>Descripción corta</Text>
                <TextInput
                  style={styles.input}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Opcional"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            </View>

            {/* Section: Precio y costo */}
            <Text style={styles.sectionTitle}>PRECIO Y COSTO</Text>

            <View style={styles.row2}>
              <View style={styles.row2Field}>
                <Text style={styles.label}>Costo Unitario</Text>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.pricePrefix}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={unitCost}
                    onChangeText={setUnitCost}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>
              <View style={styles.row2Field}>
                <Text style={styles.label}>Precio de Venta</Text>
                <View style={styles.priceInputWrap}>
                  <Text style={styles.pricePrefix}>$</Text>
                  <TextInput
                    style={styles.priceInput}
                    value={basePrice}
                    onChangeText={setBasePrice}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#9ca3af"
                  />
                </View>
              </View>
            </View>

            {/* Total preview */}
            <View style={styles.totalPreview}>
              <View style={styles.totalPreviewLeft}>
                <Ionicons name="calculator-outline" size={16} color="#6b7280" />
                <Text style={styles.totalPreviewLabel}>Total estimado</Text>
              </View>
              <Text style={styles.totalPreviewValue}>${totalPreview.toLocaleString()}</Text>
            </View>

            {/* Section: Cantidad y notas */}
            <Text style={styles.sectionTitle}>CANTIDAD Y NOTAS</Text>

            <Text style={styles.label}>Cantidad</Text>
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

            <Text style={[styles.label, { marginTop: 14 }]}>Notas</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Notas adicionales sobre este producto..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={2}
            />
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, !isValid && styles.confirmBtnDisabled]}
              onPress={handleConfirm}
              disabled={!isValid}
            >
              <Ionicons name="cart" size={16} color="#fff" />
              <Text style={styles.confirmText}>Agregar al carrito</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerText: { flex: 1, marginRight: 12 },
  closeBtn: { padding: 4 },
  title: { fontSize: 16, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  body: { paddingHorizontal: 16, maxHeight: 420 },
  bodyContent: { paddingTop: 16, paddingBottom: 24 },
  infoBanner: { flexDirection: 'row', gap: 10, backgroundColor: '#eff6ff', borderRadius: 10, borderWidth: 1, borderColor: '#bfdbfe', padding: 12, marginBottom: 16, alignItems: 'flex-start' },
  infoBannerText: { flex: 1 },
  infoBannerTitle: { fontSize: 12, fontWeight: '700', color: '#1e40af' },
  infoBannerDesc: { fontSize: 11, color: '#1e3a8a', marginTop: 2, lineHeight: 15 },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: '#6b7280', letterSpacing: 0.5, marginBottom: 10, marginTop: 6 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6 },
  required: { color: '#ef4444' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#111827', backgroundColor: '#fff' },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  row2Field: { flex: 1 },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, backgroundColor: '#fff' },
  pricePrefix: { fontSize: 15, fontWeight: '600', color: '#6b7280', marginRight: 4 },
  priceInput: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 9, color: '#111827' },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', paddingHorizontal: 14, paddingVertical: 12, marginVertical: 12 },
  totalPreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalPreviewLabel: { fontSize: 12, color: '#6b7280' },
  totalPreviewValue: { fontSize: 18, fontWeight: '800', color: '#059669' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9, fontSize: 16, fontWeight: '700', textAlign: 'center', color: '#111827' },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center', backgroundColor: '#fff' },
  cancelText: { fontSize: 14, fontWeight: '700', color: '#374151' },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: 12, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center', gap: 6, shadowColor: '#22C55E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  confirmBtnDisabled: { backgroundColor: '#9ca3af', shadowOpacity: 0 },
  confirmText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
