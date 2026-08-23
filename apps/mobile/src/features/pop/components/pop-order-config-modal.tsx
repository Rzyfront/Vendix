import React, { useEffect, useRef, useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { DatePickerField } from '@/shared/components/date-picker-field/date-picker-field';
import { MoneyInput } from '@/shared/components/money-input/money-input';
import { Toggle } from '@/shared/components/toggle/toggle';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import type {
  PopSupplier,
  PopLocation,
  PopShippingAllocation,
  ShippingMethod,
} from '../types';
import { SHIPPING_METHOD_LABELS, SHIPPING_ALLOCATION_LEGEND } from '../constants';

type DropdownKind = 'suppliers' | 'locations' | 'shipping';

interface PopOrderConfigModalProps {
  visible: boolean;
  onClose: () => void;
  // Opciones
  suppliers: PopSupplier[];
  locations: PopLocation[];
  // Valores actuales (controlados por el padre — típicamente pop-header).
  selectedSupplierId?: number;
  selectedLocationId?: number;
  orderDate: string;
  expectedDate?: string;
  shippingMethod?: ShippingMethod;
  /** C.5 — monto del flete. Sólo se pregunta cuando el método es `freight`. */
  shippingCost?: number;
  /** C.5 — `prorate` (capitaliza al costo) o `expense` (no toca el costo). */
  shippingCostAllocation?: PopShippingAllocation;
  /** YYYY-MM-DD. Si se pasa, la fecha de entrega no puede ser anterior a esta. */
  minExpectedDate?: string;
  // Cambios (bubble-up — el padre gestiona el state).
  onSupplierChange: (id?: number, name?: string) => void;
  onLocationChange: (id?: number, name?: string) => void;
  onOrderDateChange: (date: string) => void;
  onExpectedDateChange: (date?: string) => void;
  onShippingMethodChange: (method?: ShippingMethod) => void;
  onShippingCostChange?: (cost: number) => void;
  onShippingCostAllocationChange?: (mode: PopShippingAllocation) => void;
  // Quick-create triggers — el padre abre sus modales correspondientes.
  onOpenSupplierModal?: () => void;
  onOpenWarehouseModal?: () => void;
}

/**
 * `PopOrderConfigModal` — modal de configuración de la orden de compra.
 * Réplica 1:1 del web `app-pop-order-config-modal`
 * (apps/frontend/src/app/private/modules/store/inventory/pop/components/).
 *
 * Implementado con `Modal` nativo transparente + card centrada en lugar del
 * `Modal` compartido pageSheet, para coincidir con el centrado compacto de
 * la versión web responsive (no pantalla completa).
 *
 * Captura los mismos campos que el modal web:
 *   1. Proveedor *
 *   2. Bodega *
 *   3. Fecha Orden
 *   4. Fecha Entrega (≥ Fecha Orden)
 *   5. Método Envío
 *   6. Flete: monto + conmutador de imputación (sólo si el método es `freight`)
 *
 * El componente es "tonto": todos los valores vienen del padre y cada cambio
 * se emite por callback. Sin estado interno para los valores (live-binding
 * al state del padre vía los handlers).
 *
 * Dropdowns inline (Proveedor / Bodega / Método Envío) — patrón measureInWindow
 * (`measureInWindow` del trigger + render flotante al nivel raíz del modal),
 * igual que `pop-actions-dropdown`. Esto evita que el dropdown ocupe layout
 * (no desplaza Bodega/fechas hacia abajo) y queda por encima de los demás
 * campos del formulario. Un único dropdown puede estar abierto a la vez.
 */
export default function PopOrderConfigModal({
  visible,
  onClose,
  suppliers,
  locations,
  selectedSupplierId,
  selectedLocationId,
  orderDate,
  expectedDate,
  shippingMethod,
  shippingCost = 0,
  shippingCostAllocation,
  minExpectedDate,
  onSupplierChange,
  onLocationChange,
  onOrderDateChange,
  onExpectedDateChange,
  onShippingMethodChange,
  onShippingCostChange,
  onShippingCostAllocationChange,
  onOpenSupplierModal,
  onOpenWarehouseModal,
}: PopOrderConfigModalProps) {
  const insets = useSafeAreaInsets();

  // ── C.5 Flete ────────────────────────────────────────────────────────────
  // El campo sólo existe cuando la orden viene por flete: preguntar el monto de
  // un envío que el proveedor trae no significa nada, y el backend lo rechaza.
  const isFreight = shippingMethod === 'freight';
  // Por defecto se prorratea — es la imputación contable correcta: el flete es
  // parte de lo que costó poner el producto en bodega.
  const isProrate = (shippingCostAllocation ?? 'prorate') === 'prorate';

  /**
   * `MoneyInput` es un input de texto: mantiene el string que el operador está
   * tecleando. Se guarda aparte del número del carrito porque escribir "1500."
   * (paso intermedio hacia "1500.50") colapsaría a "1500" en cada tecla si el
   * valor mostrado se derivara del número. El borrador se re-siembra sólo en la
   * transición de cerrado→abierto, para no pelear con lo que se está tecleando.
   */
  const [freightDraft, setFreightDraft] = useState('');
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setFreightDraft(Number(shippingCost) > 0 ? String(shippingCost) : '');
    }
    wasVisible.current = visible;
  }, [visible, shippingCost]);

  const handleFreightChange = (raw: string) => {
    setFreightDraft(raw);
    const parsed = Number(raw);
    // La columna es `Decimal(12,2)`: un tercer decimal se guarda distinto de lo
    // que muestra la pantalla, así que se recorta antes de salir de aquí.
    const safe =
      Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 0;
    onShippingCostChange?.(safe);
  };

  // ── Dropdown flotante: estado único + posición medida ────────────────────
  const [openDropdown, setOpenDropdown] = useState<DropdownKind | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ x: number; y: number; width: number } | null>(null);

  const supplierTriggerRef = useRef<View>(null);
  const locationTriggerRef = useRef<View>(null);
  const shippingTriggerRef = useRef<View>(null);

  const refs: Record<DropdownKind, React.RefObject<View | null>> = {
    suppliers: supplierTriggerRef,
    locations: locationTriggerRef,
    shipping: shippingTriggerRef,
  };

  const handleToggleDropdown = (kind: DropdownKind) => {
    const ref = refs[kind];
    // Toggle puro: si ya está abierto, ciérralo.
    if (openDropdown === kind) {
      setOpenDropdown(null);
      setDropdownPos(null);
      return;
    }
    ref.current?.measureInWindow((x, y, width, height) => {
      // y + height + 2 → coloca el dropdown justo debajo del trigger.
      setDropdownPos({ x, y: y + height + 2, width });
      setOpenDropdown(kind);
    });
  };

  const closeDropdown = () => {
    setOpenDropdown(null);
    setDropdownPos(null);
  };

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const selectedLocation = locations.find((l) => l.id === selectedLocationId);

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={openDropdown ? closeDropdown : onClose}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={[styles.kbWrap, { marginTop: insets.top + 16, marginBottom: insets.bottom + 16 }]}
          >
            <TouchableOpacity activeOpacity={1} onPress={() => undefined}>
              <View style={styles.card}>
                {/* ─── Header (réplica web: título + subtítulo a la izquierda, X a la derecha) ─── */}
                <View style={styles.header}>
                  <View style={styles.headerText}>
                    <Text style={styles.title}>Configurar orden de compra</Text>
                    <Text style={styles.subtitle}>
                      Proveedor, bodega, fechas, envío y flete
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={onClose}
                    hitSlop={8}
                    style={styles.closeBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Cerrar modal"
                  >
                    <Ionicons name="close" size={22} color={colorScales.gray[400]} />
                  </TouchableOpacity>
                </View>

                {/* ─── Body (5 campos) ───────────────────────────────────────────────── */}
                <ScrollView
                  style={styles.bodyScroll}
                  contentContainerStyle={styles.bodyContent}
                  keyboardShouldPersistTaps="handled"
                  onScrollBeginDrag={closeDropdown}
                >
                  {/* 1. Proveedor */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>
                      Proveedor <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.fieldRow}>
                      <TouchableOpacity
                        ref={supplierTriggerRef}
                        style={styles.selector}
                        onPress={() => handleToggleDropdown('suppliers')}
                      >
                        <Text
                          style={selectedSupplier ? styles.value : styles.placeholder}
                          numberOfLines={1}
                        >
                          {selectedSupplier?.name || 'Seleccionar proveedor...'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color="#6b7280" />
                      </TouchableOpacity>
                      {onOpenSupplierModal && (
                        <TouchableOpacity
                          style={styles.quickAddBtn}
                          onPress={onOpenSupplierModal}
                        >
                          <Ionicons name="add" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* 2. Bodega */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>
                      Bodega <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.fieldRow}>
                      <TouchableOpacity
                        ref={locationTriggerRef}
                        style={styles.selector}
                        onPress={() => handleToggleDropdown('locations')}
                      >
                        <Text
                          style={selectedLocation ? styles.value : styles.placeholder}
                          numberOfLines={1}
                        >
                          {selectedLocation?.name || 'Seleccionar bodega...'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color="#6b7280" />
                      </TouchableOpacity>
                      {onOpenWarehouseModal && (
                        <TouchableOpacity
                          style={styles.quickAddBtn}
                          onPress={onOpenWarehouseModal}
                        >
                          <Ionicons name="add" size={18} color={colors.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* 3. Fechas (2 columnas) */}
                  <View style={styles.fieldsRow}>
                    <View style={styles.field}>
                      <Text style={styles.label}>Fecha Orden</Text>
                      <DatePickerField value={orderDate} onChange={onOrderDateChange} />
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Fecha Entrega</Text>
                      <DatePickerField
                        value={expectedDate || ''}
                        onChange={(v: string) => onExpectedDateChange(v || undefined)}
                        minimumDate={minExpectedDate}
                      />
                    </View>
                  </View>

                  {/* 4. Método Envío */}
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Método Envío</Text>
                    <TouchableOpacity
                      ref={shippingTriggerRef}
                      style={styles.selector}
                      onPress={() => handleToggleDropdown('shipping')}
                    >
                      <Text
                        style={shippingMethod ? styles.value : styles.placeholder}
                        numberOfLines={1}
                      >
                        {shippingMethod
                          ? SHIPPING_METHOD_LABELS[shippingMethod]
                          : 'Elegir método...'}
                      </Text>
                      <Ionicons name="chevron-down" size={14} color="#6b7280" />
                    </TouchableOpacity>
                  </View>

                  {/*
                    5. Flete (C.5) — donde se declara el método de envío se
                    declara también cuánto costó y qué se hace con él. Si el
                    monto viviera en otra pantalla, el operador podría elegir
                    «Flete» aquí y confirmar sin que nadie le preguntara cuánto.
                  */}
                  {isFreight && (
                    <View style={styles.fieldGroup}>
                      <Text style={styles.label}>Costo del flete</Text>
                      <MoneyInput
                        value={freightDraft}
                        onChangeText={handleFreightChange}
                        placeholder="0"
                      />
                      <Toggle
                        value={isProrate}
                        onChange={(next) =>
                          onShippingCostAllocationChange?.(next ? 'prorate' : 'expense')
                        }
                        label="Prorratear el flete en el costo de los productos"
                      />
                      <Text style={styles.allocationLegend}>
                        {isProrate
                          ? SHIPPING_ALLOCATION_LEGEND.prorate
                          : SHIPPING_ALLOCATION_LEGEND.expense}
                      </Text>
                    </View>
                  )}
                </ScrollView>

                {/* ─── Footer (réplica web: Listo verde a la derecha) ───────────── */}
                <View style={styles.footer}>
                  <TouchableOpacity
                    style={styles.doneButton}
                    onPress={onClose}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Confirmar configuración"
                  >
                    <Text style={styles.doneButtonText}>Listo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>

        {/* ─── Dropdown flotante (sibling del card, anclado a la pantalla) ────── */}
        {openDropdown !== null && dropdownPos && (
          <View
            pointerEvents="box-none"
            style={[
              styles.dropdownFloating,
              {
                left: dropdownPos.x,
                top: dropdownPos.y,
                width: dropdownPos.width,
              },
            ]}
          >
            <ScrollView style={styles.dropdownScroll}>
              {openDropdown === 'suppliers' &&
                suppliers.map((s) => (
                  <TouchableOpacity
                    key={s.id}
                    style={styles.dropdownItem}
                    onPress={() => {
                      onSupplierChange(s.id, s.name);
                      closeDropdown();
                    }}
                  >
                    <Text style={styles.dropdownText}>{s.name}</Text>
                  </TouchableOpacity>
                ))}
              {openDropdown === 'locations' &&
                locations.map((l) => (
                  <TouchableOpacity
                    key={l.id}
                    style={styles.dropdownItem}
                    onPress={() => {
                      onLocationChange(l.id, l.name);
                      closeDropdown();
                    }}
                  >
                    <Text style={styles.dropdownText}>{l.name}</Text>
                  </TouchableOpacity>
                ))}
              {openDropdown === 'shipping' &&
                (Object.keys(SHIPPING_METHOD_LABELS) as ShippingMethod[]).map((key) => (
                  <TouchableOpacity
                    key={key}
                    style={styles.dropdownItem}
                    onPress={() => {
                      onShippingMethodChange(key);
                      closeDropdown();
                    }}
                  >
                    <Text style={styles.dropdownText}>{SHIPPING_METHOD_LABELS[key]}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        )}
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  // ─── Root (cover full screen) ────────────────────────────────────────────
  root: {
    flex: 1,
  },

  // ─── Backdrop + card centrada (réplica web modal compacto) ───────────────
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  kbWrap: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
    ...shadows.lg,
  },

  // ─── Header ─────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    gap: spacing[3],
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text?.primary ?? colorScales.gray[900],
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 11,
    color: colorScales.gray[500],
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // ─── Body / form ────────────────────────────────────────────────────────
  bodyScroll: {
    maxHeight: 500,
  },
  bodyContent: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  fieldGroup: {
    gap: 6,
    minWidth: 0,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  field: {
    flex: 1,
    minWidth: 0,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing[1.5],
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colorScales.gray[500],
    paddingLeft: 2,
  },
  required: {
    color: colors.error,
  },
  allocationLegend: {
    fontSize: 11,
    lineHeight: 16,
    color: colorScales.gray[500],
  },
  selector: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.background,
    minHeight: 38,
  },
  quickAddBtn: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  value: {
    flex: 1,
    marginRight: 4,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[900],
  },
  placeholder: {
    flex: 1,
    marginRight: 4,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },

  // ─── Footer ─────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  doneButton: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ─── Dropdown flotante (anclado a la pantalla via measureInWindow) ───────
  dropdownFloating: {
    position: 'absolute',
    zIndex: 1000,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  dropdownScroll: {
    maxHeight: 200,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[700],
  },
});
