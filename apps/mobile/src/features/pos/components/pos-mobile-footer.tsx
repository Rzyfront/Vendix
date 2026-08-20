import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import type { PosMode } from '@/features/store/types';

interface PosMobileFooterProps {
  itemCount: number;
  total: number;
  taxAmount: number;
  mode: PosMode;
  onViewCart: () => void;
  onCustomItem: () => void;
  /** "Crear" — abre `pos-order-create-modal` (fulfillment + KDS guard). */
  onCreate: () => void;
  /**
   * Handler alternativo al "Crear" cuando el footer está en modo edición de
   * una orden existente (paridad web `updateExistingOrder`). Solo se usa
   * cuando `isEditMode=true`; el padre lo conecta a `PUT /orders/:id/editor`
   * para que el botón "Crear" persista los cambios sobre la orden original
   * en lugar de abrir el modal resumen de un nuevo borrador.
   */
  onEdit?: () => void;
  onShipping: () => void;
  /** Handler del CTA primario. Varía por modo: Cobrar / Crear cotización / Crear plan separé. */
  onPrimaryCta: () => void;
  canCreateCustomItems?: boolean;
  /**
   * `true` cuando hay una orden existente cargada en el carrito (edición de
   * draft o de orden pendiente). Cambia la etiqueta del botón "Crear" a
   * "Guardar cambios" y dispara `onEdit` en lugar de `onCreate`.
   */
  isEditMode?: boolean;
  /**
   * Round 3 MAJOR #12 — `true` después de un `updateOrderEditor` exitoso:
   * el footer muestra el CTA primario como "Cobrar" (ruteando a
   * `onPrimaryCta`) en lugar de "Guardar cambios", para que el cajero
   * cobre sin abandonar la pantalla POS. Lo controla el padre.
   */
  editAfterSave?: boolean;
}

// ── Mode-aware primary CTA metadata (paridad con `pos.component.ts` web) ──

interface PrimaryCtaMeta {
  label: string;
  icon: string;
  bg: string;
  shadow: string;
  // Handler name resolved at render time. The parent passes the
  // `onSaveDraft`/`onCharge` callback through `onPrimaryCta`; we select the
  // right action label/icon based on mode AND edit mode.
  hint: string;
}

const PRIMARY_CTA_META: Record<PosMode, PrimaryCtaMeta> = {
  sale: {
    label: 'Cobrar',
    icon: 'credit-card',
    bg: colors.primary,
    shadow: colors.primary,
    hint: 'Procesa el cobro de la venta actual',
  },
  quotation: {
    label: 'Crear cotización',
    icon: 'file-text',
    bg: colors.primary,
    shadow: colors.primary,
    hint: 'Genera una cotización con los productos del carrito',
  },
  layaway: {
    label: 'Crear plan separé',
    icon: 'calendar-clock',
    bg: colorScales.amber[600],
    shadow: colorScales.amber[600],
    hint: 'Inicia la configuración de un plan separé',
  },
};

// CP-POS-CREAR-EDITAR-COBRAR-001 — cuando hay un draft cargado en el cart
// store (`draftId != null`), el CTA primario del footer es **guardar cambios**,
// NO cobrar. Cobrar solo aparece DESPUÉS de un guardado exitoso (el padre
// controla la transición). El ruteo se hace vía `onPrimaryCta` + `onEdit`:
const EDIT_MODE_PRIMARY_CTA: PrimaryCtaMeta = {
  label: 'Guardar cambios',
  icon: 'save',
  bg: colors.primary,
  shadow: colors.primary,
  hint: 'Persiste los cambios sobre la orden en edición',
};

export function PosMobileFooter({
  itemCount,
  total,
  taxAmount,
  mode,
  onViewCart,
  onCustomItem,
  onCreate,
  onEdit,
  onShipping,
  onPrimaryCta,
  canCreateCustomItems = false,
  isEditMode = false,
  // Round 3 MAJOR #12 — after the editor saves an order successfully, the
  // parent flips `editAfterSave=true` to swap the primary CTA from "Guardar
  // cambios" to "Cobrar" so the cashier can take payment without leaving the
  // POS. The handler (`onPrimaryCta`) stays the same shape — the parent
  // knows the order is already saved and routes the press to the payment
  // modal.
  editAfterSave = false,
}: PosMobileFooterProps) {
  const insets = useSafeAreaInsets();
  if (itemCount === 0) return null;

  // CP-POS-CREAR-EDITAR-COBRAR-001 — el CTA primario en modo "edit" rutea
  // al handler `onEdit` (que el padre conecta a `handleSaveDraft` →
  // `updateOrderEditor`) y se etiqueta "Guardar cambios". En modo normal,
  // sigue siendo el cobro del modo activo. Round 3 MAJOR #12 — once the
  // save lands, the CTA flips to "Cobrar" (using `onPrimaryCta`, NOT
  // `onEdit`) so the operator can collect payment without leaving the POS.
  const isEditing = isEditMode && typeof onEdit === 'function' && !editAfterSave;
  const cta = isEditing ? EDIT_MODE_PRIMARY_CTA : PRIMARY_CTA_META[mode];
  const handlePrimaryPress = isEditing ? onEdit : onPrimaryCta;
  const createLabel = isEditing ? 'Guardar cambios' : 'Crear';
  const handleCreatePress = isEditing ? onEdit : onCreate;
  const createA11yLabel = isEditing
    ? 'Guardar cambios sobre la orden existente'
    : 'Crear nueva orden borrador';

  return (
    <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
      {/* Row 1: Cart Summary + View Detail Button */}
      <View style={styles.summaryRow}>
        <View style={styles.cartSummary}>
          <View style={styles.cartIconWrapper}>
            <Icon name="shopping-cart" size={20} color="#FFFFFF" />
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>
                {itemCount > 99 ? '99+' : itemCount}
              </Text>
            </View>
          </View>
          <View style={styles.cartTotals}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
            <Text style={styles.taxAmount}>
              IVA {formatCurrency(taxAmount)}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.viewDetailBtn}
          onPress={typeof onViewCart === 'function' ? onViewCart : undefined}
          accessibilityRole="button"
          accessibilityLabel="Ver detalle del carrito"
        >
          <Text style={styles.viewDetailText}>Ver detalle</Text>
          <Icon name="chevron-up" size={16} color={colorScales.gray[500]} />
        </Pressable>
      </View>

      {/* Row 2: Secondary Action Buttons — paridad web: Ítem / Crear / Envío */}
      <View style={styles.actionsRow}>
        <Pressable
          style={[styles.actionBtn, styles.customItemBtn]}
          onPress={typeof onCustomItem === 'function' ? onCustomItem : undefined}
          disabled={!canCreateCustomItems || typeof onCustomItem !== 'function'}
          accessibilityRole="button"
          accessibilityLabel="Agregar ítem personalizado"
          accessibilityState={{ disabled: !canCreateCustomItems || typeof onCustomItem !== 'function' }}
        >
          <Icon name="file-plus" size={16} color={colors.primary} />
          <Text style={[styles.actionText, styles.customItemText]}>Ítem</Text>
        </Pressable>

        <Pressable
          style={[styles.actionBtn, styles.createBtn]}
          onPress={typeof handleCreatePress === 'function' ? handleCreatePress : undefined}
          accessibilityRole="button"
          accessibilityLabel={createA11yLabel}
        >
          <Icon name="plus-circle" size={16} color={colorScales.gray[700]} />
          <Text style={styles.actionText}>{createLabel}</Text>
        </Pressable>

        <Pressable
          style={[styles.actionBtn, styles.shippingBtn]}
          onPress={typeof onShipping === 'function' ? onShipping : undefined}
          accessibilityRole="button"
          accessibilityLabel="Crear pedido con envío a domicilio"
        >
          <Icon name="truck" size={16} color={colors.primary} />
          <Text style={[styles.actionText, styles.shippingText]}>Envío</Text>
        </Pressable>
      </View>

      {/* Row 3: Primary CTA — varía por modo. En edit mode rutea a `onEdit`
           (handleSaveDraft → updateOrderEditor) en lugar de `onPrimaryCta`
           (que en modo normal abre el payment modal). */}
      <Pressable
        style={[styles.checkoutBtn, { backgroundColor: cta.bg, shadowColor: cta.shadow }]}
        onPress={typeof handlePrimaryPress === 'function' ? handlePrimaryPress : undefined}
        accessibilityRole="button"
        accessibilityLabel={cta.label}
        accessibilityHint={cta.hint}
      >
        <Icon name={cta.icon} size={18} color="#FFFFFF" />
        <Text style={styles.checkoutText}>{cta.label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    padding: 10,
    paddingBottom: 20,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cartSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  cartIconWrapper: {
    position: 'relative',
    flexShrink: 0,
    width: 36,
    height: 36,
    backgroundColor: colors.primary,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    backgroundColor: colors.error,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.background,
  },
  cartBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
  cartTotals: {
    flexDirection: 'column',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[700],
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  taxAmount: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[600],
  },
  viewDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colorScales.gray[100],
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  viewDetailText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
  },
  customItemBtn: {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    borderColor: colorScales.green[200],
  },
  customItemText: {
    color: colorScales.green[700],
  },
  createBtn: {
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
  },
  shippingBtn: {
    backgroundColor: colors.background,
    borderColor: colorScales.green[200],
  },
  shippingText: {
    color: colorScales.green[700],
  },
  actionText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  checkoutText: {
    fontSize: 15,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
});
