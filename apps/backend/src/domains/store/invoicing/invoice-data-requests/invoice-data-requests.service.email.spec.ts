import { InvoiceDataRequestsService } from './invoice-data-requests.service';

describe('InvoiceDataRequestsService email persistence', () => {
  const createService = () => {
    const request = {
      id: 7,
      token: 'token',
      store_id: 2,
      order_id: 30,
      status: 'pending',
      expires_at: new Date(Date.now() + 86_400_000),
    };
    const prisma = {
      invoice_data_requests: {
        findUnique: jest.fn().mockResolvedValue(request),
        create: jest
          .fn()
          .mockImplementation(async ({ data }) => ({ ...request, ...data })),
        update: jest
          .fn()
          .mockImplementation(async ({ data }) => ({ ...request, ...data })),
      },
    };
    const service = new InvoiceDataRequestsService(
      prisma as never,
      { emit: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  };

  it('normalizes email captured from checkout before storing a request', async () => {
    const { service, prisma } = createService();
    await service.createRequest(2, 30, undefined, {
      email: '  ANA@Example.COM ',
    });
    expect(prisma.invoice_data_requests.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: 'ana@example.com' }),
    });
  });

  it('normalizes email submitted from the public form', async () => {
    const { service, prisma } = createService();
    await service.submitData('token', {
      first_name: 'Ana',
      last_name: 'Diaz',
      document_type: 'CC',
      document_number: '123',
      email: '  ANA@Example.COM ',
    });
    expect(prisma.invoice_data_requests.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ email: 'ana@example.com' }),
    });
  });

  it.each([null, undefined])(
    'preserves optional form email %p',
    async (email) => {
      const { service, prisma } = createService();
      await service.submitData('token', {
        first_name: 'Ana',
        last_name: 'Diaz',
        document_type: 'CC',
        document_number: '123',
        email,
      } as never);
      expect(prisma.invoice_data_requests.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({ email }),
      });
    },
  );
});
