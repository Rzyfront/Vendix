import { CheckoutService } from './checkout.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('Checkout guest capabilities independent from fiscal demand', () => {
  let service: any, guest: any, links: any, invoice: any;
  beforeEach(() => {
    service = Object.create(CheckoutService.prototype);
    guest = {
      resolve: jest
        .fn()
        .mockResolvedValue({ order_id: 4, store_id: 2, organization_id: 1 }),
    };
    links = { getLinkForInvoice: jest.fn().mockResolvedValue(null) };
    invoice = jest.fn().mockResolvedValue(null);
    Object.assign(service, {
      guestOrderAccess: guest,
      holderLinks: links,
      createInvoiceIfConfigured: invoice,
      store_prisma: {
        orders: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              public_access_token: '550e8400-e29b-41d4-a716-446655440000',
            }),
        },
      },
      invoiceDataRequestsService: { createRequest: jest.fn() },
    });
    jest.spyOn(RequestContextService, 'getStoreId').mockReturnValue(2);
    jest
      .spyOn(RequestContextService, 'getUserId')
      .mockReturnValue(undefined as any);
  });
  afterEach(() => jest.restoreAllMocks());
  it('guest without FE still gets purchase capability and no request', async () => {
    expect(await service.createGuestOrderArtifacts(4)).toMatchObject({
      public_order_token: '550e8400-e29b-41d4-a716-446655440000',
      invoice_data_token: null,
      invoice_id: null,
    });
    expect(invoice).toHaveBeenCalledWith(4);
    expect(links.getLinkForInvoice).not.toHaveBeenCalled();
    expect(
      service.invoiceDataRequestsService.createRequest,
    ).not.toHaveBeenCalled();
  });
  it('preserves auto invoice creation and only attaches eligible signed link', async () => {
    invoice.mockResolvedValue(5);
    links.getLinkForInvoice.mockResolvedValue({
      token: 'cfh1.signed',
      url: 'https://vendix.test/factura/cfh1.signed',
      expires_at: new Date('2026-11-01'),
    });
    const result = await service.createGuestOrderArtifacts(4);
    expect(result.public_order_token).not.toEqual(result.invoice_data_token);
    expect(result.invoice_data_token).toBe('cfh1.signed');
    expect(invoice).toHaveBeenCalledTimes(1);
    expect(
      service.invoiceDataRequestsService.createRequest,
    ).not.toHaveBeenCalled();
  });
  it('Wompi/confirmation authorize token binding to the requested order and current storefront', async () => {
    await expect(
      service.assertOrderAccess(4, null, 'uuid'),
    ).resolves.toBeUndefined();
    expect(guest.resolve).toHaveBeenCalledWith('uuid', 2);
    guest.resolve.mockResolvedValue({ order_id: 99, store_id: 2 });
    await expect(service.assertOrderAccess(4, null, 'uuid')).rejects.toThrow();
  });
  it('guest access cannot fall back to staff/customer identity without capability', async () => {
    await expect(service.assertOrderAccess(4, null)).rejects.toThrow();
    expect(guest.resolve).not.toHaveBeenCalled();
  });
});
