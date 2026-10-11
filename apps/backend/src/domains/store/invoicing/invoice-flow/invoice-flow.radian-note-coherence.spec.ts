import { InvoiceFlowService } from './invoice-flow.service';

describe('InvoiceFlowService RADIAN acceptance guard', () => {
  it.each(['033', '034'])('blocks send before provider side effects when related invoice has accepted event %s', async (event_code) => {
    const note = {
      id: 5, invoice_type: 'credit_note', related_invoice_id: 12,
      organization_id: 1, store_id: 2, accounting_entity_id: 3,
    };
    const original = { id: 12, organization_id: 1, store_id: 2, accounting_entity_id: 3 };
    const invoices = {
      findFirst: jest.fn(async ({ where }: { where: { id: number } }) => where.id === note.id ? note : original),
    };
    const dian_document_events = {
      findFirst: jest.fn().mockResolvedValue({ id: 50, event_code }),
    };
    const prisma = { invoices, dian_document_events };
    const resolver = { resolve: jest.fn() };
    const service = new InvoiceFlowService(
      prisma as never,
      resolver as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.send(5)).rejects.toMatchObject({ errorCode: 'INVOICING_STATUS_002' });
    expect(invoices.findFirst).toHaveBeenCalledTimes(2);
    expect(dian_document_events.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        invoice_id: 12, organization_id: 1, OR: [{ store_id: 2 }, { store_id: null }],
        event_code: { in: ['033', '034'] }, status: 'accepted',
      }),
    }));
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
