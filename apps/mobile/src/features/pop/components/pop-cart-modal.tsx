import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { PopCartItem, PopCartSummary } from '../types';

interface PopCartModalProps {
  visible: boolean;
  items: PopCartItem[];
  summary: PopCartSummary;
  supplierName?: string;
  locationName?: string;
  onClose: () => void;
  onUpdateItem: (itemId: string, quantity: number, unitCost: number) => void;
  onRemoveItem: (itemId: string) => void;
  onSaveDraft: () => void;
  onCreateOrder: () => void;
  onCreateAndReceive: () => void;
  onClearCart: () => void;
  onConfigure: () => void;
  isProcessing?: boolean;
}

function formatCurrency(value: number): string {
  return '$' + value.toLocaleString('es-CO');
}

export default function PopCartModal({
  visible,
  items,
  summary,
  supplierName,
  locationName,
  onClose,
  onUpdateItem,
  onRemoveItem,
  onSaveDraft,
  onCreateOrder,
  onCreateAndReceive,
  onClearCart,
  onConfigure,
  isProcessing,
}: PopCartModalProps) {
  const insets = useSafeAreaInsets();
  const hasConfig = !!supplierName && !!locationName;

  const renderItem = ({ item }: { item: PopCartItem }) => (
    <View style={styles.cartItem}>
      <View style={styles.itemImage}>
        <View style={styles.imagePlaceholder}>
          <Ionicons name="image-outline" size={18} color="#9ca3af" />
        </View>
      </View>

      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={2}>{item.product.name}</Text>
        <View style={styles.itemMeta}>
          {item.product.code ? (
            <Text style={styles.itemSku}>{item.product.code}</Text>
          ) : null}
          <View style={styles.costInput}>
            <Text style={styles.costCurrency}>$</Text>
            <TextInput
              style={styles.costInputField}
              value={String(Math.round(item.unit_cost))}
              onChangeText={(v) => onUpdateItem(item.id, item.quantity, Number(v) || 0)}
              keyboardType="numeric"
              placeholder="Costo"
            />
          </View>
        </View>
      </View>

      <View style={styles.removeWrapper}>
        <TouchableOpacity style={styles.removeBtn} onPress={() => onRemoveItem(item.id)}>
          <Ionicons name="close" size={16} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <View style={styles.itemActions}>
        <View style={styles.qtyControl}>
          <TouchableOpacity
            style={styles.qtyBtn}
            onPress={() => onUpdateItem(item.id, Math.max(1, item.quantity - 1), item.unit_cost)}
          >
            <Ionicons name="remove" size={14} color="#374151" />
          </TouchableOpacity>
          <Text style={styles.qtyValue}>{item.quantity}</Text>
          <TouchableOpacity
            style={styles.qtyBtn}
            onPress={() => onUpdateItem(item.id, item.quantity + 1, item.unit_cost)}
          >
            <Ionicons name="add" size={14} color="#374151" />
          </TouchableOpacity>
        </View>
        <Text style={styles.itemTotal}>{formatCurrency(item.total)}</Text>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={[styles.overlay, visible && styles.overlayOpen]}>
        <View style={[styles.modal, visible && styles.modalOpen]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={onClose}>
              <Ionicons name="chevron-back" size={24} color="#111827" />
            </TouchableOpacity>
            <Text style={styles.title}>
              Orden de Compra{' '}
              <Text style={styles.titleCount}>({items.length})</Text>
            </Text>
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={onClearCart}
              disabled={items.length === 0}
            >
              <Text style={[styles.clearBtnText, items.length === 0 && styles.clearBtnDisabled]}>
                Vaciar
              </Text>
            </TouchableOpacity>
          </View>

          {!hasConfig ? (
            <View style={styles.contextWarning}>
              <View style={styles.alertContent}>
                <Ionicons name="alert-circle" size={18} color="#f59e0b" />
                <Text style={styles.alertText}>Configura proveedor y bodega para continuar</Text>
              </View>
              <TouchableOpacity style={styles.configBtn} onPress={onConfigure}>
                <Ionicons name="settings-outline" size={14} color="#fff" />
                <Text style={styles.configBtnText}>Configurar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.contextSection}>
              <View style={styles.contextItems}>
                <View style={styles.contextItem}>
                  <Ionicons name="car-outline" size={16} color="#6b7280" />
                  <Text style={styles.contextLabel}>{supplierName}</Text>
                </View>
                <View style={styles.contextItem}>
                  <Ionicons name="business-outline" size={16} color="#6b7280" />
                  <Text style={styles.contextLabel}>{locationName}</Text>
                </View>
              </View>
            </View>
          )}

          <View style={styles.itemsArea}>
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.itemsContent}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <View style={styles.emptyIcon}>
                    <Ionicons name="bag-outline" size={40} color="#9ca3af" />
                  </View>
                  <Text style={styles.emptyTitle}>Tu orden está vacía</Text>
                  <Text style={styles.emptyHint}>Selecciona productos para comenzar</Text>
                </View>
              }
            />
          </View>

          {items.length > 0 && (
            <>
              <View style={styles.summary}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal</Text>
                  <Text style={styles.summaryValue}>{formatCurrency(summary.subtotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Impuestos</Text>
                  <Text style={styles.summaryValue}>{formatCurrency(summary.tax_amount)}</Text>
                </View>
                <View style={[styles.summaryRow, styles.summaryTotal]}>
                  <Text style={styles.summaryTotalLabel}>Total Estimado</Text>
                  <Text style={styles.summaryTotalValue}>{formatCurrency(summary.total)}</Text>
                </View>
              </View>

              <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 8) + 20 }]}>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.draftBtn} onPress={onSaveDraft} disabled={isProcessing}>
                    <Ionicons name="save-outline" size={18} color="#374151" />
                    <Text style={styles.draftBtnText}>Guardar Borrador</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.createBtn} onPress={onCreateOrder} disabled={isProcessing}>
                    <Ionicons name="document-text-outline" size={18} color="#fff" />
                    <Text style={styles.createBtnText}>Crear orden</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={styles.receiveBtn}
                  onPress={onCreateAndReceive}
                  disabled={isProcessing}
                >
                  <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
                  <Text style={styles.receiveBtnText}>
                    {isProcessing ? 'Procesando...' : 'Crear y recibir'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0)',
    justifyContent: 'flex-end',
  },
  overlayOpen: {
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    flex: 1,
  },
  modalOpen: {},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  titleCount: {
    fontWeight: '500',
    color: '#6b7280',
  },
  clearBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  clearBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ef4444',
  },
  clearBtnDisabled: {
    color: '#d1d5db',
  },

  contextSection: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  contextItems: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  contextItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contextLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  contextWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245,158,11,0.3)',
    gap: 8,
  },
  alertContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    flexWrap: 'wrap',
  },
  alertText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#92400e',
    flex: 1,
  },
  configBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f59e0b',
    borderRadius: 6,
  },
  configBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },

  itemsArea: {
    flex: 1,
    overflow: 'hidden',
  },
  itemsContent: {
    padding: 16,
    gap: 12,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 14,
    color: '#6b7280',
  },

  cartItem: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    marginBottom: 8,
  },
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#f3f4f6',
    marginRight: 10,
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 18,
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  itemSku: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#9ca3af',
  },
  costInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  costCurrency: {
    fontSize: 11,
    color: '#6b7280',
    marginRight: 2,
  },
  costInputField: {
    width: 60,
    padding: 0,
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
  },
  removeWrapper: {
    alignItems: 'flex-end',
  },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  itemActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    minWidth: 20,
    textAlign: 'center',
  },
  itemTotal: {
    fontSize: 15,
    fontWeight: '700',
    color: '#22C55E',
  },

  summary: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#f9fafb',
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  summaryTotal: {
    paddingTop: 12,
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  summaryTotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  summaryTotalValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#22C55E',
  },

  actions: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    gap: 10,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  draftBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
  },
  draftBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  createBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    backgroundColor: '#22C55E',
    borderRadius: 12,
  },
  createBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  receiveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    backgroundColor: '#059669',
    borderRadius: 12,
  },
  receiveBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
