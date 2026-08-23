import React from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  PopCartItem,
  PopCartSummary,
  PopFiscalExplanation,
  PopShippingAllocation,
} from '../types';
import FiscalExplanationPanel from './fiscal-explanation-panel';
import { SHIPPING_ALLOCATION_LEGEND } from '../constants';

interface PopConfirmModalProps {
  visible: boolean;
  items: PopCartItem[];
  summary: PopCartSummary;
  supplierName?: string;
  locationName?: string;
  orderMode: 'draft' | 'create' | 'create-receive';
  /**
   * C.5 — cómo se imputa el flete que ya está sumado en `summary.total`.
   * `undefined` cuando no hay flete.
   */
  shippingCostAllocation?: PopShippingAllocation;
  /**
   * B.5 — la explicación fiscal tal como la emite la vista previa de costeo.
   * La confirmación es el punto de no retorno: es donde el operador tiene que
   * ver qué se va a hacer con el IVA de esta compra. La pantalla NO deriva el
   * predicado; pinta lo que llega, y si no llega no pinta nada.
   */
  fiscalExplanation?: PopFiscalExplanation | null;
  /** La vista previa está en vuelo. */
  fiscalLoading?: boolean;
  /**
   * La vista previa falló. Se PINTA en vez de quedar en un catch mudo: un panel
   * fiscal ausente por un fallo de red es indistinguible de «esta compra no
   * tiene nada fiscal que explicar», y no es lo mismo.
   */
  fiscalError?: string | null;
  /** Recibe la ruta que el backend puso en `cta.route`. */
  onFiscalCtaPress?: (route: string) => void;
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
  shippingCostAllocation,
  fiscalExplanation,
  fiscalLoading,
  fiscalError,
  onFiscalCtaPress,
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
                {item.product.image_url ? (
                  <Image
                    source={{ uri: item.product.image_url }}
                    style={styles.itemImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.itemImagePlaceholder}>
                    <Ionicons name="cube-outline" size={16} color="#9ca3af" />
                  </View>
                )}
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
            {/*
              C.5 — el flete se dice y se explica acá porque ya está sumado en
              el total: si sólo apareciera dentro del total, el operador vería
              una cifra mayor que la suma de sus líneas sin saber por qué.
            */}
            {summary.shipping_cost > 0 && (
              <>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Flete</Text>
                  <Text style={styles.summaryValue}>
                    {formatCurrency(summary.shipping_cost)}
                  </Text>
                </View>
                <Text style={styles.shippingLegend}>
                  {SHIPPING_ALLOCATION_LEGEND[shippingCostAllocation ?? 'prorate']}
                </Text>
              </>
            )}
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatCurrency(summary.total)}</Text>
            </View>
          </View>

          {/* B.5 — tratamiento del IVA en el punto de no retorno. */}
          {(fiscalLoading || !!fiscalError || !!fiscalExplanation) && (
            <ScrollView style={styles.fiscalScroll} contentContainerStyle={styles.fiscalContent}>
              {fiscalLoading && (
                <Text style={styles.fiscalNotice}>
                  Calculando el tratamiento del IVA de esta compra...
                </Text>
              )}
              {!fiscalLoading && !!fiscalError && (
                <Text style={styles.fiscalNotice}>{fiscalError}</Text>
              )}
              {!fiscalLoading && (
                <FiscalExplanationPanel
                  explanation={fiscalExplanation}
                  onCtaPress={onFiscalCtaPress}
                />
              )}
            </ScrollView>
          )}

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
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', gap: 8 },
  itemImage: { width: 32, height: 32, borderRadius: 6, backgroundColor: '#f3f4f6' },
  itemImagePlaceholder: { width: 32, height: 32, borderRadius: 6, backgroundColor: '#f3f4f6', alignItems: 'center', justifyContent: 'center' },
  itemName: { flex: 1, fontSize: 13, color: '#374151', fontWeight: '500' },
  itemQty: { fontSize: 13, color: '#6b7280', marginHorizontal: 12 },
  itemTotal: { fontSize: 13, fontWeight: '700', color: '#22C55E' },
  summarySection: { padding: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  summaryLabel: { fontSize: 13, color: '#6b7280' },
  summaryValue: { fontSize: 13, fontWeight: '600', color: '#374151' },
  shippingLegend: { fontSize: 11, lineHeight: 16, color: '#6b7280', marginBottom: 6 },
  fiscalScroll: { maxHeight: 220, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  fiscalContent: { paddingHorizontal: 20, paddingVertical: 14, gap: 10 },
  fiscalNotice: { fontSize: 12, lineHeight: 18, color: '#6b7280' },
  totalRow: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  totalLabel: { fontSize: 15, fontWeight: '700', color: '#111827' },
  totalValue: { fontSize: 22, fontWeight: '800', color: '#059669' },
  footer: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#d1d5db', alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: '#374151' },
  confirmBtn: { flex: 1, flexDirection: 'row', paddingVertical: 14, borderRadius: 10, backgroundColor: '#059669', alignItems: 'center', justifyContent: 'center', gap: 6 },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
