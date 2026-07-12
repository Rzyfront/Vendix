import { useState, useMemo, useEffect } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Input,
  Selector,
  Textarea,
  Button,
  Toggle,
  DatePicker,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { PromotionsService } from '@/features/store/services/promotions.service';
import type {
  CreatePromotionDto,
  Promotion,
  PromotionRuleType,
  PromotionScope,
  PromotionType,
  QuantityTier,
  UpdatePromotionDto,
} from '@/features/store/types/promotions.types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { PROMOTION_LABELS, PROMOTION_SCOPE_LABEL, PROMOTION_RULE_TYPE_LABEL, PROMOTION_TYPE_LABEL } from '@/features/store/constants/promotion-labels';
import { PromotionTierRow } from './promotion-tier-row';

// ─── Options for selectors (mirror web `promotion-form-modal.component.ts:601-665`) ──
const RULE_TYPE_OPTIONS: { label: string; value: PromotionRuleType }[] = [
  { label: PROMOTION_RULE_TYPE_LABEL.flat, value: 'flat' },
  { label: PROMOTION_RULE_TYPE_LABEL.quantity_tiered, value: 'quantity_tiered' },
];

const SCOPE_OPTIONS: { label: string; value: PromotionScope }[] = [
  { label: PROMOTION_SCOPE_LABEL.order, value: 'order' },
  { label: PROMOTION_SCOPE_LABEL.product, value: 'product' },
  { label: PROMOTION_SCOPE_LABEL.category, value: 'category' },
];

const TYPE_OPTIONS: { label: string; value: PromotionType }[] = [
  { label: PROMOTION_TYPE_LABEL.percentage, value: 'percentage' },
  { label: PROMOTION_TYPE_LABEL.fixed_amount, value: 'fixed_amount' },
];

const CARD_MAX_WIDTH = 480;

export interface PromotionUpsertModalProps {
  visible: boolean;
  /** `null` = crear nueva. Objeto = editar existente. */
  promotion: Promotion | null;
  onClose: () => void;
  /** Notifica al padre con el `message` del backend (toast success). */
  onSaved?: (message: string | undefined) => void;
}

export function PromotionUpsertModal({
  visible,
  promotion,
  onClose,
  onSaved,
}: PromotionUpsertModalProps) {
  const queryClient = useQueryClient();
  const isEdit = promotion !== null;

  // ── Form state ────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [ruleType, setRuleType] = useState<PromotionRuleType>('flat');
  const [scope, setScope] = useState<PromotionScope>('order');
  const [type, setType] = useState<PromotionType>('percentage');
  const [value, setValue] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [minPurchase, setMinPurchase] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [perCustomerLimit, setPerCustomerLimit] = useState('');
  const [isAutoApply, setIsAutoApply] = useState(false);
  const [priority, setPriority] = useState('0');
  const [productIds, setProductIds] = useState<number[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [tiers, setTiers] = useState<QuantityTier[]>([]);

  // ── Errors (verbatim web) ─────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  // ── Hydrate from promotion on open ────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    if (promotion) {
      setName(promotion.name ?? '');
      setDescription(promotion.description ?? '');
      setCode(promotion.code ?? '');
      setRuleType(promotion.rule_type ?? 'flat');
      setScope(promotion.scope ?? 'order');
      setType(promotion.type ?? 'percentage');
      setValue(promotion.value != null ? String(promotion.value) : '');
      setStartDate(promotion.start_date ? toDateInput(promotion.start_date) : null);
      setEndDate(promotion.end_date ? toDateInput(promotion.end_date) : null);
      setMinPurchase(promotion.min_purchase_amount != null ? String(promotion.min_purchase_amount) : '');
      setMaxDiscount(promotion.max_discount_amount != null ? String(promotion.max_discount_amount) : '');
      setUsageLimit(promotion.usage_limit != null ? String(promotion.usage_limit) : '');
      setPerCustomerLimit(promotion.per_customer_limit != null ? String(promotion.per_customer_limit) : '');
      setIsAutoApply(!!promotion.is_auto_apply);
      setPriority(String(promotion.priority ?? 0));
      setProductIds((promotion.promotion_products ?? []).map((p) => p.product_id));
      setCategoryIds((promotion.promotion_categories ?? []).map((c) => c.category_id));
      setTiers(promotion.promotion_quantity_tiers ?? []);
    } else {
      resetForm();
    }
    setErrors({});
  }, [visible, promotion]);

  function resetForm() {
    setName('');
    setDescription('');
    setCode('');
    setRuleType('flat');
    setScope('order');
    setType('percentage');
    setValue('');
    setStartDate(null);
    setEndDate(null);
    setMinPurchase('');
    setMaxDiscount('');
    setUsageLimit('');
    setPerCustomerLimit('');
    setIsAutoApply(false);
    setPriority('0');
    setProductIds([]);
    setCategoryIds([]);
    setTiers([]);
    setErrors({});
  }

  // ── Validation ────────────────────────────────────────────────────────
  const tierRowErrors = useMemo(() => {
    return computeTierRowErrors(tiers);
  }, [tiers]);

  const isValid = useMemo(() => {
    return (
      name.trim().length > 0 &&
      !!startDate &&
      (ruleType === 'flat' ? Number(value) > 0 : tiers.length > 0) &&
      tierRowErrors.filter(Boolean).length === 0 &&
      (scope !== 'product' || productIds.length > 0) &&
      (scope !== 'category' || categoryIds.length > 0)
    );
  }, [name, startDate, ruleType, value, tiers, tierRowErrors, scope, productIds, categoryIds]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (dto: CreatePromotionDto) => PromotionsService.create(dto),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Promocion creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.invalidateQueries({ queryKey: ['promotion-stats'] });
      onSaved?.(res?.message);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Error';
      toastError(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdatePromotionDto }) =>
      PromotionsService.update(id, dto),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Promocion actualizada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      queryClient.invalidateQueries({ queryKey: ['promotion-stats'] });
      onSaved?.(res?.message);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Error';
      toastError(msg);
    },
  });

  const mutation = isEdit ? updateMutation : createMutation;
  const isPending = mutation.isPending;

  // ── Handlers ──────────────────────────────────────────────────────────
  function handleClose() {
    if (isPending) return;
    resetForm();
    onClose();
  }

  function handleSubmit() {
    const newErrors: Record<string, string | undefined> = {};

    if (!name.trim()) newErrors.name = PROMOTION_LABELS.errNameRequired;
    if (!startDate) newErrors.start_date = PROMOTION_LABELS.errStartDateRequired;

    if (ruleType === 'flat') {
      const num = Number(value);
      if (!value || isNaN(num)) newErrors.value = PROMOTION_LABELS.errValueRequired;
      else if (num <= 0) newErrors.value = PROMOTION_LABELS.errMinValue;
      else if (type === 'percentage' && num > 100) newErrors.value = PROMOTION_LABELS.errMaxPercent;
    } else {
      if (tiers.length === 0) newErrors.tiers = PROMOTION_LABELS.errTiersMinOne;
      else if (tierRowErrors.filter(Boolean).length > 0)
        newErrors.tiers = PROMOTION_LABELS.errTiersAdjacency;
    }

    if (scope === 'product' && productIds.length === 0)
      newErrors.product_ids = PROMOTION_LABELS.errProductsRequired;
    if (scope === 'category' && categoryIds.length === 0)
      newErrors.category_ids = PROMOTION_LABELS.errCategoriesRequired;

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const baseDto: CreatePromotionDto = {
      name: name.trim(),
      type,
      value: ruleType === 'flat' ? Number(value) : 0,
      rule_type: ruleType,
      scope,
      start_date: startDate!,
      is_auto_apply: isAutoApply,
      priority: Number(priority) || 0,
    };

    if (description.trim()) baseDto.description = description.trim();
    if (code.trim()) baseDto.code = code.trim();
    if (endDate) baseDto.end_date = endDate;
    if (minPurchase) baseDto.min_purchase_amount = Number(minPurchase);
    if (maxDiscount && type === 'percentage') baseDto.max_discount_amount = Number(maxDiscount);
    if (usageLimit) baseDto.usage_limit = Number(usageLimit);
    if (perCustomerLimit) baseDto.per_customer_limit = Number(perCustomerLimit);
    if (scope === 'product' && productIds.length > 0) baseDto.product_ids = productIds;
    if (scope === 'category' && categoryIds.length > 0) baseDto.category_ids = categoryIds;
    if (ruleType === 'quantity_tiered' && tiers.length > 0) {
      baseDto.quantity_tiers = tiers.map((t, i) => ({
        min_quantity: t.min_quantity,
        max_quantity: t.max_quantity ?? null,
        type: t.type,
        value: t.value,
        sort_order: t.sort_order ?? i,
      }));
    }

    if (isEdit && promotion) {
      updateMutation.mutate({ id: promotion.id, dto: baseDto });
    } else {
      createMutation.mutate(baseDto);
    }
  }

  function handleAddTier() {
    setTiers([
      ...tiers,
      {
        min_quantity: 1,
        max_quantity: null,
        type: 'percentage',
        value: 0,
        sort_order: tiers.length,
      },
    ]);
  }

  function handleTierChange(index: number, next: QuantityTier) {
    setTiers(tiers.map((t, i) => (i === index ? next : t)));
  }

  function handleTierRemove(index: number) {
    setTiers(tiers.filter((_, i) => i !== index));
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {isEdit ? 'Editar Promocion' : 'Nueva Promocion'}
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { backgroundColor: colorScales.gray[100] },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Icon name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Input
                label={PROMOTION_LABELS.fieldName}
                value={name}
                onChangeText={setName}
                required
                error={errors.name}
                editable={!isPending}
                maxLength={255}
              />

              <Textarea
                label={PROMOTION_LABELS.fieldDescription}
                value={description}
                onChangeText={setDescription}
                rows={2}
                placeholder="Descripcion (opcional)"
                editable={!isPending}
                maxLength={500}
              />

              <Input
                label={PROMOTION_LABELS.fieldCode}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase())}
                placeholder="CODIGO"
                maxLength={50}
                editable={!isPending}
                helperText="Codigo de cupon (opcional). Se guarda en MAYUSCULAS."
              />

              <Selector
                label={PROMOTION_LABELS.fieldRule}
                value={ruleType}
                onChange={(v) => setRuleType(v as PromotionRuleType)}
                options={RULE_TYPE_OPTIONS}
                required
                disabled={isPending}
              />

              <Selector
                label={PROMOTION_LABELS.fieldScope}
                value={scope}
                onChange={(v) => {
                  const next = v as PromotionScope;
                  setScope(next);
                  // Limpiar IDs no aplicables al cambiar scope (mirror web l. 409-414)
                  if (next !== 'product') setProductIds([]);
                  if (next !== 'category') setCategoryIds([]);
                }}
                options={SCOPE_OPTIONS}
                disabled={isPending}
              />

              <Selector
                label={PROMOTION_LABELS.fieldType}
                value={type}
                onChange={(v) => setType(v as PromotionType)}
                options={TYPE_OPTIONS}
                required
                disabled={isPending}
              />

              {ruleType === 'flat' ? (
                <Input
                  label={PROMOTION_LABELS.fieldValue}
                  value={value}
                  onChangeText={setValue}
                  required
                  keyboardType="decimal-pad"
                  error={errors.value}
                  editable={!isPending}
                  suffix={type === 'percentage' ? <Text style={styles.suffix}>%</Text> : undefined}
                />
              ) : (
                <View style={styles.tiersSection}>
                  <View style={styles.tiersHeader}>
                    <Text style={styles.tiersTitle}>{PROMOTION_LABELS.fieldTiers}</Text>
                    <Button
                      title={PROMOTION_LABELS.fieldAddTier}
                      variant="outline"
                      size="sm"
                      leftIcon="plus"
                      onPress={handleAddTier}
                      disabled={isPending}
                    />
                  </View>
                  <Text style={styles.tiersHelp}>{PROMOTION_LABELS.fieldTierHelp}</Text>
                  {errors.tiers ? <Text style={styles.tiersError}>{errors.tiers}</Text> : null}
                  {tiers.length === 0 ? (
                    <Text style={styles.tiersEmpty}>{PROMOTION_LABELS.fieldNoTiers}</Text>
                  ) : (
                    tiers.map((t, i) => (
                      <PromotionTierRow
                        key={i}
                        index={i}
                        totalRows={tiers.length}
                        value={t}
                        onChange={(next) => handleTierChange(i, next)}
                        onRemove={() => handleTierRemove(i)}
                        rowError={tierRowErrors[i]}
                        disabled={isPending}
                      />
                    ))
                  )}
                </View>
              )}

              {scope === 'product' ? (
                <View>
                  <Text style={styles.fieldLabel}>
                    {PROMOTION_LABELS.fieldProducts} <Text style={styles.required}>*</Text>
                  </Text>
                  {/* TODO: reemplazar por MultiSelector cuando se hidraten productos.
                      Por ahora, input libre de IDs separados por coma. */}
                  <Input
                    value={productIds.join(',')}
                    onChangeText={(t) =>
                      setProductIds(
                        t
                          .split(',')
                          .map((s) => Number(s.trim()))
                          .filter((n) => Number.isFinite(n) && n > 0),
                      )
                    }
                    placeholder="IDs separados por coma (1,2,3)"
                    keyboardType="number-pad"
                    error={errors.product_ids}
                    editable={!isPending}
                  />
                </View>
              ) : null}

              {scope === 'category' ? (
                <View>
                  <Text style={styles.fieldLabel}>
                    {PROMOTION_LABELS.fieldCategories} <Text style={styles.required}>*</Text>
                  </Text>
                  <Input
                    value={categoryIds.join(',')}
                    onChangeText={(t) =>
                      setCategoryIds(
                        t
                          .split(',')
                          .map((s) => Number(s.trim()))
                          .filter((n) => Number.isFinite(n) && n > 0),
                      )
                    }
                    placeholder="IDs separados por coma (1,2,3)"
                    keyboardType="number-pad"
                    error={errors.category_ids}
                    editable={!isPending}
                  />
                </View>
              ) : null}

              <View style={styles.fieldRow}>
                <View style={styles.flex1}>
                  <DatePicker
                    label={PROMOTION_LABELS.fieldStartDate}
                    value={startDate}
                    onChange={setStartDate}
                    required
                    error={errors.start_date}
                    disabled={isPending}
                  />
                </View>
                <View style={styles.flex1}>
                  <DatePicker
                    label={PROMOTION_LABELS.fieldEndDate}
                    value={endDate}
                    onChange={setEndDate}
                    disabled={isPending}
                  />
                </View>
              </View>

              <Input
                label={PROMOTION_LABELS.fieldMinPurchase}
                value={minPurchase}
                onChangeText={setMinPurchase}
                keyboardType="decimal-pad"
                editable={!isPending}
              />

              {type === 'percentage' ? (
                <Input
                  label={PROMOTION_LABELS.fieldMaxDiscount}
                  value={maxDiscount}
                  onChangeText={setMaxDiscount}
                  keyboardType="decimal-pad"
                  editable={!isPending}
                />
              ) : null}

              <View style={styles.fieldRow}>
                <View style={styles.flex1}>
                  <Input
                    label={PROMOTION_LABELS.fieldUsageLimit}
                    value={usageLimit}
                    onChangeText={setUsageLimit}
                    keyboardType="number-pad"
                    editable={!isPending}
                  />
                </View>
                <View style={styles.flex1}>
                  <Input
                    label={PROMOTION_LABELS.fieldPerCustomerLimit}
                    value={perCustomerLimit}
                    onChangeText={setPerCustomerLimit}
                    keyboardType="number-pad"
                    editable={!isPending}
                  />
                </View>
              </View>

              <Toggle
                value={isAutoApply}
                onChange={setIsAutoApply}
                label={PROMOTION_LABELS.fieldAutoApply}
                description="Se aplica sin necesidad de codigo"
                disabled={isPending}
              />

              <Input
                label={PROMOTION_LABELS.fieldPriority}
                value={priority}
                onChangeText={setPriority}
                keyboardType="number-pad"
                editable={!isPending}
              />
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <Button
                title={PROMOTION_LABELS.ctaCancel}
                variant="outline"
                onPress={handleClose}
                disabled={isPending}
                style={styles.footerButton}
              />
              <Button
                title={
                  isPending
                    ? isEdit
                      ? 'Guardando…'
                      : 'Creando…'
                    : isEdit
                      ? PROMOTION_LABELS.ctaSave
                      : PROMOTION_LABELS.ctaCreate
                }
                variant="primary"
                onPress={handleSubmit}
                loading={isPending}
                disabled={!isValid || isPending}
                style={styles.footerButton}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Recorta un ISO `2026-07-08T00:00:00.000Z` a `2026-07-08` para el input. */
function toDateInput(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Calcula errores cross-row del FormArray `quantity_tiers`.
 * Mismas reglas que `validateTiersOrder()` del web:
 * - Sólo la última fila puede dejar `max_quantity` vacío
 * - `tier[i].max + 1 === tier[i+1].min` (adyacencia contigua)
 *
 * Devuelve un array paralelo a `tiers` con un string por fila
 * (undefined = sin error).
 */
function computeTierRowErrors(tiers: QuantityTier[]): (string | undefined)[] {
  const errors: (string | undefined)[] = tiers.map(() => undefined);
  if (tiers.length === 0) return errors;

  // 1. Sólo la última puede estar abierta
  for (let i = 0; i < tiers.length - 1; i++) {
    if (tiers[i].max_quantity == null) {
      errors[i] = 'solo la ultima escala puede quedar sin maximo.';
    }
  }

  // 2. max >= min
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i];
    if (t.max_quantity != null && t.min_quantity != null && t.max_quantity < t.min_quantity) {
      errors[i] = 'maximo debe ser >= minimo.';
    }
  }

  // 3. Adyacencia contigua
  for (let i = 0; i < tiers.length - 1; i++) {
    const cur = tiers[i];
    const nxt = tiers[i + 1];
    if (cur.max_quantity == null || nxt.min_quantity == null) continue;
    if (cur.max_quantity + 1 !== nxt.min_quantity) {
      errors[i] = `el rango debe ser continuo (max ${cur.max_quantity} -> min ${nxt.min_quantity}).`;
    }
  }

  return errors;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  flex1: { flex: 1 },
  suffix: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
    justifyContent: 'flex-end',
  },
  footerButton: {
    minWidth: 120,
  },
  // Tiers (FormArray)
  tiersSection: {
    gap: spacing[3],
  },
  tiersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tiersTitle: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tiersHelp: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
  tiersError: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
  },
  tiersEmpty: {
    fontSize: typography.fontSize.sm,
    color: colors.text.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: spacing[3],
  },
  // Inline label para productos/categorías (cuando Input no es suficiente)
  fieldLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[1.5],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  required: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '700' as any,
  },
});
