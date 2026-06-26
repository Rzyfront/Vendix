import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService, ProductService } from '@/features/store/services';
import type {
  Brand,
  CreateProductDto,
  CreateProductVariantDto,
  Product,
  ProductCategory,
  ProductState,
  TaxCategory,
  UpdateProductDto,
} from '@/features/store/types';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { MultiSelector } from '@/shared/components/multi-selector/multi-selector';
import { Selector } from '@/shared/components/selector/selector';
import { InputButtons } from '@/shared/components/input-buttons/input-buttons';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { Textarea } from '@/shared/components/textarea/textarea';
import { Toggle } from '@/shared/components/toggle/toggle';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

type ProductMode = 'create' | 'edit';

interface VariantForm {
  localId: string;
  id?: number;
  sku: string;
  name: string;
  price_override: string;
  cost_price: string;
  profit_margin: string;
  is_on_sale: boolean;
  sale_price: string;
  stock_quantity: string;
}

interface ProductFormState {
  name: string;
  description: string;
  sku: string;
  slug: string;
  barcode: string;
  product_type: ProductType;
  pricing_type: PricingType;
  base_price: string;
  cost_price: string;
  profit_margin: string;
  is_on_sale: boolean;
  sale_price: string;
  stock_quantity: string;
  track_inventory: boolean;
  available_for_ecommerce: boolean;
  is_featured: boolean;
  allow_pos_price_override: boolean;
  state: ProductState;
  brand_id?: number;
  category_ids: number[];
  tax_category_ids: number[];
  has_variants: boolean;
  variants: VariantForm[];
  stock_by_location: Record<string, string>;
}

const initialForm: ProductFormState = {
  name: '',
  description: '',
  sku: '',
  slug: '',
  barcode: '',
  product_type: 'physical',
  pricing_type: 'unit',
  base_price: '',
  cost_price: '',
  profit_margin: '',
  is_on_sale: false,
  sale_price: '',
  stock_quantity: '',
  track_inventory: true,
  available_for_ecommerce: true,
  is_featured: false,
  allow_pos_price_override: false,
  state: 'active',
  brand_id: undefined,
  category_ids: [],
  tax_category_ids: [],
  has_variants: false,
  variants: [],
  stock_by_location: {},
};

function toNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function money(value?: number | null): string {
  return value == null ? '' : String(Number(value));
}

function createVariant(baseSku = ''): VariantForm {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    localId: `variant-${Date.now()}-${suffix}`,
    sku: baseSku ? `${baseSku}-${suffix}` : '',
    name: '',
    price_override: '',
    cost_price: '',
    profit_margin: '',
    is_on_sale: false,
    sale_price: '',
    stock_quantity: '0',
  };
}

function selectedVariant(hasValue: boolean): 'success' | 'default' {
  return hasValue ? 'success' : 'default';
}

interface ProductUpsertFormProps {
  mode: ProductMode;
  productId?: number;
}

export function ProductUpsertForm({ mode, productId }: ProductUpsertFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductFormState>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: product, isLoading: productLoading } = useQuery({
    queryKey: ['product', productId],
    queryFn: () => ProductService.getById(Number(productId)),
    enabled: mode === 'edit' && !!productId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['product-categories'],
    queryFn: () => ProductService.getCategories(),
  });

  const { data: brands = [] } = useQuery({
    queryKey: ['product-brands'],
    queryFn: () => ProductService.getBrands(),
  });

  const { data: taxes = [] } = useQuery({
    queryKey: ['product-taxes'],
    queryFn: () => ProductService.getTaxes(),
  });

  const { data: locationsResponse } = useQuery({
    queryKey: ['product-locations'],
    queryFn: () => InventoryService.getLocations({ limit: 100 }),
  });

  const locations = locationsResponse?.data ?? [];

  useEffect(() => {
    if (!product) return;
    const stockByLocation: Record<string, string> = {};
    ((product as Product & { stock_by_location?: { location_id: number; quantity: number }[] }).stock_by_location || []).forEach((stock) => {
      stockByLocation[String(stock.location_id)] = String(stock.quantity);
    });

    const ext = product as Product & {
      slug?: string;
      barcode?: string;
      product_type?: ProductType;
      pricing_type?: PricingType;
      is_featured?: boolean;
      allow_pos_price_override?: boolean;
    };

    setForm({
      name: product.name || '',
      description: product.description || '',
      sku: product.sku || '',
      slug: ext.slug || '',
      barcode: ext.barcode || '',
      product_type: ext.product_type || 'physical',
      pricing_type: ext.pricing_type || 'unit',
      base_price: money(product.base_price),
      cost_price: money(product.cost_price),
      profit_margin: money(product.profit_margin),
      is_on_sale: !!product.is_on_sale,
      sale_price: money(product.sale_price),
      stock_quantity: String(product.stock_quantity ?? 0),
      track_inventory: product.track_inventory !== false,
      available_for_ecommerce: product.available_for_ecommerce !== false,
      is_featured: !!ext.is_featured,
      allow_pos_price_override: !!ext.allow_pos_price_override,
      state: product.state,
      brand_id: product.brand_id ?? undefined,
      category_ids: product.categories?.map((category) => category.id) ?? [],
      tax_category_ids: product.tax_assignments?.map((assignment) => assignment.tax_category_id) ?? [],
      has_variants: (product.product_variants?.length ?? 0) > 0,
      variants: (product.product_variants || []).map((variant) => ({
        localId: `variant-${variant.id}`,
        id: variant.id,
        sku: variant.sku || '',
        name: variant.name || '',
        price_override: money(variant.price_override),
        cost_price: money(variant.cost_price),
        profit_margin: money(variant.profit_margin),
        is_on_sale: !!variant.is_on_sale,
        sale_price: money(variant.sale_price),
        stock_quantity: String(variant.stock_quantity ?? 0),
      })),
      stock_by_location: stockByLocation,
    });
  }, [product]);

  const finalPreview = useMemo(() => {
    const base = toNumber(form.base_price) || 0;
    const sale = form.is_on_sale ? toNumber(form.sale_price) : undefined;
    return sale && sale > 0 ? sale : base;
  }, [form.base_price, form.is_on_sale, form.sale_price]);

  const updateField = <K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updatePriceFromCostMargin = (costText: string, marginText: string) => {
    const cost = Number(costText);
    const margin = Number(marginText);
    if (!Number.isFinite(cost) || !Number.isFinite(margin) || cost <= 0) return;
    setForm((current) => ({ ...current, base_price: String(Math.round(cost * (1 + margin / 100))) }));
  };

  const updateMarginFromBase = (baseText: string, costText: string) => {
    const base = Number(baseText);
    const cost = Number(costText);
    if (!Number.isFinite(base) || !Number.isFinite(cost) || cost <= 0) return;
    setForm((current) => ({ ...current, profit_margin: String(Number((((base - cost) / cost) * 100).toFixed(2))) }));
  };

  const updateVariant = (localId: string, patch: Partial<VariantForm>) => {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant) => (variant.localId === localId ? { ...variant, ...patch } : variant)),
    }));
  };

  const addVariant = () => {
    setForm((current) => ({ ...current, has_variants: true, variants: [...current.variants, createVariant(current.sku)] }));
  };

  const removeVariant = (localId: string) => {
    setForm((current) => ({ ...current, variants: current.variants.filter((variant) => variant.localId !== localId) }));
  };

  const toggleNumber = (key: 'category_ids' | 'tax_category_ids', id: number) => {
    setForm((current) => {
      const exists = current[key].includes(id);
      return { ...current, [key]: exists ? current[key].filter((currentId) => currentId !== id) : [...current[key], id] };
    });
  };

  const validate = (): boolean => {
    const nextErrors: Record<string, string> = {};
    const base = toNumber(form.base_price);
    const sale = toNumber(form.sale_price);
    if (!form.name.trim()) nextErrors.name = 'El nombre es requerido';
    if (!base || base <= 0) nextErrors.base_price = 'Ingresa un precio base valido';
    if (form.is_on_sale && sale != null && base != null && sale >= base) nextErrors.sale_price = 'La oferta debe ser menor al precio base';
    if (form.has_variants) {
      const skus = form.variants.map((variant) => variant.sku.trim()).filter(Boolean);
      if (form.variants.length === 0) nextErrors.variants = 'Agrega al menos una variante';
      if (skus.length !== new Set(skus).size) nextErrors.variants = 'Los SKU de variantes no se pueden repetir';
      form.variants.forEach((variant, index) => {
        const variantPrice = toNumber(variant.price_override) ?? base ?? 0;
        const variantSale = toNumber(variant.sale_price);
        if (!variant.sku.trim()) nextErrors[`variant-${index}`] = 'Cada variante necesita SKU';
        if (variant.is_on_sale && variantSale != null && variantSale >= variantPrice) {
          nextErrors[`variant-${index}`] = 'La oferta de variante debe ser menor al precio';
        }
      });
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const buildDto = (): CreateProductDto | UpdateProductDto => {
    const stockByLocation = Object.entries(form.stock_by_location)
      .map(([locationId, quantity]) => ({ location_id: Number(locationId), quantity: Number(quantity) || 0 }))
      .filter((stock) => stock.quantity > 0);

    const variants: CreateProductVariantDto[] | undefined = form.has_variants
      ? form.variants.map((variant) => ({
          ...(variant.id ? { id: variant.id } : {}),
          sku: variant.sku.trim(),
          name: variant.name.trim() || undefined,
          price_override: toNumber(variant.price_override),
          cost_price: toNumber(variant.cost_price),
          profit_margin: toNumber(variant.profit_margin),
          is_on_sale: variant.is_on_sale,
          sale_price: variant.is_on_sale ? toNumber(variant.sale_price) : undefined,
          stock_quantity: toNumber(variant.stock_quantity) ?? 0,
          track_inventory_override: null,
        }))
      : undefined;

    // Base payload — fields safe in both create and update.
    const base = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      sku: form.sku.trim() || undefined,
      slug: form.slug.trim() || undefined,
      barcode: form.barcode.trim() || undefined,
      base_price: toNumber(form.base_price) || 0,
      cost_price: toNumber(form.cost_price),
      profit_margin: toNumber(form.profit_margin),
      is_on_sale: form.is_on_sale,
      sale_price: form.is_on_sale ? toNumber(form.sale_price) : undefined,
      stock_quantity: form.has_variants ? undefined : toNumber(form.stock_quantity),
      stock_by_location: !form.has_variants && stockByLocation.length > 0 ? stockByLocation : undefined,
      track_inventory: form.track_inventory,
      available_for_ecommerce: form.available_for_ecommerce,
      is_featured: form.is_featured,
      allow_pos_price_override: form.allow_pos_price_override,
      state: form.state,
      pricing_type: form.pricing_type,
      product_type: form.product_type,
      brand_id: form.brand_id ?? null,
      category_ids: form.category_ids,
      tax_category_ids: form.tax_category_ids,
      variants,
    };

    // Create-only fields (these are typically not allowed in PATCH on this backend).
    if (mode === 'create') {
      return {
        ...base,
        stock_transfer_mode: 'distribute',
        variant_removal_stock_mode: 'first',
      };
    }

    // Edit: only send what changed (partial update).
    return base;
  };

  const mutation = useMutation({
    mutationFn: (dto: CreateProductDto | UpdateProductDto) =>
      mode === 'edit' && productId ? ProductService.update(productId, dto) : ProductService.create(dto as CreateProductDto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['pos-products'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      if (productId) queryClient.invalidateQueries({ queryKey: ['product', productId] });
      toastSuccess(mode === 'edit' ? 'Producto actualizado' : 'Producto creado');
      router.back();
    },
    onError: (error: any) => {
      const msg =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        (error instanceof Error ? error.message : null) ||
        'Error al guardar producto';
      toastError(typeof msg === 'string' ? msg : 'Error al guardar producto');
    },
  });

  const submit = () => {
    if (!validate()) return;
    mutation.mutate(buildDto());
  };

  if (productLoading && mode === 'edit') {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header sticky — flecha + título + acciones iconos (X / +) */}
      <StickyHeader
        title={mode === 'edit' ? 'Editar Producto' : 'Nuevo Producto'}
        subtitle={undefined}
        showCloseButton={false}
        onBack={() => router.back()}
        actions={[
          { label: '', icon: 'x', variant: 'outline', onPress: () => router.back() },
          {
            label: '',
            icon: mode === 'edit' ? 'check' : 'plus',
            variant: 'primary',
            loading: mutation.isPending,
            onPress: submit,
          },
        ]}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {/* Tipo de Producto */}
          <Section title="Tipo de Producto" subtitle="Define si el producto es físico, un servicio o preparado" icon="package">
            <InputButtons
              value={form.product_type}
              onChange={(v) => updateField('product_type', v as ProductType)}
              fullWidth
              options={[
                { label: 'Físico', value: 'physical' },
                { label: 'Servicio', value: 'service' },
                { label: 'Preparado', value: 'prepared' },
              ]}
            />
          </Section>

          {/* Información General */}
          <Section title="Información General" subtitle="Datos visibles en punto de venta, catálogo e inventario" icon="info">
            <Input label="Nombre" value={form.name} onChangeText={(value) => updateField('name', value)} error={errors.name} />
            <Input
              label="SKU"
              value={form.sku}
              onChangeText={(value) => updateField('sku', value.toUpperCase())}
              autoCapitalize="characters"
            />
            <Input
              label="Código de barras"
              value={form.barcode}
              onChangeText={(value) => updateField('barcode', value)}
              placeholder="opcional"
            />
            <Input
              label="Slug (URL)"
              value={form.slug}
              onChangeText={(value) => updateField('slug', value)}
              placeholder="se genera automáticamente si lo dejás vacío"
              autoCapitalize="none"
            />
            <Textarea
              label="Descripción"
              value={form.description}
              onChangeText={(value) => updateField('description', value)}
              rows={3}
              maxLength={1000}
            />
          </Section>

          {/* Precios y Rentabilidad */}
          <Section title="Precios y Rentabilidad" subtitle={`Precio final estimado ${formatCurrency(finalPreview)}`} icon="dollar-sign">
            <Input
              label="Costo"
              value={form.cost_price}
              onChangeText={(value) => {
                updateField('cost_price', value);
                updatePriceFromCostMargin(value, form.profit_margin);
              }}
              keyboardType="decimal-pad"
            />
            <Input
              label="Margen %"
              value={form.profit_margin}
              onChangeText={(value) => {
                updateField('profit_margin', value);
                updatePriceFromCostMargin(form.cost_price, value);
              }}
              keyboardType="decimal-pad"
            />
            <Input
              label="Precio base"
              value={form.base_price}
              onChangeText={(value) => {
                updateField('base_price', value);
                updateMarginFromBase(value, form.cost_price);
              }}
              keyboardType="decimal-pad"
              error={errors.base_price}
            />
            <Selector
              label="Unidad de venta"
              value={form.pricing_type}
              onChange={(v) => updateField('pricing_type', v as PricingType)}
              options={[
                { label: 'Venta por unidad', value: 'unit' },
                { label: 'Venta por peso (kg)', value: 'weight' },
              ]}
            />
            {taxes.length > 0 && (
              <MultiSelector
                label="Impuestos (IVA)"
                values={form.tax_category_ids}
                onChange={(v) => updateField('tax_category_ids', v)}
                options={((taxes as TaxCategory[]) || []).map((t) => ({ label: t.name, value: t.id }))}
                placeholder="Seleccionar impuestos"
              />
            )}

            {/* Espacio destacado del Precio final + formula */}
            <View
              style={{
                backgroundColor: colors.primaryLight,
                borderColor: colors.primary,
                borderWidth: 1.5,
                borderRadius: borderRadius.lg,
                padding: spacing[4],
                gap: spacing[1],
                marginTop: spacing[1],
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '700',
                  color: colors.text.secondary,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                Precio final estimado
              </Text>
              <Text
                style={{
                  fontSize: 28,
                  fontWeight: '800',
                  color: colors.text.primary,
                }}
              >
                {formatCurrency(finalPreview)}
              </Text>
              <Text
                style={{
                  fontSize: typography.fontSize.xs,
                  color: colors.text.secondary,
                  marginTop: spacing[1],
                }}
              >
                {`${formatCurrency(toNumber(form.cost_price) || 0)} × (1 + ${form.profit_margin || '0'}%) = ${formatCurrency(finalPreview)}`}
              </Text>
            </View>
            <View style={{ height: spacing[2] }} />
            <Toggle
              value={form.is_on_sale}
              onChange={(v) => updateField('is_on_sale', v)}
              label="Activar precio de oferta"
              description="Mostrar precio tachado y activar precio promocional."
            />
            {form.is_on_sale && (
              <Input
                label="Precio de oferta"
                value={form.sale_price}
                onChangeText={(value) => updateField('sale_price', value)}
                keyboardType="decimal-pad"
                error={errors.sale_price}
                helperText="Debe ser menor al precio base"
              />
            )}
          </Section>

          {/* Imágenes del Producto (placeholder) */}
          <Section title="Imágenes del Producto" subtitle="Gestioná las imágenes desde la versión web" icon="image">
            <View
              style={{
                height: 120,
                borderRadius: borderRadius.md,
                borderWidth: 1,
                borderColor: colorScales.gray[200],
                borderStyle: 'dashed',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colorScales.gray[50],
              }}
            >
              <Icon name="image-plus" size={28} color={colors.text.muted} />
              <Text style={{ fontSize: typography.fontSize.sm, color: colors.text.muted, marginTop: spacing[1] }}>
                Subí imágenes desde la versión web
              </Text>
            </View>
          </Section>

          <Section title="Inventario" subtitle="Stock inicial y visibilidad comercial" icon="warehouse">
            <Toggle
              value={form.track_inventory}
              onChange={(v) => updateField('track_inventory', v)}
              label="Controlar inventario"
              description="Llevar conteo de unidades disponibles por bodega."
            />
            <Toggle
              value={form.available_for_ecommerce}
              onChange={(v) => updateField('available_for_ecommerce', v)}
              label="Disponible en ecommerce"
              description="Mostrar este producto en la tienda online."
            />
            {!form.has_variants && form.track_inventory && (
              <>
                <Input label="Stock inicial" value={form.stock_quantity} onChangeText={(value) => updateField('stock_quantity', value)} keyboardType="number-pad" />
                {locations.length > 0 && (
                  <View style={styles.locationStock}>
                    <Text style={styles.blockLabel}>Stock por bodega</Text>
                    {locations.map((location) => (
                      <View key={location.id} style={styles.locationRow}>
                        <View style={styles.locationName}>
                          <Text style={styles.locationTitle}>{location.name}</Text>
                          <Text style={styles.locationSubtitle}>{location.code || location.type}</Text>
                        </View>
                        <Input
                          label="Cantidad"
                          value={form.stock_by_location[String(location.id)] || ''}
                          onChangeText={(value) => setForm((current) => ({
                            ...current,
                            stock_by_location: { ...current.stock_by_location, [String(location.id)]: value },
                          }))}
                          keyboardType="number-pad"
                          style={styles.locationInput}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </Section>

          {/* Disponibilidad y Estado */}
          <Section title="Disponibilidad y Estado" subtitle="Configurá la visibilidad y el estado del producto" icon="eye">
            <InputButtons
              label="Estado"
              value={form.state}
              onChange={(v) => updateField('state', v as ProductState)}
              fullWidth
              options={[
                { label: 'Activo', value: 'active' },
                { label: 'Inactivo', value: 'inactive' },
                { label: 'Archivado', value: 'archived' },
              ]}
            />
            <View style={{ height: spacing[2] }} />
            <Toggle
              value={form.is_featured}
              onChange={(v) => updateField('is_featured', v)}
              label="Producto destacado"
              description="Mostrar este producto con prioridad en listados."
            />
            <Toggle
              value={form.allow_pos_price_override}
              onChange={(v) => updateField('allow_pos_price_override', v)}
              label="Permitir cambio de precio en POS"
              description="El cajero puede ajustar el precio al cobrar."
            />
          </Section>

          <Section title="Clasificación" subtitle="Categorías, marca e impuestos" icon="tag">
            <Selector
              label="Marca"
              value={form.brand_id}
              onChange={(v) => updateField('brand_id', v as number)}
              options={[
                { label: 'Sin marca', value: undefined as any },
                ...((brands as Brand[]) || []).map((b) => ({ label: b.name, value: b.id })),
              ]}
              placeholder="Seleccionar marca"
            />
            <MultiSelector
              label="Categorías"
              values={form.category_ids}
              onChange={(v) => updateField('category_ids', v)}
              options={((categories as ProductCategory[]) || []).map((c) => ({ label: c.name, value: c.id }))}
              placeholder="Seleccionar categorías"
            />
            <MultiSelector
              label="Impuestos"
              values={form.tax_category_ids}
              onChange={(v) => updateField('tax_category_ids', v)}
              options={((taxes as TaxCategory[]) || []).map((t) => ({ label: t.name, value: t.id }))}
              placeholder="Seleccionar impuestos"
            />
          </Section>

          <Section title="Variantes" subtitle="Opciones vendibles del producto" icon="list">
            <Toggle
              value={form.has_variants}
              onChange={(v) => updateField('has_variants', v)}
              label="Producto con variantes"
              description="Activá si el producto tiene tallas, colores u otras opciones."
            />
            {errors.variants && <Text style={styles.errorText}>{errors.variants}</Text>}
            {form.has_variants && (
              <View style={styles.variantList}>
                {form.variants.map((variant, index) => (
                  <View key={variant.localId} style={styles.variantCard}>
                    <View style={styles.variantHeader}>
                      <Text style={styles.variantTitle}>Variante {index + 1}</Text>
                      <Pressable onPress={() => removeVariant(variant.localId)} hitSlop={8}>
                        <Icon name="trash-2" size={16} color={colors.error} />
                      </Pressable>
                    </View>
                    {errors[`variant-${index}`] && <Text style={styles.errorText}>{errors[`variant-${index}`]}</Text>}
                    <Input label="Nombre" value={variant.name} onChangeText={(value) => updateVariant(variant.localId, { name: value })} />
                    <Input label="SKU" value={variant.sku} onChangeText={(value) => updateVariant(variant.localId, { sku: value.toUpperCase() })} autoCapitalize="characters" />
                    <Input label="Precio propio" value={variant.price_override} onChangeText={(value) => updateVariant(variant.localId, { price_override: value })} keyboardType="decimal-pad" />
                    <Input label="Costo" value={variant.cost_price} onChangeText={(value) => updateVariant(variant.localId, { cost_price: value })} keyboardType="decimal-pad" />
                    <Input label="Stock" value={variant.stock_quantity} onChangeText={(value) => updateVariant(variant.localId, { stock_quantity: value })} keyboardType="number-pad" />
                    <Toggle
                      value={variant.is_on_sale}
                      onChange={(v) => updateVariant(variant.localId, { is_on_sale: v })}
                      label="Variante en oferta"
                    />
                    {variant.is_on_sale && (
                      <Input label="Precio oferta variante" value={variant.sale_price} onChangeText={(value) => updateVariant(variant.localId, { sale_price: value })} keyboardType="decimal-pad" />
                    )}
                  </View>
                ))}
                <Button title="Agregar variante" variant="outline" onPress={addVariant} leftIcon={<Icon name="plus" size={16} color={colors.primary} />} fullWidth />
              </View>
            )}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Section({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: string; children: React.ReactNode }) {
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderRow}>
          {icon && (
            <View style={styles.sectionIcon}>
              <Icon name={icon} size={16} color={colorScales.gray[500]} />
            </View>
          )}
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  );
}

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.blockLabel}>{label}</Text>
      <View style={styles.chipRow}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onPress}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.toggleTrack, value && styles.toggleTrackActive]}>
        <View style={[styles.toggleThumb, value && styles.toggleThumbActive]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  flex: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colorScales.gray[50] },
  content: { paddingHorizontal: spacing[3], paddingTop: spacing[3], paddingBottom: 100, gap: spacing[2] },
  section: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  sectionHeader: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  sectionTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  sectionSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 4 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  sectionIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  sectionBody: { padding: spacing[5], gap: spacing[4] },
  chipBlock: { gap: spacing[2] },
  blockLabel: { fontSize: typography.fontSize.xs, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase', letterSpacing: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  toggleRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colorScales.gray[100], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], backgroundColor: colorScales.gray[50] },
  toggleLabel: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[800] },
  toggleTrack: { width: 44, height: 26, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[300], justifyContent: 'center', paddingHorizontal: 3 },
  toggleTrackActive: { backgroundColor: colors.primary },
  toggleThumb: { width: 20, height: 20, borderRadius: borderRadius.full, backgroundColor: colors.background },
  toggleThumbActive: { alignSelf: 'flex-end' },
  locationStock: { gap: spacing[3] },
  locationRow: { flexDirection: 'row', gap: spacing[3], alignItems: 'center' },
  locationName: { flex: 1 },
  locationTitle: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[900] },
  locationSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  locationInput: { width: 120 },
  variantList: { gap: spacing[4] },
  variantCard: { borderWidth: 1, borderColor: colorScales.gray[100], borderRadius: borderRadius.xl, padding: spacing[3], gap: spacing[3], backgroundColor: colorScales.gray[50] },
  variantHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  variantTitle: { fontSize: typography.fontSize.base, fontWeight: '800' as any, color: colorScales.gray[900] },
  errorText: { color: colors.error, fontSize: typography.fontSize.xs, fontWeight: '600' as any },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing[3], padding: spacing[4], backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colorScales.gray[200], ...shadows.lg },
  footerButton: { flex: 1 },
});
