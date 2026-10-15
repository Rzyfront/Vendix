import { PosFiscalEmissionService } from './pos-fiscal-emission.service';
describe('POS fiscal late holder link', () => {
  let service: any, prisma: any, links: any;
  beforeEach(() => {
    service = Object.create(PosFiscalEmissionService.prototype);
    prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue({ id: 5, store_id: 2 }),
      },
      invoice_data_requests: { create: jest.fn(), findFirst: jest.fn() },
    };
    links = { getLinkForInvoice: jest.fn().mockResolvedValue(null) };
    Object.assign(service, { prisma, holderLinks: links });
  });
  it('does not invent a request/token while FE is absent or ineligible', async () => {
    prisma.invoices.findFirst.mockResolvedValue(null);
    expect(await service.findInvoiceDataLink(4)).toEqual({
      invoice_data_token: null,
      invoice_data_url: null,
      invoice_data_expires_at: null,
    });
    expect(prisma.invoice_data_requests.create).not.toHaveBeenCalled();
    expect(prisma.invoice_data_requests.findFirst).not.toHaveBeenCalled();
  });
  it('returns canonical signed link after existing invoice becomes eligible', async () => {
    const expiry = new Date('2026-11-01');
    links.getLinkForInvoice.mockResolvedValue({
      token: 'signed',
      url: 'https://vendix.test/factura/signed',
      expires_at: expiry,
    });
    expect(await service.findInvoiceDataLink(4)).toEqual({
      invoice_data_token: 'signed',
      invoice_data_url: 'https://vendix.test/factura/signed',
      invoice_data_expires_at: expiry,
    });
    expect(links.getLinkForInvoice).toHaveBeenCalledWith(5, 2);
    expect(prisma.invoice_data_requests.create).not.toHaveBeenCalled();
  });
});
