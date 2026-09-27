import { of } from 'rxjs';
import { signal } from '@angular/core';
import { PosPaymentStepComponent } from './pos-payment-step.component';

describe('PosPaymentStepComponent — B.5 cleaning warning', () => {
  const originalRegister = localStorage.getItem('pos_register_id');

  afterAll(() => {
    if (originalRegister === null) localStorage.removeItem('pos_register_id');
    else localStorage.setItem('pos_register_id', originalRegister);
  });

  for (const scenario of [
    { status: 'cleaning', paymentStatus: 'succeeded', warning: true },
    { status: 'available', paymentStatus: 'succeeded', warning: false },
    { status: 'occupied', paymentStatus: 'succeeded', warning: false },
    { status: undefined, paymentStatus: 'succeeded', warning: false },
    { status: 'cleaning', paymentStatus: 'pending', warning: false },
  ]) {
    it(`warns=${scenario.warning} for ${scenario.status ?? 'reused'} / ${scenario.paymentStatus}`, () => {
      localStorage.setItem('pos_register_id', 'TEST-POS');
      const warning = jasmine.createSpy('warning');
      const completed = jasmine.createSpy('completed');
      const charge = jasmine.createSpy('charge').and.returnValue(of({
        success: true,
        order: { id: 1124, payment_status: scenario.paymentStatus },
        payment: { id: 820 },
        previous_table_status: scenario.status,
      }));
      const step = {
        cartState: () => ({ summary: { total: 1000 }, customer: null }),
        authFacade: { isRestaurant: () => false },
        autoExecute: () => true,
        checkoutIntent: () => 'pickup',
        collectSerialsBeforeCharge: () => false,
        needsImmediateSerialCapture: () => false,
        cartWithConfirmedSerials: () => ({ summary: { total: 1000 }, customer: null, items: [] }),
        isAlias: () => false,
        isAnonymous: () => true,
        isWithinBusinessHours: () => true,
        processing: { set: jasmine.createSpy('processing') },
        submittedWompiSubMethod: { set: jasmine.createSpy('submethod') },
        editingOrderId: () => null,
        paymentService: { processSaleWithPayment: charge },
        toastService: { warning, info: jasmine.createSpy('info'), show: jasmine.createSpy('show') },
        paymentCompleted: { emit: completed },
        resolveTicketPayments: () => undefined,
        destroyRef: { onDestroy: () => {} },
        sessionId: () => null,
        tableId: () => 4,
        deliveryType: () => null,
        takeawayOrder: () => false,
        fulfillment: () => 'mesa',
      };

      PosPaymentStepComponent.prototype.onCollectorSubmit.call(step as any, {
        mode: 'contado',
        method: { id: '1', type: 'cash' },
      } as any);

      expect(charge).toHaveBeenCalledTimes(1);
      expect(completed).toHaveBeenCalledTimes(1);
      expect(warning).toHaveBeenCalledTimes(scenario.warning ? 1 : 0);
    });
  }
});

describe('PosPaymentStepComponent — E.1 serial capture before immediate charge', () => {
  const item = {
    id: 'line-1', product: { id: '77', name: 'Teléfono', requires_serial_numbers: true },
    quantity: 2, variant_id: null,
  };
  const makeStep = () => {
    const charge = jasmine.createSpy('charge').and.returnValue(of({
      success: true, order: { id: 88, payment_status: 'succeeded' },
    }));
    const step = Object.assign(Object.create(PosPaymentStepComponent.prototype), {
      cartState: () => ({ items: [item], customer: { id: 1 }, summary: { total: 100 } }),
      autoExecute: () => true, checkoutIntent: () => 'pickup', fulfillment: () => 'entrega',
      tableId: () => null, sessionId: () => null, editingOrderId: () => null,
      deliveryType: () => null,
      authFacade: { isRestaurant: () => false },
      cashRegisterService: { getActiveSessionSnapshot: () => null },
      serialNumbersService: { listAvailable: () => of([]) },
      serialChoices: new Map(), serialQueue: [], pendingSerialSubmit: null,
      serialModalOpen: signal(false), serialModalProductName: signal(''),
      serialModalQuantity: signal(1), serialModalOptions: signal([]), serialModalLoading: signal(false),
      toastService: { error: jasmine.createSpy('error'), show: jasmine.createSpy('show') },
      isAlias: () => false, isAnonymous: () => false, isWithinBusinessHours: () => true,
      cashRegisterEnabled: () => false, autoCreateDefaultRegister: () => true,
      processing: signal(false), submittedWompiSubMethod: signal(null),
      paymentService: { processSaleWithPayment: charge },
      paymentCompleted: { emit: jasmine.createSpy('emit') },
      takeawayOrder: () => true, destroyRef: { onDestroy: () => {} },
    });
    return { step, charge };
  };

  it('opens the existing serial modal and only charges after exactly two serials', () => {
    const oldRegister = localStorage.getItem('pos_register_id');
    localStorage.setItem('pos_register_id', 'TEST-POS');
    try {
      const { step, charge } = makeStep();
      const submit = { mode: 'contado', method: { id: '1', type: 'cash' } } as any;
      step.onCollectorSubmit(submit);
      expect(step.serialModalOpen()).toBeTrue();
      expect(step.serialModalQuantity()).toBe(2);
      expect(charge).not.toHaveBeenCalled();
      step.onSerialConfirmed({ serialIds: [1], freeTextSerials: [] });
      expect(charge).not.toHaveBeenCalled();
      step.onSerialConfirmed({ serialIds: [1], freeTextSerials: ['IMEI-2'] });
      expect(charge).toHaveBeenCalledTimes(1);
      expect(charge.calls.mostRecent().args[0].items[0]).toEqual(jasmine.objectContaining({
        serial_ids: [1], serial_numbers: ['IMEI-2'],
      }));
    } finally {
      if (oldRegister == null) localStorage.removeItem('pos_register_id');
      else localStorage.setItem('pos_register_id', oldRegister);
    }
  });

  it('canceling serial capture never charges', () => {
    const { step, charge } = makeStep();
    step.onCollectorSubmit({ mode: 'contado', method: { id: '1', type: 'cash' } } as any);
    step.onSerialCancelled();
    expect(step.serialModalOpen()).toBeFalse();
    expect(charge).not.toHaveBeenCalled();
  });

  it('asks for stock units rather than package count', () => {
    const { step, charge } = makeStep();
    step.cartState = () => ({
      items: [{ ...item, units_per_package: 6 }],
      customer: { id: 1 }, summary: { total: 100 },
    });
    step.onCollectorSubmit({ mode: 'contado', method: { id: '1', type: 'cash' } } as any);
    expect(step.serialModalQuantity()).toBe(12);
    expect(charge).not.toHaveBeenCalled();
  });

  for (const submit of [
    { mode: 'credito' },
    { mode: 'contado', method: { id: '2', type: 'wompi' } },
    { mode: 'contado', method: { id: '3', type: 'wallet' } },
  ]) {
    it(`explains why ${submit.mode}/${submit.method?.type ?? 'credit'} cannot instantly deliver a serial`, () => {
      const { step, charge } = makeStep();
      step.onCollectorSubmit(submit as any);
      expect(step.toastService.error).toHaveBeenCalledWith(jasmine.stringMatching('pago inmediato'));
      expect(step.serialModalOpen()).toBeFalse();
      expect(charge).not.toHaveBeenCalled();
    });
  }
});

describe('PosPaymentStepComponent — tip contract', () => {
  const originalRegister = localStorage.getItem('pos_register_id');
  afterAll(() => {
    if (originalRegister == null) localStorage.removeItem('pos_register_id');
    else localStorage.setItem('pos_register_id', originalRegister);
  });

  const makeStep = (editingOrderId: number | null = null) => {
    const charge = jasmine.createSpy('charge').and.returnValue(of({
      success: true, order: { id: 42 }, payment: { id: 77 },
    }));
    const flowPayOrder = jasmine.createSpy('flowPayOrder').and.returnValue(of({
      order: { id: 42, state: 'paid' }, payment: { id: 77 },
    }));
    const digital = jasmine.createSpy('processExistingDigitalTip').and.returnValue(of({
      success: true, order: { id: 42 }, payment: { id: 77, state: 'succeeded' },
    }));
    const step = Object.assign(Object.create(PosPaymentStepComponent.prototype), {
      cartState: () => ({ items: [], customer: null, summary: { total: 1000 } }),
      cartWithConfirmedSerials: () => ({ items: [], customer: null, summary: { total: 1000 } }),
      authFacade: { isRestaurant: () => true },
      autoExecute: () => true, checkoutIntent: () => 'pickup',
      collectSerialsBeforeCharge: () => false,
      needsImmediateSerialCapture: () => false,
      isAlias: () => false, isAnonymous: () => true,
      isWithinBusinessHours: () => true,
      cashRegisterEnabled: () => false, autoCreateDefaultRegister: () => true,
      editingOrderId: () => editingOrderId,
      paymentService: { processSaleWithPayment: charge, processExistingDigitalTip: digital },
      ordersService: { flowPayOrder },
      processing: signal(false), submittedWompiSubMethod: signal(null),
      toastService: { info: jasmine.createSpy('info'), show: jasmine.createSpy('show') },
      sessionId: () => null, tableId: () => null, takeawayOrder: () => false,
      deliveryType: () => null, fulfillment: () => 'entrega',
      paymentCompleted: { emit: jasmine.createSpy('emit') },
      destroyRef: { onDestroy: () => {} },
    });
    return { step, charge, flowPayOrder, digital };
  };

  it('carries resolved tip and waiter to a fresh POS payment', () => {
    const { step, charge } = makeStep();
    step.onCollectorSubmit({
      mode: 'contado', method: { id: '1', type: 'cash' }, amountReceived: 1100,
      tip: 100, tipType: 'fixed', tipValue: 100, tipWaiterId: 7,
    } as any);
    expect(charge.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      tip_amount: 100, tip_type: 'fixed', tip_value: 100, tip_waiter_id: 7,
    }));
  });

  it('carries tip to flow/pay for an edited draft', () => {
    const { step, flowPayOrder } = makeStep(42);
    step.onCollectorSubmit({
      mode: 'contado', method: { id: '1', type: 'cash' },
      tip: 100, tipType: 'fixed', tipValue: 100, tipWaiterId: 7,
    } as any);
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      amount: 1100, tip_amount: 100, tip_type: 'fixed', tip_value: 100, tip_waiter_id: 7,
    }));
  });

  it('clears a previously reserved tip when the edited order is retried without one', () => {
    const { step, flowPayOrder } = makeStep(42);
    step.onCollectorSubmit({ mode: 'contado', method: { id: '1', type: 'cash' } } as any);
    expect(flowPayOrder.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      tip_amount: 0, tip_type: 'fixed', tip_value: 0,
    }));
  });

  it('routes a tipped edited Wompi order through the reserved digital processor', () => {
    const { step, flowPayOrder, digital } = makeStep(42);
    step.onCollectorSubmit({
      mode: 'contado', method: { id: '5', type: 'wompi' },
      tip: 100, tipType: 'fixed', tipValue: 100,
      wompi: { subMethod: 'NEQUI', payload: { type: 'NEQUI' } },
    } as any);
    expect(flowPayOrder).not.toHaveBeenCalled();
    expect(digital.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({
      tip_amount: 100, metadata: jasmine.objectContaining({
        wompiPaymentMethod: { type: 'NEQUI' },
      }),
    }));
  });
});
