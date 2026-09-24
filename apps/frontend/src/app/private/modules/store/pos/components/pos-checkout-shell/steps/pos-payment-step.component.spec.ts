import { of } from 'rxjs';
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
        isAlias: () => false,
        isAnonymous: () => true,
        isWithinBusinessHours: () => true,
        processing: { set: jasmine.createSpy('processing') },
        submittedWompiSubMethod: { set: jasmine.createSpy('submethod') },
        editingOrderId: () => null,
        paymentService: { processSaleWithPayment: charge },
        toastService: { warning, info: jasmine.createSpy('info'), show: jasmine.createSpy('show') },
        paymentCompleted: { emit: completed },
        destroyRef: { onDestroy: () => {} },
        sessionId: () => null,
        tableId: () => 4,
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
