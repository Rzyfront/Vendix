import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  StyleSheet,
  Image,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import type { CartItem as StoreCartItem } from '@/features/store/types';
import { CheckoutStepIndicator } from './checkout-step-indicator';

type CartItem = StoreCartItem;

interface PosCartModalProps {
  visible: boolean;
  onClose: () => void;
  items: CartItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  onIncreaseQuantity: (id: string) => void;
  onDecreaseQuantity: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onClearCart: () => void;
  /** Abre el modal de ítem personalizado. */
  onCustomItem: () => void;
  /** Handler de "Crear" — abre `pos-order-create-modal`. */
  onCreate: () => void;
  /** Handler de "Envío" — abre shipping modal. */
  onShipping: () => void;
  /** Handler de "Guardar borrador" — paridad con web `pos-cart-modal.component.ts:738`. */
  onSaveDraft?: () => void;
  /** Estado del draft: `true` cuando ya hay un draft persistido. */
  hasDraft?: boolean;
  /** Handler de "Finalizar Venta" — abre `pos-payment-modal`. */
  onCheckout: () => void;
  /** Habilita el botón de ítem personalizado (paridad web `canCreateCustomItems`). */
  canCreateCustomItems?: boolean;
}

const SCREEN_HEIGHT = Dimensions.get('window').height;
const SHEET_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.9);

/**
 * Carrito POS — paridad exacta con `pos-cart-modal.component.ts` web.
 *
 * Cambios aplicados (Fase 2 — cart parity):
 *
 * **Estructura del modal**:
 * - Web: bottom sheet con `border-radius: 20px 20px 0 0`, `max-height: 90vh`, slide-up.
 *   Mobile: `Modal animationType="slide"` + absolute bottom positioning + slide anim.
 *
 * **Cart item card** (web `grid-template-columns: 56px 1fr auto`):
 * - Convertido de `flexDirection: 'row' + borderBottom` a card con
 *   `background: surface` + `border: 1px` + `border-radius: 14` + `padding: 12`.
 * - Layout: image (56×56) + info (flex) + remove (28×28).
 * - Hover del web → `borderColor: primary` se aproxima con `cardPressed` style.
 *
 * **Meta badges por item** (web `.item-meta` flex row con badges):
 * - SKU (mono font) — usa `item.variant?.sku \|\| item.product.sku`.
 * - Unit price (`$X c/u`).
 * - Tax badge (`IVA $X`) — solo si `item.taxAmount > 0`.
 * - Descripción: muestra "Ítem personalizado" si `itemType === 'custom'`.
 *
 * **Summary section**:
 * - Botón "Ítem personalizado" full-width arriba (web `.summary-custom-item-btn`).
 * - Subtotal / IVA / Total con `total-amount = fontSize.xl` (22px como web).
 *
 * **Actions section** (web `.modal-actions`):
 * - Row 1: `Crear` + `Envío` (grid 1fr 1fr, h=42, fs=13).
 * - Row 2: `Finalizar Venta` full-width (h=48, fs=15, primary background).
 *
 * **Empty state**:
 * - Botón "Agregar ítem personalizado" cuando `canCreateCustomItems` (web `.empty-custom-item-btn`).
 *
 * @see `apps/frontend/src/app/private/modules/store/pos/components/pos-cart-modal.component.ts`
 */
export function PosCartModal({
  visible,
  onClose,
  items,
  subtotal,
  taxAmount,
  total,
  onIncreaseQuantity,
  onDecreaseQuantity,
  onRemoveItem,
  onClearCart,
  onCustomItem,
  onCreate,
  onShipping,
  onSaveDraft,
  hasDraft,
  onCheckout,
  canCreateCustomItems = false,
}: PosCartModalProps) {
  // Slide-up animation — RN Modal animationType="slide" slides the whole Modal.
  // We use translateY for the sheet itself so the backdrop fade-in is separate.
  const sheetTranslate = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(sheetTranslate, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      sheetTranslate.setValue(SHEET_MAX_HEIGHT);
    }
  }, [visible, sheetTranslate]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Sibling layout: backdrop is absolute and tappable, sheet is a sibling
          that catches its own gestures. Nesting Pressables + stopPropagation
          does NOT work in React Native — outer Pressable still receives the
          responder first, dismissing the modal on inner taps. */}
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: sheetTranslate }] },
          ]}
        >
          <View style={styles.sheetInner}>
            {/* ── Header ── */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <Text style={styles.title} numberOfLines={1}>
                  Carrito
                  <Text style={styles.itemCount}> ({items.length})</Text>
                </Text>
              </View>
              <View style={styles.headerRight}>
                <Pressable
                  onPress={onClearCart}
                  disabled={items.length === 0}
                  style={({ pressed }) => [
                    styles.clearBtn,
                    items.length === 0 && styles.clearBtnDisabled,
                    pressed && styles.clearBtnPressed,
                  ]}
                >
                  <Text style={[styles.clearBtnText, items.length === 0 && styles.clearBtnTextDisabled]}>
                    Vaciar
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
                  accessibilityLabel="Cerrar carrito"
                >
                  <Icon name="x" size={20} color={colorScales.gray[700]} />
                </Pressable>
              </View>
            </View>

            {/* ── Step indicator — paridad UX para que el usuario sepa dónde está ── */}
            <CheckoutStepIndicator currentStep="cart" />
            <View style={styles.stepDivider} />

            {/* ── Items ── */}
            {items.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Icon name="shopping-cart" size={40} color={colorScales.gray[300]} />
                </View>
                <Text style={styles.emptyText}>Tu carrito está vacío</Text>
                <Text style={styles.emptyHint}>Selecciona productos para comenzar</Text>
                {canCreateCustomItems ? (
                  <Pressable
                    onPress={onCustomItem}
                    style={({ pressed }) => [styles.emptyCustomBtn, pressed && { opacity: 0.85 }]}
                  >
                    <Icon name="file-plus" size={16} color={colors.primary} />
                    <Text style={styles.emptyCustomBtnText}>Agregar ítem personalizado</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <FlatList
                data={items}
                keyExtractor={(item) => item.id}
                style={styles.itemsList}
                contentContainerStyle={styles.itemsListContent}
                renderItem={({ item }) => {
                  const sku = item.variant?.sku || item.product.sku;
                  const isCustom = item.itemType === 'custom';
                  return (
                    <View style={styles.cartItem}>
                      {/* Row 1: Image + Info + Remove */}
                      <View style={styles.cartItemTop}>
                        {/* Image */}
                        <View style={styles.itemImage}>
                          {item.product.image_url && item.product.image_url !== 'custom' ? (
                            <Image source={{ uri: item.product.image_url }} style={styles.itemImageImg} />
                          ) : (
                            <View style={styles.imagePlaceholder}>
                              <Icon
                                name={isCustom ? 'file-plus' : 'image'}
                                size={18}
                                color={colorScales.gray[400]}
                              />
                            </View>
                          )}
                        </View>

                        {/* Info */}
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemName} numberOfLines={2}>
                            {item.product.name}
                          </Text>
                          {item.variant_display_name ? (
                            <Text style={styles.variantName} numberOfLines={1}>
                              {item.variant_display_name}
                            </Text>
                          ) : null}
                          {isCustom ? (
                            <Text style={styles.itemDescription} numberOfLines={2}>
                              Ítem personalizado
                            </Text>
                          ) : null}

                          {/* Meta badges (paridad web `.item-meta`) */}
                          <View style={styles.itemMeta}>
                            {sku ? <Text style={styles.itemSku}>{sku}</Text> : null}
                            <Text style={styles.itemUnitPrice}>
                              {formatCurrency(item.finalPrice)} c/u
                            </Text>
                            {item.taxAmount > 0 ? (
                              <View style={styles.itemTaxBadge}>
                                <Text style={styles.itemTaxBadgeText}>
                                  IVA {formatCurrency(item.taxAmount)}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>

                        {/* Remove */}
                        <Pressable
                          onPress={() => onRemoveItem(item.id)}
                          hitSlop={6}
                          style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
                        >
                          <Icon name="x" size={16} color={colorScales.gray[400]} />
                        </Pressable>
                      </View>

                      {/* Row 2: Qty + Total */}
                      <View style={styles.cartItemBottom}>
                        <View style={styles.qtyControls}>
                          <Pressable
                            onPress={() => onDecreaseQuantity(item.id)}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.qtyBtn,
                              styles.qtyBtnMinus,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <Icon name="minus" size={14} color={colorScales.gray[600]} />
                          </Pressable>
                          <Text style={styles.qtyLabel}>{item.quantity}</Text>
                          <Pressable
                            onPress={() => onIncreaseQuantity(item.id)}
                            hitSlop={6}
                            style={({ pressed }) => [
                              styles.qtyBtn,
                              styles.qtyBtnPlus,
                              pressed && { opacity: 0.6 },
                            ]}
                          >
                            <Icon name="plus" size={14} color={colors.primary} />
                          </Pressable>
                        </View>
                        <Text style={styles.itemTotal}>{formatCurrency(item.totalPrice)}</Text>
                      </View>
                    </View>
                  );
                }}
              />
            )}

            {/* ── Summary + Actions (sticky bottom) ── */}
            {items.length > 0 ? (
              <>
                <View style={styles.summarySection}>
                  {canCreateCustomItems ? (
                    <Pressable
                      onPress={onCustomItem}
                      style={({ pressed }) => [styles.summaryCustomBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Icon name="file-plus" size={16} color={colors.primary} />
                      <Text style={styles.summaryCustomBtnText}>Ítem personalizado</Text>
                    </Pressable>
                  ) : null}

                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryValue}>{formatCurrency(subtotal)}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>IVA / impuestos</Text>
                    <Text style={styles.summaryValue}>{formatCurrency(taxAmount)}</Text>
                  </View>
                  <View style={[styles.summaryRow, styles.totalRow]}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalAmount}>{formatCurrency(total)}</Text>
                  </View>
                </View>

                <View style={styles.actionsSection}>
                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={onCreate}
                      style={({ pressed }) => [styles.actionBtn, styles.createBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Icon name="clipboard-list" size={18} color={colorScales.gray[700]} />
                      <Text style={styles.actionSecondaryText}>Crear</Text>
                    </Pressable>
                    <Pressable
                      onPress={onShipping}
                      style={({ pressed }) => [styles.actionBtn, styles.shippingBtn, pressed && { opacity: 0.85 }]}
                    >
                      <Icon name="truck" size={18} color={colors.primary} />
                      <Text style={styles.actionShippingText}>Envío</Text>
                    </Pressable>
                    {onSaveDraft ? (
                      <Pressable
                        onPress={onSaveDraft}
                        style={({ pressed }) => [styles.actionBtn, styles.createBtn, pressed && { opacity: 0.85 }]}
                        accessibilityLabel={hasDraft ? 'Actualizar borrador' : 'Guardar borrador'}
                      >
                        <Icon
                          name={hasDraft ? 'save' : 'bookmark'}
                          size={18}
                          color={hasDraft ? colors.primary : colorScales.gray[700]}
                        />
                        <Text style={styles.actionSecondaryText}>
                          {hasDraft ? 'Borrador' : 'Guardar'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={onCheckout}
                    style={({ pressed }) => [styles.actionBtn, styles.checkoutBtn, pressed && { opacity: 0.92 }]}
                  >
                    <Icon name="credit-card" size={18} color="#FFFFFF" />
                    <Text style={styles.checkoutText}>Finalizar Venta</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // ── Bottom sheet container (paridad web `.modal-overlay` + `.modal-content`) ──
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  sheetWrap: {
    maxHeight: SHEET_MAX_HEIGHT,
  },
  sheet: {
    maxHeight: SHEET_MAX_HEIGHT,
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetInner: {
    flexDirection: 'column',
  },

  // ── Header (web `.modal-header` h-16 border-b) ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    flexShrink: 0,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.text.primary,
  },
  itemCount: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[500],
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  clearBtnPressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },
  clearBtnDisabled: {
    opacity: 0.4,
  },
  clearBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.error,
  },
  clearBtnTextDisabled: {
    color: colorScales.gray[400],
  },
  // Close button — X icon visible para que el usuario siempre pueda salir.
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[100],
  },
  closeBtnPressed: {
    backgroundColor: colorScales.gray[200],
  },
  // Divisor entre el step indicator y el contenido (UX limpio).
  stepDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
  },

  // ── Items list (web `.items-list` flex column gap-12) ──
  itemsList: {
    flexShrink: 1,
  },
  itemsListContent: {
    padding: spacing[4],
    gap: spacing[3],
  },

  // ── Cart item card (web `.cart-item` grid 56px 1fr auto, border, radius 14) ──
  cartItem: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 14,
    padding: spacing[3],
    gap: spacing[2],
  },
  cartItemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
  },
  cartItemBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: spacing[1],
  },

  // ── Image (web `.item-image` 56×56 radius 10) ──
  itemImage: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: colorScales.gray[100],
    overflow: 'hidden',
    flexShrink: 0,
  },
  itemImageImg: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Info (web `.item-info` flex column, justify-content: center) ──
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
    lineHeight: 18,
  },
  variantName: {
    fontSize: 11,
    fontWeight: typography.fontWeight.medium as any,
    color: colors.primary,
    marginTop: 2,
  },
  itemDescription: {
    fontSize: 11,
    color: colorScales.gray[500],
    marginTop: 2,
    lineHeight: 14,
  },

  // ── Meta row (web `.item-meta` flex row wrap gap-6) ──
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[1.5],
    marginTop: spacing[1],
  },
  itemSku: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: colorScales.gray[500],
  },
  itemUnitPrice: {
    fontSize: 12,
    color: colorScales.gray[600],
  },
  itemTaxBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
  },
  itemTaxBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    color: 'rgb(194, 65, 12)',
  },

  // ── Remove (web `.remove-btn` 28×28 transparent → red on hover) ──
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  removeBtnPressed: {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },

  // ── Quantity controls ──
  qtyControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyBtnMinus: {
    backgroundColor: colorScales.gray[100],
  },
  qtyBtnPlus: {
    backgroundColor: colorScales.green[100],
  },
  qtyLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    minWidth: 24,
    textAlign: 'center',
    color: colorScales.gray[900],
  },

  // ── Item total (web `.item-total` fs-15 bold primary) ──
  itemTotal: {
    fontSize: 15,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.primary,
    lineHeight: 1,
  },

  // ── Empty state (web `.empty-state` flex column center p-40-20) ──
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[10],
    paddingHorizontal: spacing[5],
    gap: spacing[2],
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  emptyText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  emptyHint: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  emptyCustomBtn: {
    marginTop: spacing[5],
    minHeight: 44,
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.28)',
    borderRadius: borderRadius.lg,
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  emptyCustomBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.primary,
  },

  // ── Summary section (web `.summary-section` bg-muted border-t) ──
  summarySection: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colorScales.gray[50] || '#F9FAFB',
    flexShrink: 0,
    gap: spacing[1],
  },
  summaryCustomBtn: {
    width: '100%',
    minHeight: 42,
    marginBottom: spacing[2.5],
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.24)',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
  },
  summaryCustomBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.primary,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
  },
  totalRow: {
    paddingTop: spacing[3],
    marginTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  totalLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.text.primary,
  },
  // Web: `.total-amount font-size: 22px`. Mobile typography no tiene '2xl' — usamos 22 explícito.
  totalAmount: {
    fontSize: 22,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.primary,
    lineHeight: 26,
  },

  // ── Actions section (web `.modal-actions` flex column gap-10, border-t) ──
  actionsSection: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[5],
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    backgroundColor: colors.card,
    flexShrink: 0,
    gap: spacing[2.5],
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing[2.5],
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
  },
  createBtn: {
    flex: 1,
    height: 42,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  shippingBtn: {
    flex: 1,
    height: 42,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.5)',
  },
  actionSecondaryText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  actionShippingText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.primary,
  },
  checkoutBtn: {
    width: '100%',
    height: 48,
    backgroundColor: colors.primary,
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