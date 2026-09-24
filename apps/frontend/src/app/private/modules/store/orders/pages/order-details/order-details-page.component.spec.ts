import {
  ORDER_DELIVERY_CONFIG, ORDER_DELIVERY_STEP_LABELS, pendingKitchenLabelsFromError,
  cancellationBody, isOrderItemCancellationPaid,
} from './order-details-page.component';
import { Order } from '../../interfaces/order.interface';
import {
  previewItemCancellation,
  rederivePercentageTip,
  cancellationTypeForDestination,
} from '../../../../../../shared/components/item-cancellation-modal/item-cancellation-totals';

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

  it('does not label an unfired item as reused even if the modal retains that choice', () => {
    expect(cancellationBody('cancel', 'Error de comanda', 'reuse', false)).toEqual({
      reason: 'Error de comanda',
    });
  });

  it('sends the canonical reuse type for a fired dish', () => {
    expect(cancellationBody('cancel', 'Reutilizar plato', 'reuse', true)).toEqual({
      reason: 'Reutilizar plato', cancellation_type: 'after_fire_reused',
    });
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

describe('ItemCancellationModal — preview D.4 (espejo del recálculo backend)', () => {
  const lines = [
    { id: 1, total_price: 100, cancelled_at: null, order_item_taxes: [{ tax_amount: 19 }] },
    { id: 2, total_price: 50, cancelled_at: null, order_item_taxes: [{ tax_amount: 9.5 }] },
    // Ya cancelada antes: no entra en la base viva.
    { id: 3, total_price: 999, cancelled_at: '2026-09-01', order_item_taxes: [{ tax_amount: 999 }] },
  ];

  it('excludes the target line and re-derives a percentage tip on the live base', () => {
    const p = previewItemCancellation(lines, 2, {
      shipping_cost: 10, discount_amount: 5, tip_amount: 20, tip_type: 'percentage', tip_value: 10,
    });
    // Base viva = línea 1: 100 + 19 = 119 → propina 10% = 11.9.
    expect(p).toEqual({
      liveSubtotal: 100, liveTax: 19, currentTip: 20, newTip: 11.9,
      tipRederived: true, previewTotal: 100 + 19 + 10 + 11.9 - 5,
    });
  });

  it('respects a fixed tip and keeps it in the total', () => {
    const p = previewItemCancellation(lines, 1, {
      shipping_cost: 0, discount_amount: 0, tip_amount: 7, tip_type: 'fixed', tip_value: 7,
    });
    expect(p?.tipRederived).toBeFalse();
    expect(p?.newTip).toBe(7);
    expect(p?.previewTotal).toBe(50 + 9.5 + 0 + 7 - 0);
  });

  it('keeps the persisted tip when there is no percentage type', () => {
    const p = previewItemCancellation(lines, 1, { tip_amount: 3 });
    expect(p?.tipRederived).toBeFalse();
    expect(p?.newTip).toBe(3);
  });

  it('rounds the re-derived tip exactly like the backend (half-up + EPSILON)', () => {
    // 10% de 119 = 11.9 exacto; el caso flotante se verifica contra la
    // expresión literal del backend para que el espejo no diverja.
    const raw = (100 + 19) * (10 / 100);
    expect(rederivePercentageTip('percentage', 10, 100, 19))
      .toBe(Math.round((raw + Number.EPSILON) * 100) / 100);
    expect(rederivePercentageTip('percentage', 0, 100, 19)).toBeNull();
    expect(rederivePercentageTip('fixed', 10, 100, 19)).toBeNull();
    expect(rederivePercentageTip(null, 10, 100, 19)).toBeNull();
  });

  it('clamps the preview total at zero and returns null without the target line', () => {
    const p = previewItemCancellation(lines, 1, { discount_amount: 1000 });
    expect(p?.previewTotal).toBe(0);
    expect(previewItemCancellation(lines, 4242, {})).toBeNull();
  });

  it('maps the mesa destination to the canonical cancellation type', () => {
    expect(cancellationTypeForDestination('waste', true)).toBe('after_fire_waste');
    expect(cancellationTypeForDestination('reuse', true)).toBe('after_fire_reused');
    expect(cancellationTypeForDestination('waste', false)).toBeUndefined();
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
