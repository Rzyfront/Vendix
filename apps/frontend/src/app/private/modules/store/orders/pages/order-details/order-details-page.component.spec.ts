import {
  ORDER_DELIVERY_CONFIG, ORDER_DELIVERY_STEP_LABELS, pendingKitchenLabelsFromError,
  cancellationBody, isOrderItemCancellationPaid,
} from './order-details-page.component';
import { Order } from '../../interfaces/order.interface';

describe('OrderDetailsPageComponent — vocabulario de entrega', () => {
  it('distingue Para llevar, recogida real y consumo en mesa', () => {
    expect(ORDER_DELIVERY_CONFIG.direct_delivery.label).toBe('Entrega directa en mostrador');
    expect(ORDER_DELIVERY_CONFIG.pickup.label).toBe('Recogida en tienda');
    expect(ORDER_DELIVERY_CONFIG.dine_in.label).toBe('Consumo en mesa');
    expect(ORDER_DELIVERY_STEP_LABELS.direct_delivery['shipped']).toBe('Entregada en mostrador');
    expect(ORDER_DELIVERY_STEP_LABELS.pickup['shipped']).toBe('Lista para recogida');
    expect(ORDER_DELIVERY_STEP_LABELS.pickup['delivered']).toBe('Recogida en tienda');
    expect(ORDER_DELIVERY_STEP_LABELS.dine_in['delivered']).toBe('Servida en mesa');
  });
});

describe('OrderDetailsPageComponent — destino de cancelación', () => {
  it('uses the backend-supported canonical type for a fired dish sent to waste', () => {
    expect(cancellationBody('cancel', 'Plato caído', 'waste', true)).toEqual({
      reason: 'Plato caído', cancellation_type: 'after_fire_waste',
    });
  });

  it('does not send a destination/type for an unfired item', () => {
    expect(cancellationBody('cancel', 'Error de comanda', 'waste', false)).toEqual({
      reason: 'Error de comanda',
    });
  });

  it('fails closed instead of sending after_fire_reused to the current cancel DTO', () => {
    expect(() => cancellationBody('cancel', 'Reutilizar plato', 'reuse', true)).toThrow();
  });

  it('maps the modal choice to the delivered-reversal destination contract', () => {
    expect(cancellationBody('reverse', 'Plato intacto', 'reuse', true)).toEqual({
      reason: 'Plato intacto', destination: 'restock',
    });
    expect(cancellationBody('reverse', 'Plato contaminado', 'waste', true)).toEqual({
      reason: 'Plato contaminado', destination: 'waste',
    });
  });

  it('blocks all settled payment states but not pending payment', () => {
    for (const state of ['succeeded', 'captured', 'partially_refunded', 'refunded']) {
      expect(isOrderItemCancellationPaid({ payments: [{ state }] } as Order)).toBeTrue();
    }
    expect(isOrderItemCancellationPaid({ payments: [{ state: 'pending' }] } as Order)).toBeFalse();
    expect(isOrderItemCancellationPaid(null)).toBeFalse();
  });
});

describe('OrderDetailsPageComponent — platos pendientes al finalizar', () => {
  it('usa la lista fresca del error tipado, incluyendo variante y cantidad', () => {
    expect(pendingKitchenLabelsFromError({
      details: { pending_items: [
        { product_name: 'Hamburguesa', variant_label: 'Grande', quantity: 2 },
        { product_name: 'Papas', variant_label: null, quantity: 1 },
      ] },
    })).toEqual(['Hamburguesa (Grande) ×2', 'Papas']);
  });

  it('tolera errores sin una lista válida', () => {
    expect(pendingKitchenLabelsFromError({ details: { pending_items: null } })).toEqual([]);
    expect(pendingKitchenLabelsFromError(null)).toEqual([]);
  });
});
