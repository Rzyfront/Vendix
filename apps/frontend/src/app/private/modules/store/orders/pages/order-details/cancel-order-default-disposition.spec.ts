import { signal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';
import { of, throwError } from 'rxjs';
import { OrderDetailsPageComponent, cancellationBody } from './order-details-page.component';
import type { Order } from '../../interfaces/order.interface';
import type { KitchenDisposition } from '../../services/store-orders.service';

describe('OrderDetailsPageComponent — reusar en cancelación de varios platos', () => {
  function setup(advancedItems: number) {
    const cancel = jasmine.createSpy('flowCancelOrder').and.returnValue(of({}));
    const component = Object.assign(Object.create(OrderDetailsPageComponent.prototype), {
      order: signal({ cancellation_policy: { can_cancel: true } } as unknown as Order),
      orderId: '42',
      cancelForm: new FormGroup({ reason: new FormControl('', [Validators.required, Validators.minLength(3)]) }),
      cancelKitchenDisposition: signal<KitchenDisposition | null>(null),
      cancelRequiresDisposition: signal(advancedItems > 0),
      showCancelModal: signal(false),
      isProcessingAction: signal(false),
      ordersService: { flowCancelOrder: cancel },
      toastService: { success: jasmine.createSpy(), warning: jasmine.createSpy() },
      destroyRef: { onDestroy: () => () => undefined },
      loadData: jasmine.createSpy(),
    }) as OrderDetailsPageComponent;
    return { component, cancel };
  }

  for (const count of [1, 3]) {
    it(`preselecciona y envía reusar al cancelar ${count} plato(s)`, () => {
      const { component, cancel } = setup(count);
      component.openCancelModal();
      expect(component.cancelKitchenDisposition()).toBe('reuse');
      component.cancelForm.patchValue({ reason: 'Platos aprovechables' });
      component.submitCancellation();
      expect(cancel).toHaveBeenCalledWith('42', {
        reason: 'Platos aprovechables', kitchenDisposition: 'reuse',
      });
    });
  }

  it('respeta merma elegida por el usuario y vuelve a reusar en la siguiente apertura', () => {
    const { component, cancel } = setup(3);
    component.openCancelModal();
    component.selectCancelDisposition('waste');
    component.cancelForm.patchValue({ reason: 'Platos contaminados' });
    component.submitCancellation();
    expect(cancel).toHaveBeenCalledWith('42', {
      reason: 'Platos contaminados', kitchenDisposition: 'waste',
    });
    component.openCancelModal();
    expect(component.cancelKitchenDisposition()).toBe('reuse');
  });

  it('no manda disposición en órdenes sin platos avanzados ni cambia su reintegro automático', () => {
    const { component, cancel } = setup(0);
    component.openCancelModal();
    component.cancelForm.patchValue({ reason: 'Error de comanda' });
    component.submitCancellation();
    expect(cancel).toHaveBeenCalledWith('42', { reason: 'Error de comanda' });
  });

  it('el reuso preseleccionado conserva el contrato de cancelación y reversa por ítem', () => {
    expect(cancellationBody('cancel', 'Plato aprovechable', 'reuse', true))
      .toEqual({ reason: 'Plato aprovechable', cancellation_type: 'after_fire_reused' });
    expect(cancellationBody('reverse', 'Plato aprovechable', 'reuse', true))
      .toEqual({ reason: 'Plato aprovechable', destination: 'restock' });
  });
});

describe('OrderDetailsPageComponent — cod-auto-invoicing S5 nota crédito total al cancelar', () => {
  const blocked = {
    error: {
      error_code: 'ORD_CANCEL_CREDIT_NOTE_REQUIRED_001',
      message: 'La orden tiene la factura electrónica FE-12 aceptada por la DIAN',
      details: { invoice_id: 9, invoice_number: 'FE-12' },
    },
  };

  function setup(confirmed: boolean) {
    const cancel = jasmine.createSpy('flowCancelOrder').and.callFake(
      (_id: string, body: { issueCreditNote?: boolean }) =>
        body.issueCreditNote ? of({}) : throwError(() => blocked),
    );
    const confirm = jasmine.createSpy('confirm').and.resolveTo(confirmed);
    const toast = { success: jasmine.createSpy('success'), warning: jasmine.createSpy(), error: jasmine.createSpy('error') };
    const component = Object.assign(Object.create(OrderDetailsPageComponent.prototype), {
      order: signal({ cancellation_policy: { can_cancel: true } } as unknown as Order),
      orderId: '42',
      cancelForm: new FormGroup({ reason: new FormControl('', [Validators.required, Validators.minLength(3)]) }),
      cancelKitchenDisposition: signal<KitchenDisposition | null>(null),
      cancelRequiresDisposition: signal(false),
      showCancelModal: signal(false),
      isProcessingAction: signal(false),
      ordersService: { flowCancelOrder: cancel },
      dialogService: { confirm },
      toastService: toast,
      destroyRef: { onDestroy: () => () => undefined },
      loadData: jasmine.createSpy(),
    }) as OrderDetailsPageComponent;
    return { component, cancel, confirm, toast };
  }

  it('confirma y reintenta con la nota crédito total cuando la factura está aceptada', async () => {
    const { component, cancel, confirm, toast } = setup(true);
    component.openCancelModal();
    component.cancelForm.patchValue({ reason: 'Cliente desistió' });
    component.submitCancellation();
    await Promise.resolve();
    await Promise.resolve();

    expect(confirm).toHaveBeenCalledWith(jasmine.objectContaining({
      confirmText: 'Emitir nota crédito y cancelar',
    }));
    expect(cancel.calls.mostRecent().args).toEqual(['42', {
      reason: 'Cliente desistió', issueCreditNote: true,
    }]);
    expect(toast.success).toHaveBeenCalledWith('Nota crédito emitida y orden cancelada');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('no emite nada si el usuario vuelve atrás', async () => {
    const { component, cancel, confirm } = setup(false);
    component.openCancelModal();
    component.cancelForm.patchValue({ reason: 'Cliente desistió' });
    component.submitCancellation();
    await Promise.resolve();
    await Promise.resolve();

    expect(confirm).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
