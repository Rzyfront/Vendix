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

interface CartActions {
  addItem: (product: Product, variant?: ProductVariant | null, quantity?: number) => void;
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
