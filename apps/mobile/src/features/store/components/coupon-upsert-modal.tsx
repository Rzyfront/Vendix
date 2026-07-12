/**
 * CuponUpsertModal — Create/Edit modal para Cupones.
 *
 * Réplica EXACTA del web `coupon-modal.component.ts` con centered-card
 * anatomy (Web Visual Pattern):
 * - backdrop rgba(15,23,42,0.45), fade animation, centered card maxWidth=480
 * - Header: title + close X button
 * - Body: 15 fields en grid, conditional product_ids / category_ids multi-selectors
 * - Footer: Cancelar (outline) + Crear Cupon / Guardar cambios (primary)
 *
 * No usa el shared Modal full-screen — replica el centered card de PromotionUpsertModal.
 */
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Input,
  Selector,
  Textarea,
  Button,
  Toggle,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { MultiSelector } from '@/shared/components/multi-selector/multi-selector';
import { DatePicker } from '@/shared/components/date-picker/date-picker';
import { CouponsService } from '@/features/store/services/coupons.service';
import { ProductService } from '@/features/store/services/product.service';
import { CategoryService } from '@/features/store/services/category.service';
import type {
  Coupon,
  CreateCouponDto,
  UpdateCouponDto,
  DiscountType,
  AppliesTo,
} from '@/features/store/types/coupon.types';
import type { Product } from '@/features/store/types/product.types';
import type { ProductCategory } from '@/features/store/types';
import {
  COUPON_LABELS,
  generateCouponCode,
  toDateInput,
} from '@/features/store/constants/coupon-labels';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

// ─── Constants ───────────────────────────────────────────────────────────────

const CARD_MAX_WIDTH = 480;

const DISCOUNT_TYPE_OPTIONS = [
  { value: 'PERCENTAGE', label: COUPON_LABELS.optionPercentage },
  { value: 'FIXED_AMOUNT', label: COUPON_LABELS.optionFixedAmount },
];

const APPLIES_TO_OPTIONS = [
  { value: 'ALL_PRODUCTS', label: COUPON_LABELS.optionAllProducts },
  { value: 'SPECIFIC_PRODUCTS', label: COUPON_LABELS.optionSpecificProducts },
  { value: 'SPECIFIC_CATEGORIES', label: COUPON_LABELS.optionSpecificCategories },
];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CuponUpsertModalProps {
  visible: boolean;
  /** `null` = crear nuevo. Objeto = editar existente. */
  coupon: Coupon | null;
  onClose: () => void;
  /** Notifica al padre con el mensaje del backend para toast success. */
  onSaved?: (message: string | undefined) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CuponUpsertModal({
  visible,
  coupon,
  onClose,
  onSaved,
}: CuponUpsertModalProps) {
  const queryClient = useQueryClient();
  const isEdit = coupon !== null;

  // ── Form state ────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('ALL_PRODUCTS');
  const [productIds, setProductIds] = useState<number[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [validFrom, setValidFrom] = useState<string | null>(null);
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [minPurchase, setMinPurchase] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [maxUsesPerCustomer, setMaxUsesPerCustomer] = useState('1');
  const [isActive, setIsActive] = useState(true);

  // ── Errors ─────────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  // ── Load products + categories ─────────────────────────────────────────
  const { data: productsData } = useQuery({
    queryKey: ['products-for-coupon'],
    queryFn: () => ProductService.list({ limit: 500, state: 'active' }),
    enabled: true,
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories-for-coupon'],
    queryFn: () => CategoryService.getAllActive(),
    enabled: true,
  });

  const productOptions = useMemo(() => {
    return (
      productsData?.data?.map((p: Product) => ({
        value: p.id,
        label: p.name,
        description: p.sku,
      })) ?? []
    );
  }, [productsData]);

  const categoryOptions = useMemo(() => {
    return (
      categoriesData?.map((c: ProductCategory) => ({
        value: c.id,
        label: c.name,
      })) ?? []
    );
  }, [categoriesData]);

  // ── Hydrate from coupon on open ─────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    if (coupon) {
      setCode(coupon.code ?? '');
      setName(coupon.name ?? '');
      setDescription(coupon.description ?? '');
      setDiscountType(coupon.discount_type ?? 'PERCENTAGE');
      setDiscountValue(
        coupon.discount_value != null ? String(coupon.discount_value) : '',
      );
      setAppliesTo(coupon.applies_to ?? 'ALL_PRODUCTS');
      setProductIds(
        coupon.coupon_products?.map((cp) => cp.product_id ?? cp.product?.id).filter(Boolean) ?? [],
      );
      setCategoryIds(
        coupon.coupon_categories?.map((cc) => cc.category_id ?? cc.category?.id).filter(Boolean) ?? [],
      );
      setValidFrom(toDateInput(coupon.valid_from));
      setValidUntil(toDateInput(coupon.valid_until));
      setMinPurchase(
        coupon.min_purchase_amount != null ? String(coupon.min_purchase_amount) : '',
      );
      setMaxDiscount(
        coupon.max_discount_amount != null ? String(coupon.max_discount_amount) : '',
      );
      setMaxUses(coupon.max_uses != null ? String(coupon.max_uses) : '');
      setMaxUsesPerCustomer(
        coupon.max_uses_per_customer != null ? String(coupon.max_uses_per_customer) : '1',
      );
      setIsActive(coupon.is_active ?? true);
    } else {
      resetForm();
    }
    setErrors({});
  }, [visible, coupon]);

  function resetForm() {
    setCode('');
    setName('');
    setDescription('');
    setDiscountType('PERCENTAGE');
    setDiscountValue('');
    setAppliesTo('ALL_PRODUCTS');
    setProductIds([]);
    setCategoryIds([]);
    setValidFrom(null);
    setValidUntil(null);
    setMinPurchase('');
    setMaxDiscount('');
    setMaxUses('');
    setMaxUsesPerCustomer('1');
    setIsActive(true);
    setErrors({});
  }

  // ── Validation ─────────────────────────────────────────────────────────
  const isValid = useMemo(() => {
    if (!code.trim() || code.trim().length < 3) return false;
    if (!name.trim() || name.trim().length < 2) return false;
    const numValue = Number(discountValue);
    if (!discountValue || isNaN(numValue) || numValue <= 0) return false;
    if (discountType === 'PERCENTAGE' && numValue > 100) return false;
    if (!validFrom) return false;
    if (!validUntil) return false;
    if (appliesTo === 'SPECIFIC_PRODUCTS' && productIds.length === 0) return false;
    if (appliesTo === 'SPECIFIC_CATEGORIES' && categoryIds.length === 0) return false;
    return true;
  }, [
    code,
    name,
    discountValue,
    discountType,
    validFrom,
    validUntil,
    appliesTo,
    productIds,
    categoryIds,
  ]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (dto: CreateCouponDto) => CouponsService.create(dto),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Cupón creado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['coupons'] });
      queryClient.invalidateQueries({ queryKey: ['coupon-stats'] });
      onSaved?.(res?.message);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message || err?.message || 'Error al crear el cupón';
      toastError(msg);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateCouponDto }) =>
      CouponsService.update(id, dto),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Cupón actualizado exitosamente');
      queryClient.invalidateQueries({ queryKey: ['coupons'] });
      queryClient.invalidateQueries({ queryKey: ['coupon-stats'] });
      onSaved?.(res?.message);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message || err?.message || 'Error al actualizar el cupón';
      toastError(msg);
    },
  });

  const mutation = isEdit ? updateMutation : createMutation;
  const isPending = mutation.isPending;

  // ── Handlers ───────────────────────────────────────────────────────────
  function handleClose() {
    if (isPending) return;
    resetForm();
    onClose();
  }

  function handleGenerateCode() {
    setCode(generateCouponCode());
  }

  function handleSubmit() {
    const newErrors: Record<string, string | undefined> = {};

    if (!code.trim() || code.trim().length < 3)
      newErrors.code = COUPON_LABELS.errCodeMinLength;
    if (!name.trim() || name.trim().length < 2)
      newErrors.name = COUPON_LABELS.errNameMinLength;

    const numValue = Number(discountValue);
    if (!discountValue || isNaN(numValue) || numValue <= 0)
      newErrors.discountValue = COUPON_LABELS.errValueRequired;
    else if (discountType === 'PERCENTAGE' && numValue > 100)
      newErrors.discountValue = 'Debe ser menor o igual a 100';

    if (!validFrom) newErrors.validFrom = COUPON_LABELS.errValidFromRequired;
    if (!validUntil) newErrors.validUntil = COUPON_LABELS.errValidUntilRequired;

    if (appliesTo === 'SPECIFIC_PRODUCTS' && productIds.length === 0)
      newErrors.productIds = COUPON_LABELS.errProductsRequired;
    if (appliesTo === 'SPECIFIC_CATEGORIES' && categoryIds.length === 0)
      newErrors.categoryIds = COUPON_LABELS.errCategoriesRequired;

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const dto: CreateCouponDto = {
      code: code.trim().toUpperCase(),
      name: name.trim(),
      discount_type: discountType,
      discount_value: Number(discountValue),
      valid_from: validFrom!,
      valid_until: validUntil!,
      is_active: isActive,
      applies_to: appliesTo,
    };

    if (description.trim()) dto.description = description.trim();
    if (minPurchase) dto.min_purchase_amount = Number(minPurchase);
    if (maxDiscount) dto.max_discount_amount = Number(maxDiscount);
    if (maxUses) dto.max_uses = Number(maxUses);
    if (maxUsesPerCustomer && maxUsesPerCustomer !== '1')
      dto.max_uses_per_customer = Number(maxUsesPerCustomer);
    if (appliesTo === 'SPECIFIC_PRODUCTS' && productIds.length > 0)
      dto.product_ids = productIds;
    if (appliesTo === 'SPECIFIC_CATEGORIES' && categoryIds.length > 0)
      dto.category_ids = categoryIds;

    if (isEdit && coupon) {
      updateMutation.mutate({ id: coupon.id, dto });
    } else {
      createMutation.mutate(dto);
    }
  }

  function handleAppliesToChange(value: AppliesTo) {
    setAppliesTo(value);
    if (value !== 'SPECIFIC_PRODUCTS') setProductIds([]);
    if (value !== 'SPECIFIC_CATEGORIES') setCategoryIds([]);
  }

  // ── Render ─────────────────────────────────────────────────────────────
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
                  {isEdit ? 'Editar Cupon' : 'Crear Cupon'}
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
              {/* Code + Name row */}
              <View style={styles.row}>
                <View style={styles.codeWrap}>
                  <Input
                    label={COUPON_LABELS.fieldCode}
                    value={code}
                    onChangeText={(t) => setCode(t.toUpperCase())}
                    placeholder={COUPON_LABELS.placeholderCode}
                    required
                    maxLength={50}
                    error={errors.code}
                    editable={!isPending}
                    suffix={
                      <Pressable onPress={handleGenerateCode} hitSlop={4}>
                        <Icon name="refresh-cw" size={14} color={colorScales.gray[500]} />
                      </Pressable>
                    }
                  />
                </View>
                <View style={styles.nameWrap}>
                  <Input
                    label={COUPON_LABELS.fieldName}
                    value={name}
                    onChangeText={setName}
                    placeholder={COUPON_LABELS.placeholderName}
                    required
                    maxLength={255}
                    error={errors.name}
                    editable={!isPending}
                  />
                </View>
              </View>

              {/* Description */}
              <Textarea
                label={COUPON_LABELS.fieldDescription}
                value={description}
                onChangeText={setDescription}
                placeholder={COUPON_LABELS.placeholderDescription}
                rows={2}
                maxLength={500}
                editable={!isPending}
              />

              {/* Discount type + value + applies_to */}
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Selector
                    label={COUPON_LABELS.fieldDiscountType}
                    value={discountType}
                    onChange={(v) => setDiscountType(v as DiscountType)}
                    options={DISCOUNT_TYPE_OPTIONS}
                    required
                    disabled={isPending}
                  />
                </View>
                <View style={styles.flex1}>
                  <Input
                    label={COUPON_LABELS.fieldValue}
                    value={discountValue}
                    onChangeText={setDiscountValue}
                    keyboardType="decimal-pad"
                    required
                    error={errors.discountValue}
                    editable={!isPending}
                    suffix={
                      <Text style={styles.suffix}>
                        {discountType === 'PERCENTAGE' ? '%' : '$'}
                      </Text>
                    }
                  />
                </View>
                <View style={styles.flex1}>
                  <Selector
                    label={COUPON_LABELS.fieldAppliesTo}
                    value={appliesTo}
                    onChange={(v) => handleAppliesToChange(v as AppliesTo)}
                    options={APPLIES_TO_OPTIONS}
                    disabled={isPending}
                  />
                </View>
              </View>

              {/* Product / Category selectors (conditional) */}
              {appliesTo === 'SPECIFIC_PRODUCTS' && (
                <MultiSelector
                  label={COUPON_LABELS.fieldProducts}
                  values={productIds}
                  onChange={setProductIds}
                  options={productOptions}
                  placeholder={COUPON_LABELS.placeholderProducts}
                />
              )}

              {appliesTo === 'SPECIFIC_CATEGORIES' && (
                <MultiSelector
                  label={COUPON_LABELS.fieldCategories}
                  values={categoryIds}
                  onChange={setCategoryIds}
                  options={categoryOptions}
                  placeholder={COUPON_LABELS.placeholderCategories}
                />
              )}

              {/* Date range */}
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <DatePicker
                    label={COUPON_LABELS.fieldValidFrom}
                    value={validFrom}
                    onChange={setValidFrom}
                    required
                    error={errors.validFrom}
                    disabled={isPending}
                  />
                </View>
                <View style={styles.flex1}>
                  <DatePicker
                    label={COUPON_LABELS.fieldValidUntil}
                    value={validUntil}
                    onChange={setValidUntil}
                    required
                    error={errors.validUntil}
                    disabled={isPending}
                  />
                </View>
              </View>

              {/* Min purchase + Max discount */}
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Input
                    label={COUPON_LABELS.fieldMinPurchase}
                    value={minPurchase}
                    onChangeText={setMinPurchase}
                    keyboardType="decimal-pad"
                    placeholder={COUPON_LABELS.placeholderMinPurchase}
                    editable={!isPending}
                    prefix="$"
                  />
                </View>
                <View style={styles.flex1}>
                  <Input
                    label={COUPON_LABELS.fieldMaxDiscount}
                    value={maxDiscount}
                    onChangeText={setMaxDiscount}
                    keyboardType="decimal-pad"
                    placeholder={COUPON_LABELS.placeholderMaxDiscount}
                    editable={!isPending}
                    prefix="$"
                  />
                </View>
              </View>

              {/* Usage limits */}
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <Input
                    label={COUPON_LABELS.fieldUsageLimit}
                    value={maxUses}
                    onChangeText={setMaxUses}
                    keyboardType="number-pad"
                    placeholder={COUPON_LABELS.placeholderUsageLimit}
                    editable={!isPending}
                  />
                </View>
                <View style={styles.flex1}>
                  <Input
                    label={COUPON_LABELS.fieldPerCustomerLimit}
                    value={maxUsesPerCustomer}
                    onChangeText={setMaxUsesPerCustomer}
                    keyboardType="number-pad"
                    placeholder={COUPON_LABELS.placeholderPerCustomerLimit}
                    editable={!isPending}
                  />
                </View>
              </View>

              {/* Active toggle */}
              <Toggle
                label={COUPON_LABELS.fieldIsActive}
                description="Disponible para uso inmediato"
                value={isActive}
                onChange={setIsActive}
                disabled={isPending}
              />
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <Button
                title={COUPON_LABELS.ctaCancel}
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
                      ? COUPON_LABELS.ctaSave
                      : COUPON_LABELS.ctaCreate
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

// ─── Styles ─────────────────────────────────────────────────────────────────

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
  row: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  codeWrap: {
    width: 120,
  },
  nameWrap: {
    flex: 1,
  },
  flex1: {
    flex: 1,
  },
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
});
