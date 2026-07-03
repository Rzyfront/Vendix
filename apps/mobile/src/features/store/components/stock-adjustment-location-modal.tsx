import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  ScrollView,
  TextInput,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@/shared/components/icon/icon';
import {
  InventoryService,
  type CreateAdjustmentDto,
} from '@/features/store/services/inventory.service';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import {
  ADJUSTMENT_TYPE_LABELS,
  type AdjustmentType,
} from '@/features/store/types/inventory.types';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

export interface StockLocationOption {
  id: number;
  name: string;
}

/**
 * Producto pre-seleccionado para el modal de ajuste de stock.
 * Se pasa desde el form de producto (mode='edit') para saltarse el paso
 * de búsqueda de productos. Equivalente al `preselectedProduct` del
 * modal web `app-adjustment-create-modal`.
 */
export interface PreselectedStockProduct {
  id: number;
  name: string;
  sku?: string | null;
  /** Stock total actual (para crear producto nuevo o fallback). */
  stock_quantity?: number;
}

interface StockAdjustmentModalProps {
  visible: boolean;
  locations: StockLocationOption[];
  /** Producto pre-seleccionado desde product-upsert-form. */
  preselectedProduct?: PreselectedStockProduct;
  onClose: () => void;
  /**
   * Disparado tras `Crear y Aplicar` exitoso. El padre invalida aquí las
   * queries que muestran stock (products, pos-products, consolidated-stock,
   * inventory-stats, adjustments, etc.) — el modal no toca queryClient por
   * delegación al padre.
   */
  onSubmitted?: () => void;
}

type Step = 1 | 2;

/**
 * Ajuste: mapping tipo → reason_code que el backend espera (mirror del web).
 * Si no hay match (e.g. tipo custom), el backend acepta reason_code null/empty.
 */
const REASON_CODE_BY_TYPE: Record<AdjustmentType, string> = {
  damage: 'DAMAGED',
  loss: 'LOST',
  theft: 'THEFT',
  expiration: 'EXPIRED',
  count_variance: 'INV_COUNT',
  manual_correction: 'OTHER',
};

/** Iconos para la grid de tipos — mismos que `app/(store-admin)/inventory/adjustments.tsx`. */
const TYPE_ICONS: Record<AdjustmentType, string> = {
  damage: 'alert-triangle',
  loss: 'trending-down',
  theft: 'lock',
  expiration: 'clock',
  count_variance: 'layers',
  manual_correction: 'edit-2',
};

/**
 * StockAdjustmentModal — modal de 2 pasos que reemplaza el antiguo
 * StockAdjustmentLocationModal. En modo pre-seleccionado (preselectedProduct)
 * el flujo es:
 *
 *   Paso 1 — UBICACIÓN  →  Paso 2 — CONFIRMAR (con tarjeta del producto)
 *
 * Internamente ejecuta `InventoryService.createAdjustment` (que llama al
 * endpoint `POST /store/inventory/adjustments/batch-complete`, mismo que usa
 * la versión web móvil). Disparado `onSubmitted` en el padre para que
 * invalide las queries que muestren el stock del producto.
 *
 * Espejo del `app-adjustment-create-modal` web en modo preseleccionado
 * (ver `apps/frontend/src/app/private/modules/store/inventory/operations/components/adjustment-create-modal.component.ts`).
 */
export default function StockAdjustmentModal({
  visible,
  locations,
  preselectedProduct,
  onClose,
  onSubmitted,
}: StockAdjustmentModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(1);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Estado del producto pre-seleccionado (editable en paso 2)
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('manual_correction');
  const [quantityAfter, setQuantityAfter] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [confirmed, setConfirmed] = useState<boolean>(false);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocationId) ?? null,
    [locations, selectedLocationId],
  );

  const productId = preselectedProduct?.id;
  const productEnabled =
    !!preselectedProduct && !!productId && Number.isFinite(productId) && productId > 0;

  // Stock consolidado por ubicación. Sólo activo si hay locationId y productId.
  // Devuelve `stockByLocation` con `LocationStock { locationId, onHand, ... }`.
  const consolidatedQuery = useQuery({
    queryKey: ['consolidated-stock', productId],
    queryFn: () => InventoryService.getConsolidatedStock(Number(productId)),
    enabled: visible && productEnabled,
    staleTime: 0,
  });

  // Stock actual del producto en la ubicación seleccionada (onHand).
  // Si no hay LocationStock para esta ubicación, fallback al stock_quantity
  // global del producto (caso: producto sin stock_by_location aún).
  const stockOnHand = useMemo(() => {
    if (!consolidatedQuery.data || !selectedLocationId) return 0;
    const stockByLocation = consolidatedQuery.data.stockByLocation ?? [];
    const atLocation = stockByLocation.find(
      (s) => Number(s.locationId) === Number(selectedLocationId),
    );
    if (atLocation) return Number(atLocation.onHand ?? 0);
    // Fallback: si el producto se acaba de crear y no hay entry por
    // ubicación, mostramos el stock_quantity global del producto pre-seleccionado.
    return Number(preselectedProduct?.stock_quantity ?? 0);
  }, [consolidatedQuery.data, selectedLocationId, preselectedProduct?.stock_quantity]);

  // Reset state en cada apertura (false→true). Mirror del effect del web modal.
  useEffect(() => {
    if (visible) {
      setStep(1);
      setSelectedLocationId(null);
      setShowDropdown(false);
      setAdjustmentType('manual_correction');
      setQuantityAfter(String(stockOnHand || ''));
      setDescription('');
      setConfirmed(false);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cuando el usuario avanza al paso 2, pre-rellenamos quantity_after con
  // el stock_on_hand actual (para que el "delta" inicial sea 0).
  useEffect(() => {
    if (step === 2 && stockOnHand !== null) {
      setQuantityAfter((current) => {
        // Si el usuario ya empezó a editar, no pisamos su valor.
        if (current !== '' && Number.isFinite(Number(current))) return current;
        return String(stockOnHand || 0);
      });
    }
  }, [step, stockOnHand]);

  const quantityChange = useMemo(() => {
    const after = Number(quantityAfter);
    if (!Number.isFinite(after)) return 0;
    return after - Number(stockOnHand || 0);
  }, [quantityAfter, stockOnHand]);

  const canAdvanceToStep2 = selectedLocationId !== null;
  const canSubmit =
    !!selectedLocationId &&
    productEnabled &&
    Number.isFinite(Number(quantityAfter)) &&
    Number(quantityAfter) >= 0 &&
    confirmed &&
    !!adjustmentType;

  const createMutation = useMutation({
    mutationFn: (dto: CreateAdjustmentDto) => InventoryService.createAdjustment(dto),
    onSuccess: () => {
      toastSuccess('Ajustes creados y aplicados correctamente');
      // Forzamos refresh de la query de stock para que al reabrir el modal
      // el `stockOnHand` ya muestre el nuevo valor sin necesidad de esperar
      // a que el padre ejecute su invalidación.
      if (productId) {
        queryClient.invalidateQueries({ queryKey: ['consolidated-stock', productId] });
      }
      onSubmitted?.();
      onClose();
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      const detail = Array.isArray(data?.message)
        ? data.message.join(' • ')
        : data?.message;
      const msg =
        detail ||
        data?.error ||
        (err instanceof Error ? err.message : null) ||
        'Error al crear el ajuste';
      toastError(typeof msg === 'string' ? msg : 'Error al crear el ajuste');
    },
  });

  const handleSubmit = () => {
    if (!canSubmit || !selectedLocationId || !productEnabled || productId == null) return;
    const dto: CreateAdjustmentDto = {
      location_id: Number(selectedLocationId),
      items: [
        {
          product_id: Number(productId),
          type: adjustmentType,
          quantity_after: Number(quantityAfter),
          reason_code: REASON_CODE_BY_TYPE[adjustmentType],
          ...(description.trim() ? { description: description.trim() } : {}),
        },
      ],
    };
    createMutation.mutate(dto);
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>
                {step === 1 ? 'Seleccionar Ubicación' : 'Confirmar Ajustes'}
              </Text>
              <Text style={styles.subtitle}>Registrar ajustes de inventario</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Icon name="x" size={20} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          {/* Stepper */}
          <View style={styles.stepper}>
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  (step === 1 || step === 2) && styles.stepCircleActive,
                ]}
              >
                <Text
                  style={[
                    styles.stepNum,
                    (step === 1 || step === 2) && styles.stepNumActive,
                  ]}
                >
                  1
                </Text>
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  (step === 1 || step === 2) && styles.stepLabelActive,
                ]}
              >
                UBICACIÓN
              </Text>
            </View>
            <View
              style={[
                styles.stepLine,
                step === 2 && styles.stepLineActive,
              ]}
            />
            <View style={styles.stepItem}>
              <View
                style={[
                  styles.stepCircle,
                  step === 2 && styles.stepCircleActive,
                ]}
              >
                <Text
                  style={[
                    styles.stepNum,
                    step === 2 && styles.stepNumActive,
                  ]}
                >
                  2
                </Text>
              </View>
              <Text
                style={[
                  styles.stepLabel,
                  step === 2 && styles.stepLabelActive,
                ]}
              >
                CONFIRMAR
              </Text>
            </View>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Paso 1: Ubicación */}
            {step === 1 && (
              <View>
                <Text style={styles.fieldLabel}>Ubicación *</Text>
                <Pressable
                  onPress={() => setShowDropdown((prev) => !prev)}
                  style={({ pressed }) => [
                    styles.selectTrigger,
                    showDropdown && styles.selectTriggerActive,
                    pressed && { backgroundColor: colorScales.gray[50] },
                  ]}
                >
                  <Text
                    style={[
                      styles.selectValue,
                      !selectedLocation && styles.selectPlaceholder,
                    ]}
                  >
                    {selectedLocation
                      ? selectedLocation.name
                      : 'Seleccionar ubicación'}
                  </Text>
                  <Icon
                    name={showDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                {showDropdown && (
                  <ScrollView style={styles.dropdownList} nestedScrollEnabled>
                    {locations.length === 0 ? (
                      <Text style={styles.emptyText}>
                        No hay ubicaciones disponibles
                      </Text>
                    ) : (
                      locations.map((loc) => (
                        <Pressable
                          key={loc.id}
                          onPress={() => {
                            setSelectedLocationId(loc.id);
                            setShowDropdown(false);
                          }}
                          style={[
                            styles.dropdownOption,
                            selectedLocationId === loc.id &&
                              styles.dropdownOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.dropdownOptionText,
                              selectedLocationId === loc.id &&
                                styles.dropdownOptionTextActive,
                            ]}
                          >
                            {loc.name}
                          </Text>
                          {selectedLocationId === loc.id && (
                            <Icon
                              name="check"
                              size={14}
                              color={colors.primary}
                            />
                          )}
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                )}
              </View>
            )}

            {/* Paso 2: Confirmar Ajustes */}
            {step === 2 && preselectedProduct && (
              <View style={{ gap: spacing[4] }}>
                {/* Banner con la ubicación + botón "Cambiar" */}
                <View style={styles.locationBanner}>
                  <Icon name="map-pin" size={18} color={colors.primary} />
                  <Text style={styles.locationBannerText} numberOfLines={1}>
                    {selectedLocation?.name ?? '—'}
                  </Text>
                  <Pressable
                    onPress={() => setStep(1)}
                    hitSlop={6}
                    style={styles.changeLocationBtn}
                    accessibilityLabel="Cambiar ubicación"
                  >
                    <Text style={styles.changeLocationText}>Cambiar</Text>
                  </Pressable>
                </View>

                {/* Tarjeta del producto pre-seleccionado */}
                <View style={styles.productCard}>
                  <Text style={styles.productName} numberOfLines={2}>
                    {preselectedProduct.name}
                  </Text>
                  <View style={styles.productMetaRow}>
                    <Text style={styles.productMetaLabel}>
                      Stock actual:{' '}
                      <Text style={styles.productMetaValue}>
                        {Number(stockOnHand || 0)}
                      </Text>
                    </Text>
                    {preselectedProduct.sku ? (
                      <Text style={styles.productMetaLabel}>
                        SKU:{' '}
                        <Text style={styles.productMetaValue}>
                          {preselectedProduct.sku}
                        </Text>
                      </Text>
                    ) : null}
                  </View>

                  {/* Tipo — grid 3×2 */}
                  <Text style={styles.fieldLabelTop}>Tipo *</Text>
                  <View style={styles.typeGrid}>
                    {(Object.keys(ADJUSTMENT_TYPE_LABELS) as AdjustmentType[]).map((t) => {
                      const isActive = adjustmentType === t;
                      return (
                        <Pressable
                          key={t}
                          onPress={() => setAdjustmentType(t)}
                          style={({ pressed }) => [
                            styles.typeCard,
                            isActive && styles.typeCardActive,
                            pressed && !isActive && { backgroundColor: colorScales.gray[50] },
                          ]}
                          accessibilityLabel={`Tipo ${ADJUSTMENT_TYPE_LABELS[t]}`}
                        >
                          <Icon
                            name={TYPE_ICONS[t]}
                            size={14}
                            color={isActive ? colors.primary : colorScales.gray[500]}
                          />
                          <Text
                            style={[
                              styles.typeCardText,
                              isActive && styles.typeCardTextActive,
                            ]}
                          >
                            {ADJUSTMENT_TYPE_LABELS[t]}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Cantidad */}
                  <Text style={styles.fieldLabelTop}>Nueva Cantidad *</Text>
                  <View style={styles.qtyRow}>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        style={styles.qtyInput}
                        value={quantityAfter}
                        onChangeText={(v) => setQuantityAfter(v.replace(/[^0-9]/g, ''))}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={colorScales.gray[400]}
                      />
                    </View>
                    <View style={styles.qtyPreview}>
                      <Text style={styles.qtyPreviewFrom}>{Number(stockOnHand || 0)}</Text>
                      <Icon
                        name="arrow-right"
                        size={14}
                        color={colorScales.gray[500]}
                      />
                      <Text
                        style={[
                          styles.qtyPreviewTo,
                          quantityChange > 0 && styles.qtyPreviewToPositive,
                          quantityChange < 0 && styles.qtyPreviewToNegative,
                        ]}
                      >
                        {Number.isFinite(Number(quantityAfter)) ? Number(quantityAfter) : 0}
                      </Text>
                      {quantityChange !== 0 && (
                        <Text
                          style={[
                            styles.qtyPreviewDelta,
                            quantityChange > 0 && styles.qtyPreviewDeltaPositive,
                            quantityChange < 0 && styles.qtyPreviewDeltaNegative,
                          ]}
                        >
                          ({quantityChange > 0 ? '+' : ''}
                          {quantityChange})
                        </Text>
                      )}
                    </View>
                  </View>

                  {/* Descripción opcional */}
                  <Text style={styles.fieldLabelTop}>Nota adicional (opcional)</Text>
                  <TextInput
                    style={styles.descInput}
                    value={description}
                    onChangeText={setDescription}
                    placeholder="Ej. Daño por humedad en bodega"
                    placeholderTextColor={colorScales.gray[400]}
                  />

                  {/* Checkbox de confirmación */}
                  <View style={styles.confirmRow}>
                    <Switch
                      value={confirmed}
                      onValueChange={setConfirmed}
                      trackColor={{ false: colorScales.gray[200], true: colorScales.green[400] }}
                      thumbColor={confirmed ? colors.primary : colorScales.gray[50]}
                    />
                    <View style={styles.confirmTextWrap}>
                      <Text style={styles.confirmLabel}>Confirmar creación de ajustes</Text>
                      <Text style={styles.confirmHint}>
                        Al crear y aplicar, los movimientos de inventario se aplicarán
                        inmediatamente y no podrán ser revertidos.
                      </Text>
                    </View>
                  </View>

                  {/* Warning: cambio = 0 */}
                  {Number.isFinite(Number(quantityAfter)) &&
                    Number(quantityAfter) === Number(stockOnHand || 0) && (
                      <View style={styles.warningRow}>
                        <Icon
                          name="alert-triangle"
                          size={16}
                          color={colorScales.amber[600]}
                        />
                        <Text style={styles.warningText}>
                          La nueva cantidad es igual al stock actual. No se aplicará
                          ningún ajuste.
                        </Text>
                      </View>
                    )}
                </View>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {step === 1 ? (
              <Pressable
                style={[
                  styles.primaryBtn,
                  !canAdvanceToStep2 && styles.primaryBtnDisabled,
                ]}
                onPress={() => {
                  if (canAdvanceToStep2) setStep(2);
                }}
                disabled={!canAdvanceToStep2}
                accessibilityLabel="Continuar"
              >
                <Text style={styles.primaryBtnText}>Continuar</Text>
                <Icon name="arrow-right" size={16} color={colors.background} />
              </Pressable>
            ) : (
              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setStep(1)}
                  style={({ pressed }) => [
                    styles.outlineBtnSmall,
                    pressed && { backgroundColor: colorScales.gray[100] },
                  ]}
                  accessibilityLabel="Atrás"
                >
                  <Icon name="arrow-left" size={16} color={colorScales.gray[700]} />
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={!canSubmit || createMutation.isPending}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    styles.primaryBtnFlex,
                    (!canSubmit || createMutation.isPending) && styles.primaryBtnDisabled,
                    pressed && canSubmit && { backgroundColor: colorScales.green[700] },
                  ]}
                  accessibilityLabel="Crear y aplicar ajustes"
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator size="small" color={colors.background} />
                  ) : (
                    <>
                      <Icon name="check-circle" size={16} color={colors.background} />
                      <Text style={styles.primaryBtnText}>Crear y Aplicar</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeFooterBtn,
                pressed && { backgroundColor: 'rgba(220, 38, 38, 0.1)' },
              ]}
              accessibilityLabel="Cerrar modal"
            >
              <Icon name="x" size={22} color={colorScales.red[500]} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  modal: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 540,
    maxHeight: '92%',
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerText: { flex: 1 },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing[1],
  },
  body: {
    padding: spacing[4],
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  stepItem: {
    alignItems: 'center',
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  stepCircleActive: {
    borderColor: colors.primary,
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: colorScales.gray[200],
    marginHorizontal: spacing[2],
    marginTop: 1,
  },
  stepLineActive: {
    backgroundColor: colors.primary,
  },
  stepNum: {
    fontSize: 12,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
  },
  stepNumActive: {
    color: colors.primary,
  },
  stepLabel: {
    fontSize: 9,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
    textTransform: 'uppercase' as any,
    letterSpacing: 1,
    marginTop: 4,
  },
  stepLabelActive: {
    color: colors.primary,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
    marginBottom: spacing[2],
  },
  fieldLabelTop: {
    fontSize: 12,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.secondary,
    marginTop: spacing[3],
    marginBottom: spacing[2],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
  },
  selectTriggerActive: {
    backgroundColor: colorScales.green[50],
    borderColor: colors.primary,
  },
  selectValue: {
    fontSize: 14,
    color: colors.text.primary,
    flex: 1,
  },
  selectPlaceholder: {
    color: colorScales.gray[400],
  },
  dropdownList: {
    maxHeight: 240,
    marginTop: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.card,
  },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownOptionActive: {
    backgroundColor: colorScales.green[50],
  },
  dropdownOptionText: {
    fontSize: 14,
    color: colorScales.gray[700],
  },
  dropdownOptionTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  emptyText: {
    textAlign: 'center' as any,
    fontSize: 12,
    color: colorScales.gray[500],
    padding: spacing[3],
  },
  // Paso 2
  locationBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.green[100],
  },
  locationBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  changeLocationBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.md,
  },
  changeLocationText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.primary,
  },
  productCard: {
    padding: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  productName: {
    fontSize: 14,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  productMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },
  productMetaLabel: {
    fontSize: 11,
    color: colorScales.gray[500],
  },
  productMetaValue: {
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  typeCard: {
    width: '31%',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[1],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  typeCardActive: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  typeCardText: {
    fontSize: 10,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.semibold as any,
    textAlign: 'center' as any,
  },
  typeCardTextActive: {
    color: colors.primary,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  qtyInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: 16,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
    backgroundColor: colors.card,
    textAlign: 'center' as any,
  },
  qtyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: spacing[2],
  },
  qtyPreviewFrom: {
    fontSize: 13,
    color: colorScales.gray[500],
  },
  qtyPreviewTo: {
    fontSize: 14,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.text.primary,
  },
  qtyPreviewToPositive: { color: colorScales.green[700] },
  qtyPreviewToNegative: { color: colorScales.red[600] },
  qtyPreviewDelta: {
    fontSize: 11,
    color: colorScales.gray[500],
    marginLeft: 4,
  },
  qtyPreviewDeltaPositive: { color: colorScales.green[700] },
  qtyPreviewDeltaNegative: { color: colorScales.red[600] },
  descInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: 13,
    color: colors.text.primary,
    backgroundColor: colors.card,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginTop: spacing[4],
    padding: spacing[3],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.amber[100],
  },
  confirmTextWrap: { flex: 1 },
  confirmLabel: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  confirmHint: {
    fontSize: 11,
    color: colorScales.gray[600],
    marginTop: 2,
    lineHeight: 15,
  },
  warningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    padding: spacing[2.5],
    backgroundColor: colorScales.amber[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.amber[100],
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: colorScales.amber[700],
  },
  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
  },
  primaryBtnFlex: { flexShrink: 1 },
  primaryBtnDisabled: {
    backgroundColor: colorScales.gray[200],
    opacity: 0.6,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.background,
  },
  outlineBtnSmall: {
    paddingVertical: 12,
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
    alignItems: 'center',
  },
  confirmActions: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing[2],
  },
  closeFooterBtn: {
    padding: spacing[1],
  },
});
