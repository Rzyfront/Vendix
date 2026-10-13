import { signal } from '@angular/core';
import { PosComponent, resolvePosPaymentCustomerName } from './pos.component';

describe('POS paid-order customer name', () => {
  it('shows the persisted alias instead of an anonymous placeholder', () => {
    expect(resolvePosPaymentCustomerName(
      { customer_alias: 'QA H3 E2E POS mesa sin IVA', customer_name: 'Consumidor Final' },
      null,
      true,
    )).toBe('QA H3 E2E POS mesa sin IVA');
  });

  it('keeps a genuinely anonymous sale as Consumidor Final', () => {
    expect(resolvePosPaymentCustomerName({}, null, true)).toBe('Consumidor Final');
  });

  it('keeps a formal customer name', () => {
    expect(resolvePosPaymentCustomerName(
      { customer_name: 'Ana Gómez' },
      { first_name: 'Ana', last_name: 'Gómez' },
      false,
    )).toBe('Ana Gómez');
  });
});

describe('POS dispatch ticket after successful checkout callbacks', () => {
  const createCallbackHarness = () => {
    const component = Object.create(PosComponent.prototype) as any;
    const dispatchTicketPrint = {
      printFromPos: jasmine
        .createSpy('printFromPos')
        .and.returnValue(Promise.resolve(null)),
    };
    Object.assign(component, {
      cartState: signal({
        items: [{ product: { id: '1', name: 'Producto' }, quantity: 1, unitPrice: 100, totalPrice: 100 }],
      }),
      loading: signal(false),
      showCheckoutModal: signal(true),
      paymentFulfillment: signal(null),
      paymentTableId: signal(null),
      currentOrderId: signal(null),
      currentOrderNumber: signal(null),
      completedOrder: signal(null),
      showOrderConfirmation: signal(false),
      productRefreshCounter: signal(0),
      selectedCustomer: signal(null),
      editingOrderId: signal(22),
      editingOrder: signal({ id: 22 }),
      readyToPayOrder: signal({ id: 22 }),
      mode: signal('create-payment'),
      initialEntrega: signal(null),
      cartSummary: () => ({ subtotal: 100, taxAmount: 0, discountAmount: 0, total: 100 }),
      firePendingBookingsAfterDraft: jasmine.createSpy('firePendingBookingsAfterDraft'),
      toastService: { success: jasmine.createSpy('success') },
      clearCartAfterCompletedSale: jasmine.createSpy('clearCartAfterCompletedSale'),
      focusSearchSoon: jasmine.createSpy('focusSearchSoon'),
      resolveDefaultEntrega: () => 'consumo',
      restaurantIntegration: { clearTableSession: jasmine.createSpy('clearTableSession') },
      settingsFacade: {
        receipts: () => ({ print_dispatch_ticket_on_counter: true }),
      },
      authFacade: { getCurrentUser: () => ({ store: { name: 'Tienda POS' } }) },
      dispatchTicketPrint,
    });
    return { component, dispatchTicketPrint };
  };

  const settledOrder = () => ({
    id: 41,
    order_number: 'POS-41',
    created_at: '2026-10-10T12:00:00.000Z',
    state: 'finished',
    payment_status: 'paid',
    delivery_type: 'dine_in',
    grand_total: '119.25',
    total_paid: '119.25',
    remaining_balance: '0',
    items: [],
  });

  it('does not request a dispatch ticket when payment or shipping reports failure', () => {
    const payment = createCallbackHarness();
    const shipping = createCallbackHarness();

    payment.component.onPaymentCompleted({ success: false, order: settledOrder() });
    shipping.component.onShippingCompleted({ success: false, order: settledOrder() });

    expect(payment.dispatchTicketPrint.printFromPos).not.toHaveBeenCalled();
    expect(shipping.dispatchTicketPrint.printFromPos).not.toHaveBeenCalled();
  });

  it('passes the raw successful payment snapshot and counter context to the sale policy', () => {
    const { component, dispatchTicketPrint } = createCallbackHarness();
    const order = settledOrder();

    component.onPaymentCompleted({ success: true, order });

    expect(dispatchTicketPrint.printFromPos).toHaveBeenCalledWith(
      jasmine.objectContaining({ orderId: order.id }),
      jasmine.objectContaining({
        origin: 'sale_completed',
        order,
        counterEnabled: true,
      }),
    );
  });

  it('passes the raw successful shipping snapshot and rejects a successful response without an order', () => {
    const shipping = createCallbackHarness();
    const missingPaymentOrder = createCallbackHarness();
    const missingShippingOrder = createCallbackHarness();
    const order = { ...settledOrder(), delivery_type: 'home_delivery' };

    shipping.component.onShippingCompleted({ success: true, order });
    missingPaymentOrder.component.onPaymentCompleted({ success: true });
    missingShippingOrder.component.onShippingCompleted({ success: true });

    expect(shipping.dispatchTicketPrint.printFromPos).toHaveBeenCalledWith(
      jasmine.objectContaining({ orderId: order.id }),
      jasmine.objectContaining({
        origin: 'sale_completed',
        order,
        counterEnabled: true,
      }),
    );
    expect(missingPaymentOrder.dispatchTicketPrint.printFromPos).not.toHaveBeenCalled();
    expect(missingShippingOrder.dispatchTicketPrint.printFromPos).not.toHaveBeenCalled();
  });
});

describe('POS Guardar al modificar un borrador', () => {
  const editor = () => {
    // These entrypoints only read component signals and invoke the existing
    // editor seam. A lightweight instance keeps this regression independent
    // of unrelated POS template/services.
    const component = Object.create(PosComponent.prototype) as PosComponent;
    Object.assign(component, {
      cartState: signal({ items: [{ product: { id: '1' }, quantity: 1 }] }),
      isEditMode: signal(true),
      loading: signal(false),
      showCartModal: signal(true),
      showCheckoutModal: signal(false),
      mode: signal<'create-draft' | 'edit' | 'create-payment'>('edit'),
      toastService: { warning: jasmine.createSpy('warning') },
    });
    return component;
  };

  it('Guardar actualiza la orden existente sin abrir el wizard de creación', () => {
    const component = editor();
    const update = spyOn<any>(component, 'updateExistingOrder').and.stub();

    component.onSaveDraft();

    expect(update).toHaveBeenCalledTimes(1);
    expect(component.showCheckoutModal()).toBeFalse();
    expect(component.mode()).toBe('edit');
    expect(component.showCartModal()).toBeFalse();
  });

  it('Crear/Guardar del carrito usa la misma actualización al editar', () => {
    const component = editor();
    const update = spyOn<any>(component, 'updateExistingOrder').and.stub();

    component.onOpenCreateModal();

    expect(update).toHaveBeenCalledTimes(1);
    expect(component.showCheckoutModal()).toBeFalse();
  });

  it('no duplica la escritura si la orden todavía se está guardando', () => {
    const component = editor();
    component.loading.set(true);
    const update = spyOn<any>(component, 'updateExistingOrder').and.stub();

    component.onSaveDraft();

    expect(update).not.toHaveBeenCalled();
  });

  it('preserva alias y envío existentes sin forzar cliente ni re-cotizar', () => {
    const component = editor();
    Object.assign(component, {
      editingOrder: signal({ customer_id: null, customer_alias: 'Casa azul' }),
      cartBookingsFromChild: null,
    });
    const state = {
      items: [{ product: { id: '1', name: 'Producto', sku: 'SKU-1' },
        quantity: 1, unitPrice: 1000, finalPrice: 1000, taxAmount: 0 }],
      customer: null,
      appliedDiscounts: [],
      shippingContext: { deliveryType: 'home_delivery', shippingCost: 15000 },
    } as any;

    const payload = (component as any).buildEditorRequest(state);

    expect(payload.customer_id).toBeNull();
    expect(payload.customer_alias).toBe('Casa azul');
    expect(payload.shipping_cost).toBeUndefined();
    expect(payload.delivery_type).toBeUndefined();
  });
});
