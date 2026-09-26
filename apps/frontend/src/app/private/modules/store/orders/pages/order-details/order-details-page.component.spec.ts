import {
  ORDER_DELIVERY_CONFIG, ORDER_DELIVERY_STEP_LABELS, pendingKitchenLabelsFromError,
  cancellationBody, isOrderItemCancellationPaid, shippingTaxModePrefix,
  lifecycleLookupState, kitchenStateForItem, isItemActionEnabled, isOrderCreateLog,
  isRefundAuditRow, isConfirmedStateTransition, buildOrderActionButtons,
} from './order-details-page.component';
import { Order, OrderItem } from '../../interfaces/order.interface';
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

describe('OrderDetailsPageComponent — prefijo del modo del impuesto del envío', () => {
  it('dice "Base +" cuando el impuesto se agregó encima (is_inclusive=false)', () => {
    expect(shippingTaxModePrefix(false)).toBe('Base +');
  });

  it('dice "Incluye" cuando va dentro del costo o la copia legacy no trae modo', () => {
    expect(shippingTaxModePrefix(true)).toBe('Incluye');
    expect(shippingTaxModePrefix(null)).toBe('Incluye');
    expect(shippingTaxModePrefix(undefined)).toBe('Incluye');
  });
});

describe('B13 (release-855) — lifecycleLookupState', () => {
  it('aliasa draft→created y pending_delivery→processing para el índice', () => {
    expect(lifecycleLookupState('draft' as any)).toBe('created');
    expect(lifecycleLookupState('pending_delivery' as any)).toBe('processing');
  });

  it('deja pasar cualquier otro estado sin cambios', () => {
    for (const state of ['created', 'pending_payment', 'processing', 'shipped', 'delivered', 'finished', 'cancelled', 'refunded']) {
      expect(lifecycleLookupState(state as any)).toBe(state as any);
    }
  });
});

describe('B16 (release-855) — kitchenStateForItem', () => {
  it('kitchenStateForItem retorna null sin filas de cocina', () => {
    expect(kitchenStateForItem({ kitchen_ticket_items: [] } as any)).toBeNull();
    expect(kitchenStateForItem({ kitchen_ticket_items: undefined } as any)).toBeNull();
  });

  it('kitchenStateForItem prioriza la fila en vuelo sobre una terminal más reciente', () => {
    const item = { kitchen_ticket_items: [
      { status: 'delivered', kitchen_ticket_id: 1 },
      { status: 'in_preparation', kitchen_ticket_id: 2 },
    ] } as any;
    expect(kitchenStateForItem(item)).toEqual({ status: 'in_preparation', kitchen_ticket_id: 2 });
  });

  it('kitchenStateForItem cae a la primera fila (más reciente, pre-ordenada) sin fila en vuelo', () => {
    const item = { kitchen_ticket_items: [{ status: 'delivered', kitchen_ticket_id: 1 }] } as any;
    expect(kitchenStateForItem(item)).toEqual({ status: 'delivered', kitchen_ticket_id: 1 });
  });
});

describe('order-truth-and-invoice-tz plan (Objetivo 3) — isItemActionEnabled', () => {
  it('lee el code correspondiente desde item.available_actions', () => {
    const item = {
      available_actions: [
        { code: 'deliver', enabled: true },
        { code: 'cancel', enabled: false, reason: 'ORD_ITEM_CANCEL_PAID_001' },
        { code: 'reverse_delivered', enabled: false },
        { code: 'resend', enabled: true },
      ],
    } as unknown as OrderItem;
    expect(isItemActionEnabled(item, 'deliver')).toBeTrue();
    expect(isItemActionEnabled(item, 'cancel')).toBeFalse();
    expect(isItemActionEnabled(item, 'reverse_delivered')).toBeFalse();
    expect(isItemActionEnabled(item, 'resend')).toBeTrue();
  });

  it('sin available_actions (respuesta vieja) no habilita ningún code — nunca cae a un predicado local', () => {
    const item = {} as OrderItem;
    expect(isItemActionEnabled(item, 'deliver')).toBeFalse();
    expect(isItemActionEnabled(item, 'cancel')).toBeFalse();
    expect(isItemActionEnabled(item, 'reverse_delivered')).toBeFalse();
    expect(isItemActionEnabled(item, 'resend')).toBeFalse();
  });

  it('ignora un code presente pero con enabled:false, y uno ausente del arreglo', () => {
    const item = { available_actions: [{ code: 'deliver', enabled: false }] } as unknown as OrderItem;
    expect(isItemActionEnabled(item, 'deliver')).toBeFalse();
    expect(isItemActionEnabled(item, 'resend')).toBeFalse();
  });
});

describe('order-truth-and-invoice-tz plan (Objetivos 3/11/12) — buildOrderActionButtons', () => {
  it('sin available_actions (respuesta vieja) no pinta ningún botón', () => {
    expect(buildOrderActionButtons({ state: 'created', available_actions: undefined } as any)).toEqual([]);
    expect(buildOrderActionButtons({ state: 'created', available_actions: [] } as any)).toEqual([]);
  });

  it('pinta exactamente los botones del backend, en orden presentacional, e ignora codes ajenos al arreglo', () => {
    const order = {
      state: 'created',
      available_actions: [
        { code: 'cancel', label_key: 'ORD_ACTION_CANCEL', enabled: true },
        { code: 'pay', label_key: 'ORD_ACTION_PAY', enabled: true },
        { code: 'edit_order', label_key: 'ORD_ACTION_EDIT_ORDER', enabled: false, reason: 'FORBIDDEN' },
        // assign_shipping no tiene botón en este arreglo — vive en la UI de envío.
        { code: 'assign_shipping', label_key: 'ORD_ACTION_ASSIGN_SHIPPING', enabled: false },
      ],
    } as any;
    const buttons = buildOrderActionButtons(order);
    expect(buttons.map((b) => b.id)).toEqual(['edit-order', 'pay', 'cancel']);
    expect(buttons.find((b) => b.id === 'edit-order')).toEqual(
      jasmine.objectContaining({ enabled: false, reason: 'FORBIDDEN' }),
    );
    expect(buttons.find((b) => b.id === 'pay')).toEqual(jasmine.objectContaining({ enabled: true }));
  });

  it('mapea ready_for_pickup a un botón solo en pending_payment, no en processing (esa vive en la UI de envío)', () => {
    const pending = {
      state: 'pending_payment',
      available_actions: [{ code: 'ready_for_pickup', label_key: 'ORD_ACTION_READY_FOR_PICKUP', enabled: true }],
    } as any;
    expect(buildOrderActionButtons(pending).map((b) => b.id)).toEqual(['manual-ready-pickup']);

    const processing = {
      state: 'processing',
      available_actions: [{ code: 'ready_for_pickup', label_key: 'ORD_ACTION_READY_FOR_PICKUP', enabled: true }],
    } as any;
    expect(buildOrderActionButtons(processing)).toEqual([]);
  });

  it('etiqueta mark_delivered según delivery_type (home_delivery / pickup / otro)', () => {
    const base = { state: 'shipped', available_actions: [{ code: 'mark_delivered', label_key: 'ORD_ACTION_MARK_DELIVERED', enabled: true }] };
    expect(buildOrderActionButtons({ ...base, delivery_type: 'home_delivery' } as any)[0].label).toBe('Marcar como Entregado');
    expect(buildOrderActionButtons({ ...base, delivery_type: 'pickup' } as any)[0].label).toBe('Confirmar recogida en tienda');
    expect(buildOrderActionButtons({ ...base, delivery_type: 'direct_delivery' } as any)[0].label).toBe('Confirmar Entrega');
  });

  it('un mismo code repetido con distinto enabled/reason se traduce 1:1 a su botón (objetivo 12: pay + credit_payment simultáneos)', () => {
    const order = {
      state: 'finished',
      available_actions: [
        { code: 'pay', label_key: 'ORD_ACTION_PAY', enabled: false, reason: 'ORD_PAY_CREDIT_ORDER_001' },
        { code: 'credit_payment', label_key: 'ORD_ACTION_CREDIT_PAYMENT', enabled: true },
        { code: 'refund', label_key: 'ORD_ACTION_REFUND', enabled: true },
      ],
    } as any;
    const buttons = buildOrderActionButtons(order);
    // pay y credit_payment comparten peso presentacional: el orden de
    // salida para pesos iguales sigue el orden del arreglo del backend
    // (sort estable), por eso pay aparece primero aquí.
    expect(buttons.map((b) => b.id)).toEqual(['pay', 'credit-payment', 'refund']);
    expect(buttons.find((b) => b.id === 'pay')?.enabled).toBeFalse();
    expect(buttons.find((b) => b.id === 'credit-payment')?.enabled).toBeTrue();
  });

  it('reactivate se pinta sin gate de rol propio — la verdad de rol ya la aplicó el backend', () => {
    const order = {
      state: 'cancelled',
      available_actions: [{ code: 'reactivate', label_key: 'ORD_ACTION_REACTIVATE', enabled: true }],
    } as any;
    expect(buildOrderActionButtons(order)).toEqual([
      jasmine.objectContaining({ id: 'reactivate', enabled: true }),
    ]);
  });

  it('mapea collect_payment al botón "ship" ("Pasar a Cobro") — restaura el botón removido en commit cbebc40db8f', () => {
    const order = {
      state: 'processing',
      delivery_type: 'direct_delivery',
      available_actions: [
        { code: 'collect_payment', label_key: 'ORD_ACTION_COLLECT_PAYMENT', enabled: true },
      ],
    } as any;
    expect(buildOrderActionButtons(order)).toEqual([
      jasmine.objectContaining({
        id: 'ship',
        label: 'Pasar a Cobro',
        icon: 'credit-card',
        variant: 'primary',
        enabled: true,
      }),
    ]);
  });
});

describe('B3 (release-855) — isOrderCreateLog / isRefundAuditRow / isConfirmedStateTransition', () => {
  it('isOrderCreateLog sólo marca la fila CREATE cuyo new_values.id ES la orden', () => {
    expect(isOrderCreateLog({ action: 'CREATE', new_values: { id: 42 } }, 42)).toBeTrue();
    expect(isOrderCreateLog({ action: 'CREATE', new_values: { id: 42 } }, null)).toBeFalse();
    // Sub-acción (ítem, cupón…): CREATE pero con su propio id, no el de la orden.
    expect(isOrderCreateLog({ action: 'CREATE', new_values: { id: 7, order_id: 42 } }, 42)).toBeFalse();
    expect(isOrderCreateLog({ action: 'UPDATE', new_values: { id: 42 } }, 42)).toBeFalse();
  });

  it('isRefundAuditRow identifica filas de refund por su propia forma, no por el valor del estado', () => {
    expect(isRefundAuditRow({ metadata: { flow_action: 'refund' } })).toBeTrue();
    expect(isRefundAuditRow({ new_values: { order_id: 42 } })).toBeTrue();
    expect(isRefundAuditRow({ old_values: { order_id: 42 } })).toBeTrue();
    // Fila de orden común: sin order_id ni flow_action=refund.
    expect(isRefundAuditRow({ new_values: { id: 42, state: 'processing' } })).toBeFalse();
    expect(isRefundAuditRow({})).toBeFalse();
  });

  it('isConfirmedStateTransition exige una transición real u origen FLOW', () => {
    expect(isConfirmedStateTransition({}, 'pending_payment', 'processing')).toBeTrue();
    // Snapshot repetido (mismo estado en old/new): no hubo transición.
    expect(isConfirmedStateTransition({}, 'processing', 'processing')).toBeFalse();
    // Sin old_values pero marcado FLOW: sigue siendo una transición real.
    expect(isConfirmedStateTransition({ metadata: { method: 'FLOW' } }, null, 'processing')).toBeTrue();
    // Sin old_values y sin marca FLOW: no se puede confirmar la transición.
    expect(isConfirmedStateTransition({}, null, 'processing')).toBeFalse();
  });
});
