import { Fragment, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService, ProductService } from '@/features/store/services';
import type {
  Brand,
  CreateProductDto,
  CreateProductVariantDto,
  PricingType,
  Product,
  ProductCategory,
  ProductState,
  ProductType,
  TaxCategory,
  UpdateProductDto,
} from '@/features/store/types';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { MoneyInput } from '@/shared/components/money-input/money-input';
import { MultiSelector } from '@/shared/components/multi-selector/multi-selector';
import { Selector } from '@/shared/components/selector/selector';
import { InputButtons } from '@/shared/components/input-buttons/input-buttons';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { Textarea } from '@/shared/components/textarea/textarea';
import { TaxCreateModal } from '@/features/store/components/tax-create-modal';
import { ImageSourceModal, type UploadedImage } from '@/features/store/components/image-source-modal';
import { ImageEditModal } from '@/features/store/components/image-edit-modal';
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
  // Precios multi-tarifa
  has_multiple_price_tiers?: boolean;
  // Dimensiones y peso
  length?: string;
  width?: string;
  height?: string;
  weight_input?: string;
  // Otras configuraciones (mirror web)
  requires_serial_numbers?: boolean;
  preparation_time_minutes?: string;
  // Servicio
  service_duration_minutes?: string;
  service_modality?: string;
  service_pricing_type?: string;
  requires_booking?: boolean;
  is_recurring?: boolean;
  // Compra online (solo edit)
  online_purchase_url?: string;
}

/**
 * Single resolved tax line shown in the pricing breakdown sub-card.
 * Mirrors the web's `taxBreakdown`: one row per selected tax category,
 * using the category's first `tax_rates[0].rate` (matches `app-input` parity).
 */
interface TaxBreakdownItem {
  id: number;
  name: string;
  /** Decimal rate, e.g. 0.19 for 19% */
  rate: number;
  /** base_price * rate */
  amount: number;
}

/**
 * Variable labels for the pricing fields. The web version swaps "Costo" →
 * "Costo por kg" and "Precio base" → "Precio por kg (PVP)" when
 * `pricing_type === 'weight'`.
 */
const PRICING_LABELS: Record<PricingType, { cost: string; base: string; type: string }> = {
  unit: { cost: 'Precio de Costo', base: 'Precio Base (PVP)', type: 'Tipo de Venta' },
  weight: { cost: 'Costo por kg', base: 'Precio por kg (PVP)', type: 'Tipo de Venta' },
};

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
  has_multiple_price_tiers: false,
  length: '',
  width: '',
  height: '',
  weight_input: '',
  requires_serial_numbers: false,
  preparation_time_minutes: '',
  service_duration_minutes: '',
  service_modality: '',
  service_pricing_type: '',
  requires_booking: false,
  is_recurring: false,
  online_purchase_url: '',
};

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
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
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [localTaxes, setLocalTaxes] = useState<TaxCategory[]>([]);
  const [imageSourceOpen, setImageSourceOpen] = useState(false);
  const [imageEditorUri, setImageEditorUri] = useState<string | null>(null);
  const [productImages, setProductImages] = useState<string[]>([]);

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

  const allTaxes = useMemo(() => {
    const apiTaxes = (taxes as TaxCategory[]) || [];
    if (localTaxes.length === 0) return apiTaxes;
    const existingIds = new Set(apiTaxes.map(t => t.id));
    return [...apiTaxes, ...localTaxes.filter(t => !existingIds.has(t.id))];
  }, [taxes, localTaxes]);

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
      tax_category_ids: product.product_tax_assignments?.map((assignment) => assignment.tax_category_id) ?? [],
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

    // Cargar imágenes existentes del producto (si las hay).
    // El backend devuelve `product_images` con `url` por registro.
    const existingImages = (product.product_images || [])
      .map((img) => img.url)
      .filter((url): url is string => Boolean(url));
    if (existingImages.length > 0) {
      setProductImages(existingImages);
    } else {
      setProductImages([]);
    }
  }, [product]);

  const finalPreview = useMemo(() => {
    const base = toNumber(form.base_price) || 0;
    const sale = form.is_on_sale ? toNumber(form.sale_price) : undefined;
    return sale && sale > 0 ? sale : base;
  }, [form.base_price, form.is_on_sale, form.sale_price]);

  /**
   * Tax categories the user has selected for this product. Mirrors the web's
   * `taxBreakdown` aggregation: one row per selected tax_category_id, using
   * the category's first `tax_rates[0].rate`.
   */
  const selectedTaxes = useMemo<TaxCategory[]>(() => {
    const ids = new Set(form.tax_category_ids);
    return allTaxes.filter((tax) => ids.has(tax.id));
  }, [form.tax_category_ids, allTaxes]);

  const taxBreakdown = useMemo<TaxBreakdownItem[]>(() => {
    const base = toNumber(form.base_price) || 0;
    return selectedTaxes
      .map((tax) => {
        const rawRate = tax.tax_rates?.[0]?.rate;
        const numericRate = typeof rawRate === 'number' ? rawRate : Number(rawRate) || 0;
        if (numericRate === 0) return null;
        return { id: tax.id, name: tax.name, rate: numericRate, amount: base * numericRate };
      })
      .filter((item): item is TaxBreakdownItem => item !== null);
  }, [selectedTaxes, form.base_price]);

  /** base + Σ(tax.amount) — the value the customer actually pays. */
  const priceWithTax = useMemo(() => {
    const base = toNumber(form.base_price) || 0;
    const taxSum = taxBreakdown.reduce((sum, tax) => sum + tax.amount, 0);
    return base + taxSum;
  }, [form.base_price, taxBreakdown]);

  /**
   * Display value for the Section subtitle and "Precio Final" block: when the
   * product is on sale we show the offer price; otherwise the tax-inclusive
   * base price. Mirrors `priceWithTax` on the web.
   */
  const finalDisplayPrice = useMemo(() => {
    const sale = form.is_on_sale ? toNumber(form.sale_price) : undefined;
    return sale && sale > 0 ? sale : priceWithTax;
  }, [form.is_on_sale, form.sale_price, priceWithTax]);

  /**
   * Suma del stock físico y disponible para la sección "Inventario / Stock".
   * Si el producto no tiene variantes, viene de stock_quantity + stock_by_location.
   * Si tiene variantes, el stock se calcula por variante (no mostrado en este nivel).
   */
  const { totalStock, availableStock } = useMemo(() => {
    if (form.has_variants) {
      return { totalStock: 0, availableStock: 0 };
    }
    const initial = toNumber(form.stock_quantity) || 0;
    const fromLocations = Object.values(form.stock_by_location).reduce(
      (sum, raw) => sum + (Number(raw) || 0),
      0,
    );
    const total = initial + fromLocations;
    return { totalStock: total, availableStock: total };
  }, [form.has_variants, form.stock_quantity, form.stock_by_location]);

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
    // Importante: el backend usa class-validator con `@IsInt()` que rechaza `null`
    // (solo acepta `number | undefined`). Por eso enviamos `undefined` cuando no hay valor.
    //
    // SLUG: el DTO requiere `@MinLength(2)` cuando se proporciona. Si el usuario
    // escribió 1 caracter o nada, lo omitimos para que el backend auto-genere uno.
    const trimmedSlug = form.slug.trim();
    const finalSlug = trimmedSlug.length >= 2 ? trimmedSlug : undefined;

    const base = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      sku: form.sku.trim() || undefined,
      slug: finalSlug,
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
      has_multiple_price_tiers: form.has_multiple_price_tiers,
      requires_serial_numbers: form.requires_serial_numbers,
      state: form.state,
      pricing_type: form.pricing_type,
      product_type: form.product_type,
      brand_id: form.brand_id,
      category_ids: form.category_ids.length > 0 ? form.category_ids : undefined,
      tax_category_ids: form.tax_category_ids.length > 0 ? form.tax_category_ids : undefined,
      // Imágenes del producto. En create enviamos las URIs locales que
      // el backend descarga y guarda. En update las enviamos como
      // image_urls (el backend reconcilia con product_images existentes).
      image_urls: productImages.length > 0 ? productImages : undefined,
      variants,
    };

    // Dimensiones + peso (mirror del web; sólo si hay valor).
    const numericLength = toNumber(form.length);
    const numericWidth = toNumber(form.width);
    const numericHeight = toNumber(form.height);
    if (numericLength !== undefined || numericWidth !== undefined || numericHeight !== undefined) {
      (base as any).dimensions = {
        length: numericLength ?? 0,
        width: numericWidth ?? 0,
        height: numericHeight ?? 0,
      };
    }
    const numericWeight = toNumber(form.weight_input);
    if (numericWeight !== undefined) {
      (base as any).weight = numericWeight;
    }
    const preparationTime = toNumber(form.preparation_time_minutes);
    if (preparationTime !== undefined) {
      (base as any).preparation_time_minutes = preparationTime;
    }

    // Create-only fields: sólo válidos en UpdateProductDto. NO los enviamos
    // en create porque el `forbidNonWhitelisted: true` del ValidationPipe
    // rechazaría la request con "property X should not exist".
    if (mode === 'create') {
      return base;
    }

    // Edit: incluir campos sólo presentes en UpdateProductDto.
    const update: UpdateProductDto = { ...base };
    if (form.stock_quantity !== undefined && !form.has_variants) {
      (update as any).stock_transfer_mode = 'distribute';
      (update as any).variant_removal_stock_mode = 'first';
    }
    return update;
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
      const data = error?.response?.data;
      // El AllExceptionsFilter del backend mete los constraints de class-validator
      // en `data.details.validationErrors` y reemplaza `data.message` por un
      // string genérico "Validation failed". Extraemos los constraints reales.
      const validationErrors = data?.details?.validationErrors;
      if (Array.isArray(validationErrors) && validationErrors.length > 0) {
        toastError(validationErrors.join(' • '));
        return;
      }
      // Fallback: leer data.message (puede ser string o array de otros errores).
      const detail = Array.isArray(data?.message)
        ? data.message.join(' • ')
        : data?.message;
      const msg =
        detail ||
        data?.error ||
        (error instanceof Error ? error.message : null) ||
        'Error al guardar producto';
      toastError(typeof msg === 'string' ? msg : 'Error al guardar producto');
    },
  });

  /**
   * Mutación para generar descripción con IA (mirror del botón 'Generar con IA' web).
   * Llama al backend POST /store/products/generate-description y rellena el Textarea.
   *
   * Detección de safety: el proveedor de IA (Vertex AI / OpenAI) puede devolver
   * un placeholder como 'User safety:safe' cuando el filtro de contenido bloquea
   * la generación. Tratamos este caso como error y mostramos un mensaje claro.
   */
  const aiMutation = useMutation({
    mutationFn: (payload: { name: string; sku?: string; category_id?: number | null; brand_id?: number | null }) =>
      ProductService.generateDescription(payload),
    onSuccess: (result) => {
      const text = result.description?.trim();
      const isSafetyPlaceholder =
        !text || /safety|safe content/i.test(text) || text.toLowerCase() === 'user safety:safe';
      if (isSafetyPlaceholder) {
        toastError('La IA no pudo generar una descripción (filtro de seguridad del proveedor). Edita manualmente.');
        return;
      }
      setForm((current) => ({ ...current, description: text }));
      toastSuccess('Descripción generada con IA');
    },
    onError: (error: any) => {
      // Muestra el mensaje exacto del backend. Si es un validation error array, lo detalla.
      const data = error?.response?.data;
      const detail = Array.isArray(data?.message)
        ? data.message.join(', ')
        : data?.message;
      const msg =
        detail ||
        error?.message ||
        'No se pudo generar la descripción. Verifica que el backend soporte este endpoint.';
      toastError(msg);
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
          {/* Tipo de Producto (espejo exacto del web:
              - ícono layers + título (sin subtitle)
              - segmented control con 2 opciones: Producto Físico | Servicio
          */}
          <Section title="Tipo de Producto" icon="layers">
            <InputButtons
              value={form.product_type}
              onChange={(v) => updateField('product_type', v as ProductType)}
              fullWidth
              options={[
                { label: 'Producto Físico', value: 'physical' },
                { label: 'Servicio', value: 'service' },
              ]}
            />
          </Section>

          {/* Información General (espejo exacto del web) */}
          <Section title="Información General" icon="info">
            {/* Nombre del Producto (full-width, required, con clipboard icon suffix) */}
            <Input
              label="Nombre del Producto"
              value={form.name}
              onChangeText={(value) => updateField('name', value)}
              placeholder="Ej. Camiseta Algodón Premium"
              required
              tooltip="Nombre visible del producto en catálogo, facturas y buscador. Sé descriptivo y consistente."
              error={errors.name}
              rightIcon={
                <Pressable
                  onPress={() => {
                    // El web permite pegar al portapapeles para autocompletar el nombre.
                    // En mobile esto requeriría expo-clipboard; placeholder visual.
                    toastSuccess('Pega el nombre desde el portapapeles');
                  }}
                  hitSlop={6}
                >
                  <Icon name="clipboard-list" size={16} color={colors.text.muted} />
                </Pressable>
              }
            />

            {/* SKU / Código de barras / Slug en grid 3 cols en sm+ */}
            <View style={styles.infoGrid}>
              <Input
                label="SKU"
                value={form.sku}
                onChangeText={(value) => updateField('sku', value.toUpperCase())}
                placeholder="Ej. CAM-001"
                tooltip="Código interno único del producto. Útil para inventario, etiquetas y búsqueda rápida en POS."
                autoCapitalize="characters"
              />
              <Input
                label="Código de barras"
                value={form.barcode}
                onChangeText={(value) => updateField('barcode', value)}
                placeholder="Escanea o escribe el código"
                tooltip="Código escaneable (EAN/UPC) único en la tienda."
              />
              <Input
                label="Slug (URL)"
                value={form.slug}
                onChangeText={(value) => updateField('slug', value)}
                placeholder="camiseta-algodon-premium"
                tooltip="Identificador para la URL pública del producto. Se genera automáticamente desde el nombre."
                autoCapitalize="none"
              />
            </View>

            {/* Descripción con botón 'Generar con IA' (espejo del web ai-generate-btn)
                El botón llama al backend de IA (POST /store/products/generate-description).
                Muestra tooltip "Generar con IA" al hover/press y rellena el Textarea. */}
            <View style={styles.descriptionHeader}>
              <Text style={styles.descriptionLabel}>Descripción</Text>
              <Pressable
                onPress={() => {
                  if (!form.name.trim()) {
                    toastError('Ingresa primero el nombre del producto');
                    return;
                  }
                  // Construye el payload sólo con campos con valor (undefined los omite del body,
                  // evitando que el backend rechace por nulls opcionales).
                  const payload: Parameters<typeof ProductService.generateDescription>[0] = {
                    name: form.name.trim(),
                  };
                  const trimmedSku = form.sku.trim();
                  if (trimmedSku) payload.sku = trimmedSku;
                  if (form.category_ids[0]) payload.category_id = form.category_ids[0];
                  if (form.brand_id) payload.brand_id = form.brand_id;
                  aiMutation.mutate(payload);
                }}
                disabled={aiMutation.isPending || !form.name.trim()}
                style={({ pressed }) => [
                  styles.aiGenerateBtn,
                  pressed && !aiMutation.isPending && { opacity: 0.85 },
                ]}
              >
                {aiMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <>
                    <Icon name="sparkles" size={11} color={colors.background} />
                    <Text style={styles.aiGenerateText}>IA</Text>
                  </>
                )}
              </Pressable>
            </View>
            <Textarea
              label=""
              value={form.description}
              onChangeText={(value) => updateField('description', value)}
              placeholder="Describe tu producto..."
              rows={3}
              maxLength={1000}
            />
          </Section>

          {/* Precios y Rentabilidad (espejo exacto del web)
              - Inputs con prefix "$" (Costo, Precio Base) y suffix "%" (Margen)
              - Tooltips en cada input/selector (mirror web tooltiptext)
              - Precio Base con asterisco rojo (required)
              - Impuestos Aplicables + botón + (mb-[26px] del web) con label del MultiSelector
          */}
          <Section title="Precios y Rentabilidad" icon="dollar-sign" iconColor={colors.primary}>
            <View style={styles.pricingRow}>
              <MoneyInput
                label={PRICING_LABELS[form.pricing_type].cost}
                value={form.cost_price}
                onChangeText={(value) => {
                  updateField('cost_price', value);
                  updatePriceFromCostMargin(value, form.profit_margin);
                }}
                prefix="$"
                placeholder="0"
                tooltip="Precio al que adquieres el producto. Se usa para calcular la rentabilidad."
              />
              <Input
                label="Margen (%)"
                value={form.profit_margin}
                onChangeText={(value) => {
                  updateField('profit_margin', value);
                  updatePriceFromCostMargin(form.cost_price, value);
                }}
                keyboardType="decimal-pad"
                suffix="%"
                placeholder="0.00"
                tooltip="Porcentaje de ganancia deseado sobre el costo. Ajusta automáticamente el precio base."
              />
              <MoneyInput
                label={PRICING_LABELS[form.pricing_type].base}
                value={form.base_price}
                onChangeText={(value) => {
                  updateField('base_price', value);
                  updateMarginFromBase(value, form.cost_price);
                }}
                error={errors.base_price}
                placeholder="0"
                prefix="$"
                tooltip="Precio de venta antes de impuestos. Se calcula automáticamente si defines costo + margen."
                required
              />
            </View>
            <Selector
              label={PRICING_LABELS[form.pricing_type].type}
              value={form.pricing_type}
              onChange={(v) => updateField('pricing_type', v as PricingType)}
              options={[
                { label: 'Venta por unidad', value: 'unit' },
                { label: 'Venta por peso (kg)', value: 'weight' },
              ]}
              tooltip="Define si el producto se vende por unidad o por peso (kg). Afecta cómo se interpretan los precios."
            />

            {/* Impuestos Aplicables + botón + para creación rápida (mirror web
                `flex gap-2 items-end h-full md:col-span-2` + `button mb-[26px]`).
                El MultiSelector pone su propio label 'Impuestos Aplicables' con tooltip.
                El `marginTop` del botón + compensa el alto del label del MultiSelector
                para alinear verticalmente con el input. */}
            <View style={{ flexDirection: 'row', gap: spacing[2] }}>
              <View style={{ flex: 1 }}>
                <MultiSelector
                  label="Impuestos Aplicables"
                  values={form.tax_category_ids}
                  onChange={(v) => updateField('tax_category_ids', v)}
                  options={allTaxes.map((t) => {
                    const rate = t.tax_rates?.[0]?.rate;
                    const labelText = typeof rate === 'number' ? `${t.name} (${(rate * 100).toFixed(0)}%)` : t.name;
                    return { label: labelText, subLabel: t.name, value: t.id };
                  })}
                  placeholder="Seleccionar impuestos…"
                  searchable
                  searchPlaceholder="Buscar impuesto…"
                  tooltip="Impuestos que se suman al precio base en facturación y checkout (IVA, INC, retenciones)."
                />
              </View>
              <Pressable
                onPress={() => setTaxModalOpen(true)}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.taxAddButton,
                  styles.taxAddButtonAligned, // ← alinea con el input (no el label)
                  pressed && styles.taxAddButtonPressed,
                ]}
              >
                <Icon name="plus" size={20} color={colors.primary} />
              </Pressable>
            </View>

            {/* Sub-card con desglose estructurado del precio (espejo de la versión web mobile) */}
            <View style={styles.pricingBreakdownCard}>
              {/* Fila 1: Fórmula de cálculo (gris) */}
              <View style={styles.formulaRow}>
                <Text style={styles.formulaValue}>{formatCurrency(toNumber(form.cost_price) || 0)}</Text>
                <Text style={styles.formulaHint}>(Costo)</Text>
                <Text style={styles.formulaOp}>×</Text>
                <Text style={styles.formulaHint}>(1 + {Number(form.profit_margin || 0).toFixed(1)}%)</Text>
                <Text style={styles.formulaOp}>=</Text>
                <Text style={styles.formulaValue}>{formatCurrency(toNumber(form.base_price) || 0)}</Text>
                <Text style={styles.formulaHint}>(PVP)</Text>

                {taxBreakdown.map((tax) => (
                  <Fragment key={tax.id}>
                    <Text style={styles.formulaOp}>+</Text>
                    <Text style={styles.formulaHint}>{(tax.rate * 100).toFixed(1)}% {tax.name}</Text>
                    <Text style={styles.formulaAmount}>({formatCurrency(tax.amount)})</Text>
                  </Fragment>
                ))}

                <Text style={styles.formulaOp}>=</Text>
                <Text style={styles.formulaFinal}>{formatCurrency(priceWithTax)}</Text>
              </View>

              {/* Fila 2: Precio Final + wrapper "setting-toggle-row" del web */}
              <View style={styles.finalPriceRow}>
                <View style={styles.finalPriceCol}>
                  <Text style={styles.finalLabel}>PRECIO FINAL</Text>
                  <Text style={[styles.finalAmount, form.is_on_sale && styles.finalAmountStrike]}>
                    {formatCurrency(priceWithTax)}
                  </Text>
                </View>

                {/* Wrapper del toggle (espejo del `setting-toggle-row` web:
                    bg-gray-50 + border-gray-100 + rounded-xl + p-2 + mt-3) */}
                <View style={styles.settingToggleRow}>
                  <Toggle
                    value={form.is_on_sale}
                    onChange={(v) => updateField('is_on_sale', v)}
                    label="Activar precio de oferta"
                    description="Se mostrará como precio promocional"
                  />
                </View>
              </View>

              {/* Fila 3: Sub-sección rose para precio de oferta (solo si is_on_sale) */}
              {form.is_on_sale && (
                <View style={styles.saleRow}>
                  <Icon name="flame" size={18} color={colorScales.red[500]} />
                  <View style={styles.saleCol}>
                    <Text style={styles.saleLabel}>PRECIO DE OFERTA</Text>
                    <Input
                      tone="rose"
                      value={form.sale_price}
                      onChangeText={(value) => updateField('sale_price', value)}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      error={errors.sale_price}
                    />
                  </View>
                </View>
              )}
            </View>
          </Section>

          {/* Imágenes del Producto (espejo exacto del web mobile lg:hidden):
              - Header sin subtitle, con counter "0/5" a la derecha (slot `right`)
              - Placeholder cuadrado aspect-square max-w-280, mx-auto, con ícono circular bg-white
              - Botón secundario 64x64 dashed + ícono image-plus + label "Agregar"
          */}
          <Section
            title="Imágenes del Producto"
            icon="image"
            right={
              <Text style={styles.imageCount}>{productImages.length}/5</Text>
            }
          >
            <View style={styles.imageMainWrapper}>
              {productImages.length > 0 ? (
                <Pressable
                  onPress={() => setImageSourceOpen(true)}
                  style={({ pressed }) => [
                    styles.imageMainFilled,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Image
                    source={{ uri: productImages[0] }}
                    style={styles.imageMainImg}
                    resizeMode="cover"
                  />

                  {/* Botón "Mejorar imagen con IA" (web: bottom-2 left-2 + gradient green + sparkles + 'IA') */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      toastSuccess('Mejorar imagen con IA (próximamente)');
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.imageMainAiBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityLabel="Mejorar imagen con IA"
                  >
                    <Icon name="sparkles" size={12} color={colors.background} />
                    <Text style={styles.imageMainAiBtnText}>IA</Text>
                  </Pressable>

                  {/* Botón "Ajustar y recortar" (web: bottom-2 right-2 + white + crop icon + 'Ajustar') */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setImageEditorUri(productImages[0]);
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.imageMainCropBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityLabel="Ajustar y recortar imagen"
                  >
                    <Icon name="crop" size={14} color={colorScales.gray[700]} />
                    <Text style={styles.imageMainCropBtnText}>Ajustar</Text>
                  </Pressable>

                  {/* Botón Eliminar (mirror web: top-2 right-2 absolute + red-500/90 + trash-2) */}
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation();
                      setProductImages((prev) => prev.filter((_, i) => i !== 0));
                    }}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.imageMainDelete,
                      pressed && { backgroundColor: 'rgba(220, 38, 38, 1)' },
                    ]}
                    accessibilityLabel="Eliminar imagen"
                  >
                    <Icon name="trash-2" size={14} color={colors.background} />
                  </Pressable>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => setImageSourceOpen(true)}
                  style={({ pressed }) => [
                    styles.imageMainPlaceholder,
                    pressed && { borderColor: colors.primary },
                  ]}
                >
                  <View style={styles.imageMainCircle}>
                    <Icon name="image" size={24} color={colors.text.muted} style={{ opacity: 0.2 }} />
                  </View>
                  <Text style={styles.imageMainText}>Sin imágenes</Text>
                  <Text style={styles.imageMainHint}>Toca para agregar</Text>
                </Pressable>
              )}
            </View>
            <View style={styles.imageThumbsRow}>
              {productImages.map((uri, index) => (
                <Pressable
                  key={`${uri}-${index}`}
                  onPress={() => {
                    // Quitar imagen con tap
                    setProductImages((prev) => prev.filter((_, i) => i !== index));
                  }}
                  style={styles.imageThumb}
                >
                  <Image
                    source={{ uri }}
                    style={styles.imageThumbImg}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
              {productImages.length < 5 && (
                <Pressable
                  onPress={() => setImageSourceOpen(true)}
                  style={({ pressed }) => [
                    styles.imageThumbAdd,
                    pressed && {
                      backgroundColor: colors.card,
                      borderColor: colors.primary,
                      opacity: 0.7,
                    },
                  ]}
                >
                  <Icon name="image-plus" size={20} color={colors.text.muted} />
                  <Text style={styles.imageThumbAddText}>Agregar</Text>
                </Pressable>
              )}
            </View>
          </Section>

          <ImageSourceModal
            visible={imageSourceOpen && imageEditorUri === null}
            onClose={() => setImageSourceOpen(false)}
            remainingSlots={Math.max(0, 5 - productImages.length)}
            onConfirm={(image: UploadedImage) => {
              setImageEditorUri(image.uri);
              setImageSourceOpen(false);
            }}
          />

          <ImageEditModal
            visible={imageEditorUri !== null}
            imageUri={imageEditorUri}
            onClose={() => setImageEditorUri(null)}
            onApply={(result) => {
              setProductImages((prev) => {
                if (prev.length >= 5) {
                  toastError('Máximo 5 imágenes por producto');
                  return prev;
                }
                return [...prev, result.uri];
              });
              toastSuccess('Imagen agregada');
              setImageEditorUri(null);
            }}
          />

          {/* Precios Multi-Tarifa (espejo exacto del web: header simple + setting-toggle-row) */}
          <Section title="Precios Multi-Tarifa" icon="tags">
            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.has_multiple_price_tiers}
                onChange={(v) => updateField('has_multiple_price_tiers', v)}
                label="Activar precios multi-tarifa"
                description="Define precios distintos para tarifas como Mayorista, Distribuidor, VIP, etc. La tarifa por defecto usa el precio base."
              />
            </View>
          </Section>

          {/* Inventario / Stock (espejo exacto del web lg:hidden)
              Header: icon archive + h2 'Inventario / Stock' (sin subtitle)
              Stats: 2 cards (Físico / Disponible) con label uppercase 9px + valor text-lg bold
              Acción: button 'Inventario' con cart icon (placeholder hasta integración inventario)
          */}
          <Section title="Inventario / Stock" icon="archive">
            <View style={styles.inventoryStatsGrid}>
              <View style={styles.inventoryStatCard}>
                <Text style={styles.inventoryStatLabel}>Físico</Text>
                <Text style={styles.inventoryStatValue}>{totalStock.toLocaleString('es-CO')}</Text>
              </View>
              <View style={styles.inventoryStatCard}>
                <Text style={styles.inventoryStatLabel}>Disponible</Text>
                <Text style={[styles.inventoryStatValue, styles.inventoryStatValuePrimary]}>
                  {availableStock.toLocaleString('es-CO')}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => {
                // Gestión detallada de inventario desde un modal dedicado.
                // El inventario por bodega/seriales requiere UI especializada
                // que se desarrolla en PR futuro.
                toastSuccess('Gestión de inventario próximamente');
              }}
              style={({ pressed }) => [
                styles.inventoryActionButton,
                pressed && { backgroundColor: 'rgba(126, 215, 165, 0.12)' },
              ]}
            >
              <Icon name="cart" size={14} color={colors.primary} />
              <Text style={styles.inventoryActionText}>Inventario</Text>
            </Pressable>
          </Section>

          {/* Disponibilidad y Estado (espejo exacto del web)
              - Header: icon check-circle + h2 (sin subtitle)
              - Estado segmented (Activo/Inactivo/Archivado)
              - 3 toggles en columna derecha: Disponible E-commerce, Producto destacado,
                Precio editable en POS
              - Toggle 'Este producto tiene variantes' + helper amber
              - Toggle 'Controlar inventario'
              - Toggle 'Requerir número de serie'
          */}
          <Section title="Disponibilidad y Estado" icon="check-circle">
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

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.available_for_ecommerce}
                onChange={(v) => updateField('available_for_ecommerce', v)}
                label="Disponible en E-commerce"
                description="Visible en tu tienda online"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.is_featured}
                onChange={(v) => updateField('is_featured', v)}
                label="Producto destacado"
                description="Aparece en la sección de destacados de la tienda online"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.allow_pos_price_override}
                onChange={(v) => updateField('allow_pos_price_override', v)}
                label="Precio editable en POS"
                description="Permite que usuarios autorizados vendan este producto con precio negociado"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.has_variants}
                onChange={(v) => updateField('has_variants', v)}
                label="Este producto tiene variantes"
                description="Agrega opciones como tamaño, color o material"
              />
              {form.has_variants && (
                <View style={styles.helperAmber}>
                  <Icon name="alert-triangle" size={10} color="#d97706" />
                  <Text style={{ fontSize: 10, color: '#d97706' }}>Configura un SKU para habilitar variantes</Text>
                </View>
              )}
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.track_inventory}
                onChange={(v) => updateField('track_inventory', v)}
                label="Controlar inventario"
                description="Se controla el stock de este producto"
              />
            </View>

            <View style={styles.settingToggleRow}>
              <Toggle
                value={!!form.requires_serial_numbers}
                onChange={(v) => updateField('requires_serial_numbers', v)}
                label="Requerir número de serie"
                description="Cada unidad vendida deberá tener un número de serie único (garantía, postventa, trazabilidad)."
              />
            </View>
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
              options={allTaxes.map((t) => ({ label: t.name, value: t.id }))}
              placeholder="Seleccionar impuestos"
            />

            {/* Dimensiones y Peso (espejo del bloque 'Dimensiones y Peso' del web)
                Header con ícono + título, grid 2x2 en mobile (4 cols en md+). */}
            <View style={styles.dimensionsHeader}>
              <Icon name="package" size={typography.fontSize.base} color={colors.primary} />
              <Text style={styles.dimensionsTitle}>Dimensiones y Peso</Text>
            </View>
            <View style={styles.dimensionsGrid}>
              <View style={styles.dimensionCell}>
                <Input
                  label="Largo (cm)"
                  value={form.length || ''}
                  onChangeText={(value) => updateField('length', value)}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.dimensionCell}>
                <Input
                  label="Ancho (cm)"
                  value={form.width || ''}
                  onChangeText={(value) => updateField('width', value)}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.dimensionCell}>
                <Input
                  label="Alto (cm)"
                  value={form.height || ''}
                  onChangeText={(value) => updateField('height', value)}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.dimensionCell}>
                <Input
                  label="Peso (kg)"
                  value={form.weight_input || ''}
                  onChangeText={(value) => updateField('weight_input', value)}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </Section>

          {/* Detalles del Servicio (solo cuando product_type === 'service') */}
          {form.product_type === 'service' && (
            <Section title="Detalles del Servicio" subtitle="Configuración específica para servicios" icon="clock">
              <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="Duración (minutos)"
                    value={form.service_duration_minutes}
                    onChangeText={(value) => updateField('service_duration_minutes', value)}
                    placeholder="Ej. 60"
                    keyboardType="number-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Selector
                    label="Modalidad"
                    value={form.service_modality}
                    onChange={(v) => updateField('service_modality', v as string)}
                    options={[
                      { label: 'Presencial', value: 'in_person' },
                      { label: 'Virtual', value: 'virtual' },
                      { label: 'Híbrido', value: 'hybrid' },
                    ]}
                  />
                </View>
              </View>
              <Selector
                label="Tipo de precio"
                value={form.service_pricing_type}
                onChange={(v) => updateField('service_pricing_type', v as string)}
                options={[
                  { label: 'Por hora', value: 'per_hour' },
                  { label: 'Por sesión', value: 'per_session' },
                  { label: 'Por paquete', value: 'package' },
                  { label: 'Suscripción', value: 'subscription' },
                ]}
              />
              <Toggle
                value={form.requires_booking ?? false}
                onChange={(v) => updateField('requires_booking', v)}
                label="Requiere reserva"
                description="El cliente debe reservar un turno antes de recibir el servicio."
              />
              {form.requires_booking && (
                <Toggle
                  value={form.is_recurring ?? false}
                  onChange={(v) => updateField('is_recurring', v)}
                  label="Es recurrente"
                  description="El cliente puede agendar múltiples turnos."
                />
              )}
            </Section>
          )}

          {/* Compra online (solo en edit) */}
          {mode === 'edit' && product && (
            <Section title="Compra Online" subtitle="Link público para vender este producto en la tienda online" icon="globe">
              <Input
                label="URL de compra online"
                value={form.online_purchase_url}
                onChangeText={(value) => updateField('online_purchase_url', value)}
                placeholder="Se genera automáticamente al activar la venta online"
                helperText={form.online_purchase_url ? 'Compartí este link con tus clientes para que compren online.' : 'Activá la venta online desde la web para generar el link.'}
              />
              {form.online_purchase_url ? (
                <View style={{ flexDirection: 'row', gap: spacing[2] }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Copiar link"
                      variant="outline"
                      leftIcon={<Icon name="copy" size={16} color={colors.text.primary} />}
                      onPress={() => {
                        // Copy to clipboard would require expo-clipboard
                        toastSuccess('Link copiado al portapapeles');
                      }}
                      fullWidth
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Ver tienda"
                      variant="primary"
                      leftIcon={<Icon name="external-link" size={16} color={colors.background} />}
                      onPress={() => {
                        // Linking.openURL would open the URL
                        toastSuccess('Abriendo tienda...');
                      }}
                      fullWidth
                    />
                  </View>
                </View>
              ) : null}
            </Section>
          )}

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

      <TaxCreateModal
        visible={taxModalOpen}
        onClose={() => setTaxModalOpen(false)}
        onCreated={(tax) => {
          if (tax?.id) {
            setForm((current) => ({ ...current, tax_category_ids: [...current.tax_category_ids, tax.id] }));
            setLocalTaxes((current) => [...current, tax]);
          }
        }}
      />
    </View>
  );
}

function Section({
  title,
  subtitle,
  icon,
  iconColor,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  /**
   * Slot opcional a la derecha del título en el header. Útil para
   * contadores (ej. "0/5" en Imágenes) o acciones rápidas.
   */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderRow}>
          {icon && (
            <View style={styles.sectionIcon}>
              <Icon name={icon} size={16} color={iconColor ?? colorScales.gray[500]} />
            </View>
          )}
          <Text style={styles.sectionTitle}>{title}</Text>
          {right && <View style={styles.sectionHeaderRight}>{right}</View>}
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
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  sectionIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderRight: { marginLeft: 'auto' },
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

  // ── Pricing breakdown sub-card (espejo de la versión web mobile) ──────
  pricingBreakdownCard: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  // Fila 1: chips de fórmula con tokens y operadores, fondo gris-50
  formulaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    columnGap: spacing[2],
    rowGap: spacing[1],
  },
  formulaValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  formulaHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  formulaOp: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as any,
    color: colorScales.gray[300],
  },
  formulaAmount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  formulaFinal: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    color: colors.primary,
  },
  // Fila 2: Precio Final + Toggle oferta
  // Mirror del web `bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3`.
  // En mobile (que es el caso de esta app) siempre es column: "Precio Final" arriba,
  // "Activar oferta" abajo (envuelto en `setting-toggle-row`).
  finalPriceRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    backgroundColor: colors.card,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  finalPriceCol: {
    gap: spacing[0.5],
  },
  finalLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[400],
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  finalAmount: {
    fontSize: 24,
    fontWeight: '900' as any,
    lineHeight: 28,
    color: colors.primary,
  },
  finalAmountStrike: {
    color: colorScales.gray[300],
    textDecorationLine: 'line-through',
  },
  // Wrapper del Toggle (espejo del `setting-toggle-row` web:
  // bg-gray-50 border border-gray-100 rounded-xl p-2 mt-3, con selector toggle adentro).
  settingToggleRow: {
    marginTop: spacing[3],
    padding: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  // Fila 3: Sub-sección rose para precio de oferta
  saleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.red[200],
    backgroundColor: colorScales.red[50],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  saleCol: {
    flex: 1,
    gap: spacing[1.5],
  },
  saleLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.red[600],
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // ── Tax chip list (espejo del MultiSelector, pero siempre visible) ───
  taxChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  taxChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  taxChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  taxChipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[700],
  },
  taxChipTextSelected: {
    color: colorScales.green[700],
  },
  taxChipAdd: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    borderStyle: 'dashed',
  },
  // Botón + que abre TaxCreateModal (espejo del `btn-outline-border` web)
  taxAddButton: {
    width: 42,
    height: 42,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.5)',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxAddButtonAligned: {
    // El MultiSelector tiene un label arriba que ocupa ~22px (lineHeight 1.5
    // × fontSize 10 + marginBottom 1.5×6 = 9px). El web usa `mb-[26px]`
    // en el botón + para alinear con el input. Acá replicamos ese offset.
    marginTop: 22,
  },
  taxAddButtonPressed: {
    backgroundColor: 'rgba(126, 215, 165, 0.06)',
    transform: [{ scale: 0.97 }],
  },
  // Lista inline de impuestos disponibles (espejo de la fila del popover).
  // Cada fila es un botón full-width con checkbox + label + sub-label.
  taxOptionList: {
    marginTop: spacing[2],
    gap: spacing[2],
  },
  taxOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  taxOptionRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  taxOptionRowPressed: {
    backgroundColor: colorScales.gray[50],
  },
  taxOptionCheckbox: {
    width: 16,
    height: 16,
    borderRadius: borderRadius.sm,
    borderWidth: 1.5,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taxOptionCheckboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  taxOptionLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  taxOptionSubLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    maxWidth: '40%',
    flexShrink: 0,
  },
  // Empty state cuando el tenant aún no tiene impuestos configurados.
  taxOptionEmpty: {
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colorScales.gray[300],
    backgroundColor: colorScales.gray[50],
  },
  taxOptionEmptyTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colors.text.primary,
    textAlign: 'center',
  },
  taxOptionEmptyHint: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  // Header del bloque 'Dimensiones y Peso' dentro de Clasificación.
  dimensionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  dimensionsTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  // Grid 2 cols en mobile (4 cols en md+).
  dimensionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    rowGap: spacing[3],
  },
  dimensionCell: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  // Grid 1 col en mobile, 3 cols en sm+ para SKU/Barcode/Slug.
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    rowGap: spacing[3],
  },
  // Wrapper de los 3 inputs de precio (Costo / Margen / Precio Base).
  // En mobile sigue siendo 1 col (stacked), pero el flex-row deja
  // preparado el cambio a 3 cols en pantallas más grandes.
  pricingRow: {
    flexDirection: 'column',
    gap: spacing[4],
  },
  // Header de la sección Descripción (label a la izquierda + botón IA a la derecha).
  descriptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[1],
  },
  descriptionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as any,
    color: colors.text.secondary,
  },
  // Botón 'Generar con IA' (espejo simplificado del ai-generate-btn web).
  // Web tiene animación shimmer compleja; aquí se hace una versión estática
  // con los mismos colores (verde + texto blanco, borde verde semitransparente).
  aiGenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.4)',
    backgroundColor: colors.primary,
  },
  aiGenerateText: {
    fontSize: 8,
    fontWeight: '700' as any,
    color: colors.background,
    marginLeft: spacing[1],
  },
  // Helper amber (mirror web `.text-amber-600 .flex .gap-1`).
  helperAmber: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[1],
    marginTop: spacing[1],
  },

  // ── Imágenes del Producto (espejo web lg:hidden) ──────────────────────────
  imageCount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  imageMainPlaceholder: {
    width: '100%',
    maxWidth: 280,
    aspectRatio: 1,
    alignSelf: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[4],
  },
  imageMainWrapper: {
    alignItems: 'center',
  },
  imageMainFilled: {
    width: '100%',
    maxWidth: 280,
    aspectRatio: 1,
    alignSelf: 'center',
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    position: 'relative',
  },
  imageMainImg: {
    width: '100%',
    height: '100%',
  },
  imageMainDelete: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    padding: 6,
    backgroundColor: 'rgba(220, 38, 38, 0.9)',
    borderRadius: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageMainAiBtn: {
    position: 'absolute',
    bottom: spacing[2],
    left: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.35)',
    backgroundColor: 'rgba(126, 215, 165, 0.9)',
    shadowColor: '#7ED7A5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  imageMainAiBtnText: {
    fontSize: 11,
    fontWeight: '700' as any,
    lineHeight: 12,
    color: colors.background,
  },
  imageMainCropBtn: {
    position: 'absolute',
    bottom: spacing[2],
    right: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  imageMainCropBtnText: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  imageMainCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
    marginBottom: spacing[2],
  },
  imageMainText: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500' as any,
    color: colorScales.gray[600],
  },
  imageMainHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[400],
  },
  imageThumbsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingBottom: spacing[2],
  },
  imageThumbAdd: {
    flexShrink: 0,
    width: 64,
    height: 64,
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing[0.5],
  },
  imageThumbAddText: {
    fontSize: 9,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  imageThumb: {
    flexShrink: 0,
    width: 64,
    height: 64,
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    overflow: 'hidden',
    position: 'relative',
  },
  imageThumbImg: {
    width: '100%',
    height: '100%',
  },
  imageThumbText: {
    fontSize: 9,
    color: colors.primary,
    fontWeight: '600' as any,
    marginTop: 2,
    maxWidth: 56,
  },

  // ── Inventario / Stock (espejo web lg:hidden) ────────────────────────────
  inventoryStatsGrid: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  inventoryStatCard: {
    flex: 1,
    padding: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  inventoryStatLabel: {
    fontSize: 9,
    color: colors.text.muted,
    fontWeight: '700' as any,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[1],
  },
  inventoryStatValue: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '700' as any,
    color: colors.text.primary,
  },
  inventoryStatValuePrimary: {
    color: colors.primary,
  },
  inventoryActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(126, 215, 165, 0.3)',
  },
  inventoryActionText: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700' as any,
    color: colorScales.green[700],
  },
});
