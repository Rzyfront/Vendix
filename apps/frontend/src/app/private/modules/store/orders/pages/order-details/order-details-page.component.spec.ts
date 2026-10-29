import { signal } from '@angular/core';
import { of } from 'rxjs';
import {
  ORDER_DELIVERY_CONFIG, ORDER_DELIVERY_STEP_LABELS, pendingKitchenLabelsFromError,
  cancellationBody, isOrderItemCancellationPaid, shippingTaxModePrefix,
  lifecycleLookupState, kitchenStateForItem, isItemActionEnabled, isOrderCreateLog,
  isRefundAuditRow, isConfirmedStateTransition, buildOrderActionButtons,
  orderStateLabel, orderEventLabel, orderEventActorLabel, isRefundOrderEvent,
  cancelPaymentCopy,
  isCodAwaitingConfirmation, isOrderEligibleForSplitCreation,
  isManualPaymentPending, isOrderSplitLocked, OrderDetailsPageComponent,
} from './order-details-page.component';
import { Order, OrderItem, OrderEvent } from '../../interfaces/order.interface';
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

describe('OrderDetailsPageComponent — contra entrega y cuentas', () => {
  it('recognizes only an unsettled ON_DELIVERY marker as COD awaiting actual tender', () => {
    const marker = { state: 'pending', store_payment_method: { system_payment_method: { type: 'cash_on_delivery', processing_mode: 'ON_DELIVERY' } } };
    expect(isCodAwaitingConfirmation({ payments: [marker] } as any)).toBeTrue();
    expect(isCodAwaitingConfirmation({ payments: [{ ...marker, state: 'cancelled' }] } as any)).toBeFalse();
  });

  it('permits split creation only for an eligible order with outstanding balance', () => {
    const order = {
      id: 1, state: 'created', grand_total: 100, payment_form: '1',
      order_items: [{ id: 1, cancelled_at: null }], payments: [], invoices: [],
    } as unknown as Order;
    expect(isOrderEligibleForSplitCreation(order)).toBeTrue();
    expect(isOrderEligibleForSplitCreation({ ...order, payments: [{ state: 'pending' }] } as Order)).toBeFalse();
    expect(isOrderEligibleForSplitCreation({ ...order, state: 'cancelled' })).toBeFalse();
    expect(isOrderEligibleForSplitCreation({ ...order, payments: [{ state: 'succeeded', amount: 100 }] } as Order)).toBeFalse();
  });
});

describe('Fase 2 (paso 8) — isManualPaymentPending', () => {
  const manual = (over: Record<string, unknown> = {}) => ({
    state: 'pending',
    store_payment_method: {
      system_payment_method: { type: 'bank_transfer', processing_mode: 'DIRECT' },
    },
    ...over,
  });
  const order = (over: Record<string, unknown> = {}) => ({
    state: 'pending_payment',
    remaining_balance: 0,
    payments: [],
    ...over,
  });

  it('es true con pago manual pendiente o con saldo parcial', () => {
    expect(isManualPaymentPending(order({ payments: [manual()] }) as any)).toBeTrue();
    expect(isManualPaymentPending(order({ payments: [manual({ store_payment_method: { system_payment_method: { type: 'voucher', processing_mode: 'DIRECT' } } })] }) as any)).toBeTrue();
    expect(isManualPaymentPending(order({ remaining_balance: 40000 }) as any)).toBeTrue();
  });

  it('es false para wallet/wompi/contraentrega, otros estados y orden saldada', () => {
    const wompi = manual({ store_payment_method: { system_payment_method: { type: 'wompi', processing_mode: 'ONLINE' } } });
    const wallet = manual({ store_payment_method: { system_payment_method: { type: 'wallet', processing_mode: 'DIRECT' } } });
    const cod = manual({ store_payment_method: { system_payment_method: { type: 'cash_on_delivery', processing_mode: 'ON_DELIVERY' } } });
    expect(isManualPaymentPending(order({ payments: [wompi] }) as any)).toBeFalse();
    expect(isManualPaymentPending(order({ payments: [wallet] }) as any)).toBeFalse();
    expect(isManualPaymentPending(order({ payments: [cod] }) as any)).toBeFalse();
    expect(isManualPaymentPending(order({ payments: [{ ...manual(), state: 'cancelled' }] }) as any)).toBeFalse();
    expect(isManualPaymentPending(order({ payments: [{ state: 'pending' }] }) as any)).toBeFalse();
    expect(isManualPaymentPending(order({ state: 'processing', payments: [manual()] }) as any)).toBeFalse();
    expect(isManualPaymentPending(order() as any)).toBeFalse();
    expect(isManualPaymentPending(null)).toBeFalse();
  });

  it('rotula "Registrar Pago" la acción pay de una orden manual pendiente', () => {
    const buttons = buildOrderActionButtons(
      order({
        payments: [manual()],
        available_actions: [{ code: 'pay', enabled: true }],
      }) as any,
    );
    expect(buttons.map((b) => b.label)).toEqual(['Registrar Pago']);
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
  it('labels a shipped unpaid COD order Confirmar Pago without turning COD into the actual tender', () => {
    const order = {
      state: 'shipped', delivery_type: 'home_delivery',
      payments: [{ state: 'pending', store_payment_method: { system_payment_method: { processing_mode: 'ON_DELIVERY' } } }],
      available_actions: [{ code: 'pay', label_key: 'ORD_ACTION_PAY', enabled: true }],
    } as any;
    expect(buildOrderActionButtons(order)).toEqual([
      jasmine.objectContaining({ id: 'pay', label: 'Confirmar Pago', enabled: true }),
    ]);
  });
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

describe('order-truth-and-invoice-tz plan (Paso 7) — orderStateLabel / orderEventLabel / orderEventActorLabel / isRefundOrderEvent', () => {
  const baseEvent = (overrides: Partial<OrderEvent>): OrderEvent => ({
    id: 1,
    event_type: 'customer_changed',
    from_state: null,
    to_state: null,
    actor: null,
    actor_source: 'system',
    payment_id: null,
    order_item_id: null,
    amount: null,
    payload: null,
    created_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  });
  const formatAmount = (amount: number | string | null | undefined) => `$${amount}`;

  it('orderStateLabel traduce los estados conocidos y deja pasar el resto', () => {
    expect(orderStateLabel('processing')).toBe('Procesando');
    expect(orderStateLabel('finished')).toBe('Finalizada');
    expect(orderStateLabel(null)).toBe('Desconocido');
    expect(orderStateLabel(undefined)).toBe('Desconocido');
    expect(orderStateLabel('unknown_state' as any)).toBe('unknown_state');
  });

  it('orderEventLabel arma "Estado: X → Y" para state_changed reusando orderStateLabel', () => {
    const evt = baseEvent({ event_type: 'state_changed', from_state: 'pending_payment' as any, to_state: 'processing' as any });
    expect(orderEventLabel(evt, formatAmount)).toBe('Estado: Pago Pendiente → Procesando');
  });

  it('orderEventLabel arma payment_registered con monto y método cuando el payload los trae', () => {
    const evt = baseEvent({ event_type: 'payment_registered', amount: 5000, payload: { method: 'cash' } });
    expect(orderEventLabel(evt, formatAmount)).toBe('Pago registrado — $5000 — cash');
  });

  it('orderEventLabel se degrada a la etiqueta simple sin monto ni método', () => {
    const evt = baseEvent({ event_type: 'payment_registered' });
    expect(orderEventLabel(evt, formatAmount)).toBe('Pago registrado');
  });

  it('orderEventLabel arma invoice_issued con el número de factura cuando el payload lo trae', () => {
    expect(orderEventLabel(baseEvent({ event_type: 'invoice_issued', payload: { invoice_number: 'FE-001' } }), formatAmount))
      .toBe('Factura emitida — FE-001');
    expect(orderEventLabel(baseEvent({ event_type: 'invoice_issued' }), formatAmount)).toBe('Factura emitida');
  });

  it('orderEventLabel arma kitchen_fired con el número de platos y distingue el reenvío', () => {
    expect(orderEventLabel(baseEvent({ event_type: 'kitchen_fired', payload: { ticket_ids: [9], order_item_ids: [1, 2] } }), formatAmount))
      .toBe('Enviado a cocina — 2 platos');
    expect(orderEventLabel(baseEvent({ event_type: 'kitchen_fired', payload: { order_item_ids: [1], resend: true } }), formatAmount))
      .toBe('Reenviado a cocina — 1 plato');
    expect(orderEventLabel(baseEvent({ event_type: 'kitchen_fired' }), formatAmount)).toBe('Enviado a cocina');
  });

  it('orderEventLabel cubre el resto del mapa determinístico por event_type', () => {
    const cases: Array<[OrderEvent['event_type'], string]> = [
      ['payment_cancelled', 'Pago anulado'],
      ['refund_created', 'Reembolso creado'],
      ['refund_resolved', 'Reembolso resuelto'],
      ['customer_changed', 'Cliente cambiado'],
      ['item_delivered', 'Ítem entregado'],
      ['item_cancelled', 'Ítem cancelado'],
      ['item_delivery_reverted', 'Entrega de ítem revertida'],
      ['shipping_assigned', 'Envío asignado'],
    ];
    for (const [event_type, label] of cases) {
      expect(orderEventLabel(baseEvent({ event_type }), formatAmount)).toBe(label);
    }
  });

  it('orderEventActorLabel usa el nombre del actor cuando existe', () => {
    const evt = baseEvent({ actor: { user_id: 9, name: 'Ana Pérez' }, actor_source: 'http' });
    expect(orderEventActorLabel(evt)).toBe('Ana Pérez');
  });

  it('orderEventActorLabel cae al label fijo por actor_source sin actor', () => {
    expect(orderEventActorLabel(baseEvent({ actor: null, actor_source: 'system' }))).toBe('Sistema');
    expect(orderEventActorLabel(baseEvent({ actor: null, actor_source: 'webhook' }))).toBe('Pasarela de pago');
    expect(orderEventActorLabel(baseEvent({ actor: null, actor_source: 'job' }))).toBe('Proceso automático');
    expect(orderEventActorLabel(baseEvent({ actor: null, actor_source: 'listener' }))).toBe('Cocina/Despacho');
    expect(orderEventActorLabel(baseEvent({ actor: null, actor_source: 'http' }))).toBe('Sistema');
  });

  it('isRefundOrderEvent es true SOLO para refund_created/refund_resolved, nunca por colisión de nombre con un estado', () => {
    expect(isRefundOrderEvent(baseEvent({ event_type: 'refund_created' }))).toBeTrue();
    expect(isRefundOrderEvent(baseEvent({ event_type: 'refund_resolved' }))).toBeTrue();
    // state_changed hacia un to_state que en el enum de refunds se llamaría
    // igual ('processing'/'cancelled') NO activa el badge — a diferencia de
    // la heurística legacy `isRefundAuditRow`, acá sólo manda el event_type.
    expect(isRefundOrderEvent(baseEvent({ event_type: 'state_changed', to_state: 'processing' as any }))).toBeFalse();
    expect(isRefundOrderEvent(baseEvent({ event_type: 'payment_cancelled' }))).toBeFalse();
  });
});

describe('cancelPaymentCopy — el texto de «Cancelar pago» dice lo que hace el backend', () => {
  it('shipped/delivered conservan el estado: nunca prometen volver a «Creada»', () => {
    for (const state of ['shipped', 'delivered']) {
      const copy = cancelPaymentCopy(state);
      expect(copy.confirm).toContain('conserva su estado');
      expect(copy.confirm).not.toContain('Creada');
      expect(copy.success).not.toContain('Creada');
    }
  });

  it('pending_payment/processing vuelven a «Creada» y avisan que no se re-descuenta stock', () => {
    for (const state of ['pending_payment', 'processing']) {
      const copy = cancelPaymentCopy(state);
      expect(copy.confirm).toContain('"Creada"');
      expect(copy.confirm).toContain('no se vuelven a descontar');
      expect(copy.success).toContain('"Creada"');
    }
  });
});

describe('OrderDetailsPageComponent — cuenta dividida fija los importes', () => {
  it('bloquea cancelar/procesar completa solo con división activa', () => {
    expect(isOrderSplitLocked({ active_financial_split_id: 5 })).toBeTrue();
    expect(isOrderSplitLocked({ active_financial_split_id: null })).toBeFalse();
    expect(isOrderSplitLocked(null)).toBeFalse();
  });
});

describe('QUI-650 — Modificar Orden abre el modal de ítems', () => {
  const build = (order: unknown) => {
    const showItemsEditModal = signal(false);
    const router = jasmine.createSpyObj('Router', ['navigate']);
    const self = {
      order: () => order,
      showItemsEditModal,
      router,
      openItemsEditModal: OrderDetailsPageComponent.prototype.openItemsEditModal,
    };
    return { self, showItemsEditModal, router };
  };

  it("executeAction('edit-order') abre el modal y no navega al POS", () => {
    const { self, showItemsEditModal, router } = build({ id: 5 });
    OrderDetailsPageComponent.prototype.executeAction.call(self as any, 'edit-order');
    expect(showItemsEditModal()).toBeTrue();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('no hace nada si la orden tiene una cuenta dividida activa', () => {
    const { self, showItemsEditModal, router } = build({ id: 5, active_financial_split_id: 9 });
    OrderDetailsPageComponent.prototype.executeAction.call(self as any, 'edit-order');
    expect(showItemsEditModal()).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('Consumidor final de una orden sin pagar pide confirmación', () => {
  const proto = OrderDetailsPageComponent.prototype as any;
  const build = (unpaid: boolean, answer: boolean) => {
    const self: any = {
      hasUnpaidBalance: () => unpaid,
      dialogService: { confirm: jasmine.createSpy('confirm').and.resolveTo(answer) },
      showCreditModal: signal(true),
      showHolderModal: signal(true),
      holderEmitKey: 'order',
      emitAllowFinalConsumer: false,
      runEmit: jasmine.createSpy('runEmit'),
    };
    self.confirmFinalConsumerCash = proto.confirmFinalConsumerCash.bind(self);
    self.emitAsFinalConsumerCash = proto.emitAsFinalConsumerCash.bind(self);
    return self;
  };

  it('modal de crédito → «Volver» no emite y el modal sigue abierto', async () => {
    const self = build(true, false);
    await proto.onCreditUseFinalConsumer.call(self);
    const data = self.dialogService.confirm.calls.mostRecent().args[0];
    expect(data.title).toBe('Orden sin pagar');
    expect(data.message).toContain('se recomienda emitir la factura a crédito');
    expect(data.message).toContain('se necesitan los datos del cliente');
    expect(data.message).toContain('de contado, como ya pagada');
    expect(data.message).toContain('¿Deseas continuar?');
    expect(data.confirmText).toBe('Sí, emitir a Consumidor final');
    expect(data.cancelText).toBe('Volver');
    expect(self.runEmit).not.toHaveBeenCalled();
    expect(self.showCreditModal()).toBeTrue();
  });

  it('modal de crédito → «Sí» cierra el modal y emite a Consumidor final', async () => {
    const self = build(true, true);
    await proto.onCreditUseFinalConsumer.call(self);
    expect(self.showCreditModal()).toBeFalse();
    expect(self.runEmit).toHaveBeenCalledWith('order', null, undefined, true);
  });

  it('modal del titular en orden sin pagar también confirma', async () => {
    const self = build(true, false);
    await proto.onHolderUseFinalConsumer.call(self);
    expect(self.dialogService.confirm).toHaveBeenCalled();
    expect(self.runEmit).not.toHaveBeenCalled();
    expect(self.showHolderModal()).toBeTrue();
  });

  it('orden pagada: emite directo sin confirmación', async () => {
    const self = build(false, false);
    await proto.onHolderUseFinalConsumer.call(self);
    expect(self.dialogService.confirm).not.toHaveBeenCalled();
    expect(self.showHolderModal()).toBeFalse();
    expect(self.runEmit).toHaveBeenCalledWith('order', null, undefined, true);
  });
});

describe('Cambiar a consumidor final desde el cambio de titular', () => {
  it('quita el cliente de la orden y ofrece restaurar la tarifa', () => {
    const proto = OrderDetailsPageComponent.prototype as any;
    const updateOrderCustomer = jasmine
      .createSpy('updateOrderCustomer')
      .and.returnValue(of({}));
    const self: any = {
      order: () => ({ id: 7, customer_id: 42 }),
      showTitularSearchModal: signal(true),
      changingCustomer: signal(false),
      ordersService: { updateOrderCustomer },
      destroyRef: { onDestroy: () => () => undefined },
      toastService: jasmine.createSpyObj('ToastService', ['success', 'error']),
      refreshOrder: jasmine.createSpy('refreshOrder'),
      offerCustomerTier: jasmine.createSpy('offerCustomerTier'),
      handleChangeCustomerError: jasmine.createSpy('handleChangeCustomerError'),
    };
    proto.onTitularSearchUseFinalConsumer.call(self);
    expect(updateOrderCustomer).toHaveBeenCalledWith('7', null);
    expect(self.showTitularSearchModal()).toBeFalse();
    expect(self.toastService.success).toHaveBeenCalledWith(
      'La orden quedó a nombre de Consumidor final',
    );
    expect(self.refreshOrder).toHaveBeenCalled();
    expect(self.offerCustomerTier).toHaveBeenCalledWith(42, null);
  });
});

describe('Facturar una orden de comprador no identificado nunca queda bloqueado', () => {
  const proto = OrderDetailsPageComponent.prototype as any;
  const build = () => {
    const self: any = {
      showCreditModal: signal(false),
      creditCustomerRequired: signal(false),
      creditBalance: signal(0),
      showHolderModal: signal(false),
      holderIssue: signal(null),
      holderEmitKey: 'order',
      holderEmitCredit: undefined,
      emitAllowFinalConsumer: false,
      setEmitError: jasmine.createSpy('setEmitError'),
      toastService: jasmine.createSpyObj('ToastService', ['show', 'error']),
      runEmit: jasmine.createSpy('runEmit'),
      openChangeCustomer: jasmine.createSpy('openChangeCustomer').and.resolveTo(),
    };
    return self;
  };

  it('sin pagar y sin cliente (customer_required): abre el modal de crédito para asignar cliente, sin toast de error', () => {
    const self = build();
    const handled = proto.handleUnpaidEmitRejection.call(self, 'order', {
      errorCode: 'INVOICING_ORDER_UNPAID_001',
      details: { remaining_balance: '53000.00', credit_eligible: false, credit_blocker: 'customer_required' },
    });
    expect(handled).toBeTrue();
    expect(self.showCreditModal()).toBeTrue();
    expect(self.creditCustomerRequired()).toBeTrue();
    expect(self.creditBalance()).toBe(53000);
    expect(self.toastService.show).not.toHaveBeenCalled();
    expect(self.toastService.error).not.toHaveBeenCalled();
  });

  it('sin pagar con cliente: abre el modal de crédito normal', () => {
    const self = build();
    proto.handleUnpaidEmitRejection.call(self, 'order', {
      errorCode: 'INVOICING_ORDER_UNPAID_001',
      details: { remaining_balance: '100', credit_eligible: true, credit_blocker: null },
    });
    expect(self.showCreditModal()).toBeTrue();
    expect(self.creditCustomerRequired()).toBeFalse();
  });

  it('409 de titular sin customer_id (invitado): abre el modal, no sólo un toast', () => {
    const self = build();
    const handled = proto.handleHolderIncomplete.call(self, 'order', {
      errorCode: 'INVOICING_HOLDER_INCOMPLETE_001',
      details: {
        customer_id: null,
        customer_name: 'Andrea león',
        issue_code: 'missing_name',
        missing_fields: ['last_name'],
        message: 'Al comprador…',
        cf_overridable: true,
      },
    });
    expect(handled).toBeTrue();
    expect(self.showHolderModal()).toBeTrue();
    expect(self.holderIssue()?.customer_id).toBeNull();
  });

  it('«Asignar cliente» cierra los modales y abre «Cambiar cliente»', async () => {
    const self = build();
    self.showCreditModal.set(true);
    self.showHolderModal.set(true);
    await proto.onAssignCustomerForInvoice.call(self);
    expect(self.showCreditModal()).toBeFalse();
    expect(self.showHolderModal()).toBeFalse();
    expect(self.openChangeCustomer).toHaveBeenCalled();
  });

  it('completar los datos tras pedir crédito reintenta el MISMO crédito', () => {
    const self = build();
    const credit = { due_date: '2026-11-27' };
    self.holderEmitCredit = credit;
    proto.onHolderCompleted.call(self);
    expect(self.runEmit).toHaveBeenCalledWith('order', null, credit, false);
  });
});
