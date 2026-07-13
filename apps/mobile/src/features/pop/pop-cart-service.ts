import { useState, useCallback, useMemo } from 'react';
import type {
  PopCartState,
  PopCartItem,
  AddToPopCartRequest,
  UpdatePopCartItemRequest,
  ShippingMethod,
  PopOrderStatus,
} from './types';
import type { PurchaseOrder } from '../store/types/inventory.types';
import { INITIAL_CART_SUMMARY, recalcItem, calcSummary, itemKey, defaultUnitCost } from './constants';

function emptyState(): PopCartState {
  return {
    items: [],
    summary: { ...INITIAL_CART_SUMMARY },
    orderDate: new Date().toISOString().slice(0, 10),
    shippingCost: 0,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function usePopCart() {
  const [cart, setCart] = useState<PopCartState>(emptyState());

  const summary = useMemo(() => calcSummary(cart.items, cart.shippingCost), [cart.items, cart.shippingCost]);
  const itemCount = cart.items.length;
  const totalItems = cart.items.reduce((s, i) => s + i.quantity, 0);
  const isEmpty = cart.items.length === 0;

  const addToCart = useCallback((req: AddToPopCartRequest) => {
    const id = itemKey(req.product, req.variant);
    setCart((prev) => {
      const existing = prev.items.find((i) => i.id === id || (i.product.id === req.product.id && i.variant?.id === req.variant?.id));
      if (existing && !req.is_prebulk) {
        const updated = prev.items.map((i) =>
          i.id === existing.id
            ? recalcItem({
                ...i,
                quantity: i.quantity + req.quantity,
                unit_cost: req.unit_cost,
                notes: req.notes ?? i.notes,
              })
            : i
        );
        return { ...prev, items: updated, updatedAt: new Date().toISOString() };
      }
      const newItem: PopCartItem = {
        id: `POP_ITEM_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        product: req.product,
        variant: req.variant,
        quantity: req.quantity,
        unit_cost: req.unit_cost,
        subtotal: req.quantity * req.unit_cost,
        total: req.quantity * req.unit_cost,
        lot_info: req.lot_info,
        notes: req.notes,
        is_prebulk: req.is_prebulk,
        prebulk_data: req.prebulk_data,
        addedAt: new Date().toISOString(),
      };
      return { ...prev, items: [...prev.items, recalcItem(newItem)], updatedAt: new Date().toISOString() };
    });
  }, []);

  const updateCartItem = useCallback((req: UpdatePopCartItemRequest) => {
    setCart((prev) => {
      const items = prev.items.map((i) =>
        i.id === req.itemId
          ? recalcItem({
              ...i,
              quantity: req.quantity ?? i.quantity,
              unit_cost: req.unit_cost ?? i.unit_cost,
              variant: req.variant !== undefined ? req.variant : i.variant,
              lot_info: req.lot_info ?? i.lot_info,
              notes: req.notes ?? i.notes,
            })
          : i
      );
      return { ...prev, items, updatedAt: new Date().toISOString() };
    });
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.id !== itemId),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const clearCart = useCallback(() => {
    setCart(emptyState());
  }, []);

  const setSupplier = useCallback((id?: number, name?: string) => {
    setCart((prev) => ({ ...prev, supplierId: id, supplierName: name }));
  }, []);

  const setLocation = useCallback((id?: number, name?: string) => {
    setCart((prev) => ({ ...prev, locationId: id, locationName: name }));
  }, []);

  const setOrderDate = useCallback((date: string) => {
    setCart((prev) => ({ ...prev, orderDate: date }));
  }, []);

  const setExpectedDate = useCallback((date?: string) => {
    setCart((prev) => ({ ...prev, expectedDate: date }));
  }, []);

  const setShippingMethod = useCallback((method?: ShippingMethod) => {
    setCart((prev) => ({ ...prev, shippingMethod: method }));
  }, []);

  const setShippingCost = useCallback((cost: number) => {
    setCart((prev) => ({ ...prev, shippingCost: cost }));
  }, []);

  const setPaymentTerms = useCallback((terms?: string) => {
    setCart((prev) => ({ ...prev, paymentTerms: terms }));
  }, []);

  const setNotes = useCallback((notes?: string) => {
    setCart((prev) => ({ ...prev, notes }));
  }, []);

  const setInternalNotes = useCallback((internalNotes?: string) => {
    setCart((prev) => ({ ...prev, internalNotes }));
  }, []);

  const loadOrder = useCallback((order: PurchaseOrder) => {
    const items: PopCartItem[] = (order.purchase_order_items || []).map((poItem, idx) => ({
      id: `LOADED_${idx}_${Date.now()}`,
      product: {
        id: poItem.product_id,
        name: poItem.products?.name || poItem.product_name || `Producto #${poItem.product_id}`,
        sku: poItem.products?.sku ?? undefined,
      },
      variant: poItem.product_variant_id ? { id: poItem.product_variant_id, name: '' } : null,
      quantity: poItem.quantity_ordered,
      unit_cost: poItem.unit_price,
      subtotal: poItem.quantity_ordered * poItem.unit_price,
      total: poItem.quantity_ordered * poItem.unit_price,
      addedAt: new Date().toISOString(),
    }));
    setCart({
      orderId: order.id,
      items,
      summary: { ...INITIAL_CART_SUMMARY },
      supplierId: order.supplier_id,
      supplierName: order.suppliers?.name,
      locationId: order.location_id,
      locationName: order.inventory_locations?.name,
      orderDate: order.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10),
      shippingCost: Number(order.shipping_cost) || 0,
      paymentTerms: order.payment_terms || undefined,
      notes: order.notes || undefined,
      internalNotes: order.internal_notes || undefined,
      status: (order.status as PopOrderStatus) || 'draft',
      createdAt: order.created_at,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  return {
    cart,
    summary,
    itemCount,
    totalItems,
    isEmpty,
    addToCart,
    updateCartItem,
    removeFromCart,
    clearCart,
    setSupplier,
    setLocation,
    setOrderDate,
    setExpectedDate,
    setShippingMethod,
    setShippingCost,
    setPaymentTerms,
    setNotes,
    setInternalNotes,
    loadOrder,
  };
}
