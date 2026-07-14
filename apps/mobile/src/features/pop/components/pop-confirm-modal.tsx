import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PopCartItem, PopCartSummary } from '../types';

interface PopConfirmModalProps {
  visible: boolean;
  items: PopCartItem[];
  summary: PopCartSummary;
  supplierName?: string;
  locationName?: string;
  orderMode: 'draft' | 'create' | 'create-receive';
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

function formatCurrency(n: number): string {
  // Locale del dispositivo (no 'es-CO' hardcodeado) — paridad con la fix
  // L10 aplicada a pop-cart-modal.
  return '$' + n.toLocaleString();
}

export default function PopConfirmModal({
  visible,
  items,
  summary,
  supplierName,
  locationName,
  orderMode,
  onConfirm,
  onCancel,
  isLoading,
}: PopConfirmModalProps) {
  const modeLabels: Record<string, string> = {
    draft: 'Guardar Borrador',
    create: 'Crear Orden',
    'create-receive': 'Crear y Recibir',
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="checkmark-circle-outline" size={32} color="#059669" />
            </View>
            <Text style={styles.title}>Confirmar Orden</Text>
          </View>

          <View style={styles.contextSection}>
            {supplierName && (
              <View style={styles.contextRow}>
                <Ionicons name="car" size={14} color="#22C55E" />
                <Text style={styles.contextText}>Proveedor: {supplierName}</Text>
              </View>
            )}
            {locationName && (
              <View style={styles.contextRow}>
                <Ionicons name="business" size={14} color="#059669" />
                <Text style={styles.contextText}>Bodega: {locationName}</Text>
              </View>
            )}
            <View style={styles.contextRow}>
              <Ionicons name="document-text-outline" size={14} color="#d97706" />
              <Text style={styles.contextText}>Acción: {modeLabels[orderMode]}</Text>
            </View>
          </View>

          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            style={styles.list}
            renderItem={({ item }) => (
              <View style={styles.itemRow}>
                <Text style={styles.itemName} numberOfLines={1}>{item.product.name}</Text>
                <Text style={styles.itemQty}>x{item.quantity}</Text>
                <Text style={styles.itemTotal}>{formatCurrency(item.total)}</Text>
              </View>
            )}
          />

          <View style={styles.summarySection}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{formatCurrency(summary.subtotal)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Impuestos</Text>
              <Text style={styles.summaryValue}>{formatCurrency(summary.tax_amount)}</Text>
            </View>
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(summary.total)}</Text>
            </View>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} disabled={isLoading}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.confirmText}>
                {isLoading ? 'Procesando...' : modeLabels[orderMode]}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 20 },
  modal: { backgroundColor: '#fff', borderRadius: 16, maxHeight: '85%' },
  header: { alignItems: 'center', paddingVertical: 20, gap: 8, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: '#111827' },
  contextSection: { paddingHorizontal: 20, paddingVertical: 14, gap: 8, backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contextText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  list: { maxHeight: 200, paddingHorizontal: 20 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  itemName: { flex: 1, fontSize: 13, color: '#374151', fontWeight: '500' },
  itemQty: { fontSize: 13, color: '#6b7280', marginHorizontal: 12 },
  itemTotal: { fontSize: 13, fontWeight: '700', color: '#22C55E' },
  summarySection: { padding: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryLabel: { fontSize: 13, color: '#6b7280' },
  summaryValue: { fontSize: 13, fontWeight: '600', color: '#374151' },
  totalRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  totalLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#059669' },
  footer: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 14, borderRadius: 10, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
