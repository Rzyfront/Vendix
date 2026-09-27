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
