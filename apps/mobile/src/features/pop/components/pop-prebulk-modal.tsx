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
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors } from '@/shared/theme';
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <Icon name="info" size={22} color={colors.primary} />
              <View style={styles.headerText}>
                <Text style={styles.title}>Agregar Producto Nuevo</Text>
                <Text style={styles.subtitle}>Se creará en tu catálogo al confirmar la orden</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onCancel} style={styles.closeBtn}>
              <Icon name="x" size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
            {/* Info banner */}
            <View style={styles.infoBanner}>
              <Icon name="info" size={18} color="#2563eb" />
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
                <Icon name="calculator" size={16} color="#6b7280" />
                <Text style={styles.totalPreviewLabel}>Total estimado</Text>
              </View>
              <Text style={styles.totalPreviewValue}>${totalPreview.toLocaleString()}</Text>
            </View>

            {/* Section: Cantidad y notas */}
            <Text style={styles.sectionTitle}>CANTIDAD Y NOTAS</Text>

            <Text style={styles.label}>Cantidad</Text>
            <View style={styles.qtyRow}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity(String(Math.max(1, Number(quantity) - 1)))}>
                <Icon name="minus" size={20} color="#374151" />
              </TouchableOpacity>
              <TextInput
                style={styles.qtyInput}
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.qtyBtn} onPress={() => setQuantity(String(Number(quantity) + 1))}>
                <Icon name="plus" size={20} color="#374151" />
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
              <Icon name="shopping-cart" size={16} color="#fff" />
              <Text style={styles.confirmText}>Agregar al carrito</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  // Contenedor del modal — mismo estilo de card que customers.tsx
  modal: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  headerTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1, marginRight: 12 },
  headerText: { flex: 1 },
  closeBtn: { padding: 4 },
  title: { fontSize: 16, fontWeight: '700', color: colorScales.gray[900] },
  subtitle: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  body: { paddingHorizontal: 16, maxHeight: 420 },
  bodyContent: { paddingTop: 16, paddingBottom: 24 },
  infoBanner: { flexDirection: 'row', gap: 10, backgroundColor: colorScales.blue[50], borderRadius: 10, borderWidth: 1, borderColor: colorScales.blue[200], padding: 12, marginBottom: 16, alignItems: 'flex-start' },
  infoBannerText: { flex: 1 },
  infoBannerTitle: { fontSize: 12, fontWeight: '700', color: colorScales.blue[800] },
  infoBannerDesc: { fontSize: 11, color: colorScales.blue[900], marginTop: 2, lineHeight: 15 },
  sectionTitle: { fontSize: 10, fontWeight: '700', color: colorScales.gray[500], letterSpacing: 0.5, marginBottom: 10, marginTop: 6 },
  label: { fontSize: 12, fontWeight: '600', color: colorScales.gray[700], marginBottom: 6 },
  required: { color: colors.error },
  input: { borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background },
  textArea: { minHeight: 60, textAlignVertical: 'top' },
  row2: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 4 },
  row2Field: { flex: 1 },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 10, backgroundColor: colors.background },
  pricePrefix: { fontSize: 15, fontWeight: '600', color: colorScales.gray[500], marginRight: 4 },
  priceInput: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: 9, color: colorScales.gray[900] },
  totalPreview: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colorScales.gray[50], borderRadius: 8, borderWidth: 1, borderColor: colorScales.gray[200], paddingHorizontal: 14, paddingVertical: 12, marginVertical: 12 },
  totalPreviewLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  totalPreviewLabel: { fontSize: 12, color: colorScales.gray[500] },
  totalPreviewValue: { fontSize: 18, fontWeight: '800', color: colorScales.green[700] },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  qtyInput: { flex: 1, borderWidth: 1, borderColor: colorScales.gray[300], borderRadius: 8, paddingHorizontal: 16, paddingVertical: 9, fontSize: 16, fontWeight: '700', textAlign: 'center', color: colorScales.gray[900] },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[300], alignItems: 'center', backgroundColor: colors.background },
  cancelText: { fontSize: 14, fontWeight: '700', color: colorScales.gray[700] },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 12, borderRadius: borderRadius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', gap: 6, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 6, elevation: 4 },
  // Disabled: verde opaco (no gris) — como la web cuando faltan datos obligatorios
  confirmBtnDisabled: { backgroundColor: 'rgba(34,197,94,0.4)', shadowOpacity: 0, opacity: 0.6 },
  confirmText: { fontSize: 14, fontWeight: '700', color: colors.background },
});
