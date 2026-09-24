import { firstValueFrom, of } from 'rxjs';
import { PosPaymentService } from './pos-payment.service';
import { CartState } from '../models/cart.model';
import { PosShippingSaleData } from '../models/shipping.model';

describe('PosPaymentService.processShippingSale — adopted order reference', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;

  const cart = (linkedOrderId: number | null): CartState => ({
    items: [],
    customer: { id: 9, first_name: 'Cliente', last_name: 'POS' },
    summary: { subtotal: 1000, taxAmount: 0, total: 1000 },
    appliedDiscounts: [],
    linkedOrderId,
  } as unknown as CartState);

  const shipping: PosShippingSaleData = {
    shippingMethodId: 3,
    shippingCost: 500,
    deliveryType: 'home_delivery',
    shippingAddress: {
      address_line1: 'Calle 1', city: 'Bogotá', state_province: 'Bogotá',
      country_code: 'CO', recipient_name: 'Cliente POS', recipient_phone: '3000000000',
    },
  };

  beforeEach(() => {
    post = jasmine.createSpy('post').and.returnValue(of({
      data: { success: true, order: { id: 41 }, message: 'OK' },
    }));
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      {} as any,
    );
  });

  it('sends order_id for an adopted cart', async () => {
    await firstValueFrom(service.processShippingSale(cart(41), shipping, null, 'current_user'));
    expect(post.calls.mostRecent().args[1].order_id).toBe(41);
  });

  it('omits order_id for a fresh cart', async () => {
    await firstValueFrom(service.processShippingSale(cart(null), shipping, null, 'current_user'));
    expect(Object.prototype.hasOwnProperty.call(post.calls.mostRecent().args[1], 'order_id')).toBeFalse();
  });

  it('uses the shell editing id when the cart has not hydrated its link yet', async () => {
    await firstValueFrom(service.processShippingSale(
      cart(null), shipping, null, 'current_user', undefined, 57,
    ));
    expect(post.calls.mostRecent().args[1].order_id).toBe(57);
  });
});

describe('PosPaymentService.processSaleWithPayment — prior table status', () => {
  let service: PosPaymentService;
  let post: jasmine.Spy;
  const cart = {
    items: [],
    customer: null,
    summary: { subtotal: 1000, taxAmount: 0, total: 1000 },
    appliedDiscounts: [],
  } as unknown as CartState;
  const request = {
    paymentMethod: { id: '1', type: 'cash' },
    isAnonymousSale: true,
  } as any;

  beforeEach(() => {
    post = jasmine.createSpy('post');
    service = new PosPaymentService(
      { post } as any,
      { getUserId: () => 1, getStoreIdOrThrow: () => 1 } as any,
      { isEnabled: false, getRegisterId: () => null } as any,
      {} as any,
      {} as any,
    );
  });

  for (const previousStatus of ['cleaning', 'available', 'occupied', undefined] as const) {
    it(`preserves ${previousStatus ?? 'absent'} status without a second request`, async () => {
      post.and.returnValue(of({
        data: {
          success: true,
          order: { id: 1124, payment_status: 'succeeded' },
          payment: { id: 820 },
          ...(previousStatus ? { previous_table_status: previousStatus } : {}),
        },
      }));

      const result = await firstValueFrom(
        service.processSaleWithPayment(cart, request, 'current_user', null, 4),
      );

      expect(post).toHaveBeenCalledTimes(1);
      expect(post.calls.mostRecent().args[1].table_id).toBe(4);
      expect(result.previous_table_status).toBe(previousStatus);
      expect(Object.prototype.hasOwnProperty.call(result, 'previous_table_status'))
        .toBe(previousStatus !== undefined);
      expect(result.order?.id).toBe(1124);
    });
  }
});
