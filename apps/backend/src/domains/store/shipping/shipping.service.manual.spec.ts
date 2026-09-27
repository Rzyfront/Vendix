import { ShippingService } from './shipping.service';
import { VendixHttpException } from 'src/common/errors';

describe('ShippingService.quoteManualShipping', () => {
  const prisma = {
    shipping_rates: { findFirst: jest.fn() },
  };
  const tax = { chargeForRate: jest.fn() };
  const service = new ShippingService(prisma as any, tax as any);

  beforeEach(() => jest.clearAllMocks());

  it('quotes an additive rate as base plus tax using the store-owned rate', async () => {
    prisma.shipping_rates.findFirst.mockResolvedValue({ id: 9 });
    tax.chargeForRate.mockResolvedValue({
      applies: true, reason: 'exclusive', gross: 11900, base: 10000, tax: 1900,
    });

    await expect(service.quoteManualShipping(1, 5, 9, 10000)).resolves.toEqual({
      shipping_rate_id: 9, manual_shipping_price: 10000,
      shipping_cost: 11900, base: 10000, shipping_tax_amount: 1900,
      tax_is_inclusive: false,
    });
    expect(prisma.shipping_rates.findFirst).toHaveBeenCalledWith({
      where: {
        id: 9, shipping_method_id: 5, is_active: true,
        shipping_method: { store_id: 1, is_active: true },
        shipping_zone: { is_active: true, OR: [{ store_id: 1 }, { is_system: true, store_id: null }] },
      },
      select: { id: true },
    });
    expect(tax.chargeForRate).toHaveBeenCalledWith(null, 9, 10000, { store_id: 1 });
  });

  it('rejects an inactive or foreign rate before calculating any amount', async () => {
    prisma.shipping_rates.findFirst.mockResolvedValue(null);
    await expect(service.quoteManualShipping(1, 5, 9, 10000))
      .rejects.toBeInstanceOf(VendixHttpException);
    expect(tax.chargeForRate).not.toHaveBeenCalled();
  });
});
