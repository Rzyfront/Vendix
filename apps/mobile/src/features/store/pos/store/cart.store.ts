import { create } from 'zustand';
import type {
  CartItem,
  CartDiscount,
  CartSummary,
  CartState,
  PosCustomer,
  Product,
  ProductVariant,
} from '@/features/store/types';

interface CustomItemData {
  name: string;
  description?: string;
  quantity: number;
  price: number;
  taxRate?: number;
}

interface CartActions {
  addItem: (product: Product, variant?: ProductVariant | null, quantity?: number) => void;
  addCustomItem: (custom: CustomItemData) => void;
  removeItem: (itemId: string) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  setCustomer: (customer: PosCustomer | null) => void;
  setNotes: (notes: string) => void;
  applyDiscount: (type: 'percentage' | 'fixed', value: number, description: string) => void;
  removeDiscount: (discountId: string) => void;
  clearCart: () => void;
  getSummary: () => CartSummary;
}

const initialState: CartState = {
  items: [],
  customer: null,
  notes: '',
  discounts: [],
  summary: { subtotal: 0, taxAmount: 0, discountAmount: 0, total: 0, itemCount: 0, totalItems: 0 },
};

function generateItemId(): string {
  return 'ITEM_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function getTaxRateSum(product: Product): number {
  if (!product.tax_assignments || product.tax_assignments.length === 0) return 0;
  let total = 0;
  for (const assignment of product.tax_assignments) {
    const taxCategory = assignment.tax_category ?? (assignment as any).tax_categories;
    if (taxCategory?.tax_rates) {
      for (const rate of taxCategory.tax_rates) {
        total += rate.rate;
      }
    }
  }
  return total;
}

function getSellableUnitPrice(product: Product, variant?: ProductVariant | null): number {
  if (variant?.is_on_sale && variant.sale_price != null) return Number(variant.sale_price) || 0;
  if (variant?.price_override != null) return Number(variant.price_override) || 0;
  if (product.is_on_sale && product.sale_price != null) return Number(product.sale_price) || 0;
  return Number(product.base_price) || 0;
}

function buildCartItem(product: Product, variant?: ProductVariant | null, quantity: number = 1): CartItem {
  const unitPrice = getSellableUnitPrice(product, variant);
  const rateSum = getTaxRateSum(product);
  const taxAmount = unitPrice * quantity * rateSum;
  const finalPrice = unitPrice * (1 + rateSum);
  const totalPrice = quantity * finalPrice;
  const variant_display_name = variant?.name || variant?.attributes || undefined;

  return {
    id: generateItemId(),
    product,
    variant: variant ?? null,
    quantity,
    unitPrice,
    finalPrice,
    totalPrice,
    taxAmount,
    variant_display_name,
  };
}

function recalcItem(item: CartItem): CartItem {
  const rateSum = getTaxRateSum(item.product);
  const unitPrice = getSellableUnitPrice(item.product, item.variant);
  const taxAmount = unitPrice * item.quantity * rateSum;
  const finalPrice = unitPrice * (1 + rateSum);
  const totalPrice = item.quantity * finalPrice;
  return { ...item, unitPrice, taxAmount, finalPrice, totalPrice };
}

function computeSummary(items: CartItem[], discounts: CartDiscount[]): CartSummary {
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const taxAmount = items.reduce((sum, i) => sum + i.taxAmount, 0);
  const discountAmount = discounts.reduce((sum, d) => sum + d.amount, 0);
  const total = subtotal + taxAmount - discountAmount;
  const itemCount = items.length;
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
  return { subtotal, taxAmount, discountAmount, total, itemCount, totalItems };
}

export const useCartStore = create<CartState & CartActions>()((set, get) => ({
  ...initialState,

  addItem: (product, variant, quantity = 1) => {
    const { items } = get();
    const existing = items.find(
      (i) => i.product.id === product.id && (i.variant?.id ?? null) === (variant?.id ?? null),
    );

    if (existing) {
      const updated = items.map((i) =>
        i.id === existing.id ? recalcItem({ ...i, quantity: i.quantity + quantity }) : i,
      );
      const summary = computeSummary(updated, get().discounts);
      set({ items: updated, summary });
    } else {
      const newItem = buildCartItem(product, variant, quantity);
      const updated = [...items, newItem];
      const summary = computeSummary(updated, get().discounts);
      set({ items: updated, summary });
    }
  },

  addCustomItem: (custom) => {
    const { items, discounts } = get();
    const taxAmount = custom.price * custom.quantity * (custom.taxRate ?? 0);
    const finalPrice = custom.price * (1 + (custom.taxRate ?? 0));
    const newItem: CartItem = {
      id: generateItemId(),
      product: {
        id: 0,
        store_id: 0,
        name: custom.name,
        slug: 'custom-' + Date.now(),
        description: custom.description ?? null,
        base_price: custom.price,
        state: 'active',
        final_price: finalPrice,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        track_inventory: false,
        pricing_type: 'unit',
        product_type: 'service',
        is_on_sale: false,
        sale_price: null,
        cost_price: null,
        profit_margin: null,
        available_for_ecommerce: false,
        sku: null,
        stock_quantity: null,
        weight: null,
        service_duration_minutes: null,
        service_modality: null,
        requires_booking: false,
        image_url: 'custom',
        brand: null,
        categories: [],
        product_variants: [],
        product_images: [],
        tax_assignments: custom.taxRate
          ? [{ id: 0, tax_category: { id: 0, name: '', tax_rates: [{ id: 0, rate: custom.taxRate }] } } as any]
          : [],
        total_stock_available: 0,
      } as Product,
      variant: null,
      quantity: custom.quantity,
      unitPrice: custom.price,
      finalPrice,
      totalPrice: custom.quantity * finalPrice,
      taxAmount: taxAmount,
      variant_display_name: custom.description || undefined,
      itemType: 'custom',
    };
    const updated = [...items, newItem];
    const summary = computeSummary(updated, discounts);
    set({ items: updated, summary });
  },

  removeItem: (itemId) => {
    const items = get().items.filter((i) => i.id !== itemId);
    const summary = computeSummary(items, get().discounts);
    set({ items, summary });
  },

  updateQuantity: (itemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(itemId);
      return;
    }
    const items = get().items.map((i) => (i.id === itemId ? recalcItem({ ...i, quantity }) : i));
    const summary = computeSummary(items, get().discounts);
    set({ items, summary });
  },

  setCustomer: (customer) => set({ customer }),

  setNotes: (notes) => set({ notes }),

  applyDiscount: (type, value, description) => {
    const { items, discounts } = get();
    const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
    const taxAmount = items.reduce((sum, i) => sum + i.taxAmount, 0);
    const preDiscountTotal = subtotal + taxAmount;
    const amount = type === 'percentage' ? (value / 100) * preDiscountTotal : value;
    const newDiscount: CartDiscount = {
      id: 'DISC_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      type,
      value,
      description,
      amount,
    };
    const updated = [...discounts, newDiscount];
    const summary = computeSummary(items, updated);
    set({ discounts: updated, summary });
  },

  removeDiscount: (discountId) => {
    const discounts = get().discounts.filter((d) => d.id !== discountId);
    const summary = computeSummary(get().items, discounts);
    set({ discounts, summary });
  },

  clearCart: () => set({ ...initialState, summary: { ...initialState.summary } }),

  getSummary: () => get().summary,
}));
