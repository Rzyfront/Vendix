import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PopCartItem, PopCartSummary } from '../types';

interface PopCartPanelProps {
  items: PopCartItem[];
  summary: PopCartSummary;
  supplierName?: string;
  locationName?: string;
  onUpdateItem: (itemId: string, quantity: number, unitCost: number) => void;
  onRemoveItem: (itemId: string) => void;
  onCreateOrder: () => void;
  onCreateAndReceive: () => void;
  onSaveDraft: () => void;
  onClearCart: () => void;
  isLoading?: boolean;
  isEmpty?: boolean;
}

function formatCurrency(n: number): string {
  return '$' + n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function PopCartPanel({
  items,
  summary,
  supplierName,
  locationName,
  onUpdateItem,
  onRemoveItem,
  onCreateOrder,
  onCreateAndReceive,
  onSaveDraft,
  onClearCart,
  isLoading,
  isEmpty,
}: PopCartPanelProps) {
  const renderItem = ({ item }: { item: PopCartItem }) => (
    <View style={styles.itemCard}>
      {/* Top Row: Info + Remove */}
      <View style={styles.itemHeader}>
        <View style={styles.itemInfo}>
          <View style={styles.itemNameRow}>
            <Text style={styles.itemName} numberOfLines={1}>{item.product.name}</Text>
            <TouchableOpacity onPress={() => onRemoveItem(item.id)} style={styles.removeBtn}>
              <Ionicons name="trash-outline" size={14} color="#9ca3af" />
            </TouchableOpacity>
          </View>
          {item.variant && <Text style={styles.itemVariant}>Variante: {item.variant.name || item.variant.sku}</Text>}
          {item.variant?.sku && <Text style={styles.itemSku}>SKU: {item.variant.sku}</Text>}
          {!item.variant && !item.is_prebulk && <Text style={styles.itemSku}>SKU: {item.product.sku || item.product.code}</Text>}
        </View>
      </View>

      {/* Cost + Total */}
      <View style={styles.costRow}>
        <View style={styles.costField}>
          <Text style={styles.costLabel}>Costo Unit.</Text>
          <View style={styles.costInputWrap}>
            <Text style={styles.costCurrency}>$</Text>
            <TextInput
              style={styles.costInput}
              value={String(item.unit_cost)}
              onChangeText={(v) => onUpdateItem(item.id, item.quantity, Number(v) || 0)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <View style={styles.totalField}>
          <Text style={styles.costLabel}>Total</Text>
          <Text style={styles.itemTotal}>{formatCurrency(item.total)}</Text>
        </View>
      </View>

      {/* Quantity Controls */}
      <View style={styles.qtyRow}>
        <Text style={styles.qtyLabel}>Cantidad</Text>
        <View style={styles.qtyControls}>
          <TouchableOpacity style={styles.qtyBtn} onPress={() => onUpdateItem(item.id, Math.max(1, item.quantity - 1), item.unit_cost)}>
            <Ionicons name="remove" size={14} color="#374151" />
          </TouchableOpacity>
          <TextInput
            style={styles.qtyInput}
            value={String(item.quantity)}
            onChangeText={(v) => onUpdateItem(item.id, Math.max(1, Number(v) || 1), item.unit_cost)}
            keyboardType="numeric"
          />
          <TouchableOpacity style={styles.qtyBtn} onPress={() => onUpdateItem(item.id, item.quantity + 1, item.unit_cost)}>
            <Ionicons name="add" size={14} color="#374151" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Config Trigger */}
      <View style={styles.configTrigger}>
        <Ionicons name="settings-outline" size={11} color="#22C55E" />
        <Text style={styles.configTriggerText}>
          {item.variant ? `${item.variant.name} · ` : ''}
          {item.lot_info?.batch_number ? `Lote: ${item.lot_info.batch_number} · ` : ''}
          {item.product.pricing_type === 'weight' ? 'Peso' : 'Unidad'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTitle}>
          <Ionicons name="cart" size={18} color="#22C55E" />
          <Text style={styles.headerText}>Orden de Compra ({items.length})</Text>
        </View>
        {items.length > 0 && (
          <TouchableOpacity onPress={onClearCart}>
            <Text style={styles.clearBtn}>Vaciar</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Summary */}
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
          <Text style={styles.totalLabel}>Total Estimado</Text>
          <Text style={styles.totalValue}>{formatCurrency(summary.total)}</Text>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionGroup}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionDraft]}
            onPress={onSaveDraft}
            disabled={isLoading || isEmpty}
          >
            <Ionicons name="save-outline" size={16} color="#374151" />
            <Text style={styles.actionTextDraft}>Borrador</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionCreate]}
            onPress={onCreateOrder}
            disabled={isLoading || isEmpty}
          >
            <Ionicons name="document-text-outline" size={16} color="#fff" />
            <Text style={styles.actionTextPrimary}>Crear orden</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtnFull, styles.actionReceive]}
            onPress={onCreateAndReceive}
            disabled={isLoading || isEmpty}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.actionTextPrimary}>Crear + Recibir</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Supplier info */}
      {supplierName && (
        <View style={styles.supplierBanner}>
          <View style={styles.supplierIcon}>
            <Ionicons name="car" size={14} color="#22C55E" />
          </View>
          <View>
            <Text style={styles.supplierLabel}>Proveedor Seleccionado</Text>
            <Text style={styles.supplierName}>{supplierName}</Text>
          </View>
        </View>
      )}

      {/* Items */}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="cart-outline" size={24} color="#d1d5db" />
            </View>
            <Text style={styles.emptyTitle}>Orden vacía</Text>
            <Text style={styles.emptyHint}>Selecciona productos en el panel izquierdo</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerText: { fontSize: 14, fontWeight: '700', color: '#111827' },
  clearBtn: { fontSize: 13, fontWeight: '600', color: '#ef4444' },
  summarySection: { paddingHorizontal: 16, paddingVertical: 14, backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryLabel: { fontSize: 12, color: '#6b7280' },
  summaryValue: { fontSize: 12, fontWeight: '600', color: '#374151' },
  totalRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  totalLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#22C55E', letterSpacing: -0.5 },
  actionGroup: { gap: 8, marginTop: 12 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, borderRadius: 8 },
  actionBtnFull: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 10 },
  actionDraft: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  actionCreate: { backgroundColor: '#22C55E' },
  actionReceive: { backgroundColor: '#22c55e', elevation: 4, shadowColor: '#22c55e', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
  actionTextDraft: { fontSize: 13, fontWeight: '700', color: '#374151' },
  actionTextPrimary: { fontSize: 13, fontWeight: '700', color: '#fff' },
  supplierBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#dcfce7', borderBottomWidth: 1, borderBottomColor: '#bbf7d0' },
  supplierIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#bbf7d0', alignItems: 'center', justifyContent: 'center' },
  supplierLabel: { fontSize: 10, color: '#6b7280', fontWeight: '500' },
  supplierName: { fontSize: 12, fontWeight: '700', color: '#111827' },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 8 },
  itemCard: { backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', padding: 10 },
  itemHeader: { marginBottom: 8 },
  itemInfo: {},
  itemNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemName: { fontSize: 13, fontWeight: '700', color: '#111827', flex: 1, marginRight: 8 },
  removeBtn: { padding: 4 },
  itemVariant: { fontSize: 10, color: '#22C55E', fontWeight: '600', marginTop: 2 },
  itemSku: { fontSize: 10, color: '#6b7280', marginTop: 1 },
  costRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  costField: { flex: 1 },
  costLabel: { fontSize: 9, color: '#6b7280', fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 },
  costInputWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 6, height: 28, backgroundColor: '#fff' },
  costCurrency: { fontSize: 12, color: '#6b7280', marginRight: 2 },
  costInput: { flex: 1, fontSize: 12, fontWeight: '600', paddingVertical: 0, textAlign: 'right' },
  totalField: { alignItems: 'flex-end' },
  itemTotal: { fontSize: 14, fontWeight: '800', color: '#22C55E' },
  qtyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  qtyLabel: { fontSize: 9, color: '#6b7280', fontWeight: '700', textTransform: 'uppercase' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  qtyBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  qtyInput: { width: 40, height: 28, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, textAlign: 'center', fontSize: 13, fontWeight: '600', paddingVertical: 0 },
  configTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db', borderStyle: 'dashed' },
  configTriggerText: { fontSize: 9, color: '#6b7280' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: '#111827', marginBottom: 4 },
  emptyHint: { fontSize: 11, color: '#9ca3af' },
});
