import { InvoiceFlowService } from './invoice-flow.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
const operation: any = {
  id: 21,
  store_id: 3,
  organization_id: 7,
  accounting_entity_id: 9,
};

describe('holder recovery accepted ledger seam', () => {
  function harness(status = 'validated') {
    const service: any = Object.create(InvoiceFlowService.prototype);
    service.prisma = {
      invoice_holder_changes: {
        findFirst: jest.fn().mockResolvedValue({ id: 21 }),
      },
    };
    service.getContext = () => ({ store_id: 3, organization_id: 7 });
    service.getInvoice = jest
      .fn()
      .mockResolvedValue({
        id: 11,
        status,
        store_id: 3,
        organization_id: 7,
        accounting_entity_id: 9,
        cufe: null,
      });
    service.fiscal_ledger = {
      findAcceptedInvoiceTransmission: jest
        .fn()
        .mockResolvedValue({
          id: 60,
          tracking_id: 'tracking',
          request_hash: 'payload-sha',
          cufe: 'accepted-key',
          accepted_at: new Date(),
        }),
    };
    service.persistAcceptedInvoiceAndContract = jest
      .fn()
      .mockImplementation(async (i: any, data: any) => ({ ...i, ...data }));
    service.event_emitter = { emit: jest.fn() };
    service.send = jest.fn();
    return service;
  }
  it.each(['validated', 'rejected'])(
    'repairs %s from definitive accepted evidence without another send or duplicate event',
    async (status) => {
      const service = harness(status);
      await expect(
        service.reconcileAcceptedFromLedger(11, operation),
      ).resolves.toMatchObject({ status: 'accepted', cufe: 'accepted-key' });
      expect(service.send).not.toHaveBeenCalled();
      expect(service.event_emitter.emit).not.toHaveBeenCalled();
    },
  );
  it('rejects missing evidence/hash and foreign operation without changing public transitions', async () => {
    const service = harness();
    service.fiscal_ledger.findAcceptedInvoiceTransmission.mockResolvedValue({
      tracking_id: 'tracking',
      cufe: 'key',
    });
    await expect(
      service.reconcileAcceptedFromLedger(11, operation),
    ).rejects.toBeDefined();
    expect(service.persistAcceptedInvoiceAndContract).not.toHaveBeenCalled();
    service.prisma.invoice_holder_changes.findFirst.mockResolvedValue(null);
    await expect(
      service.reconcileAcceptedFromLedger(11, operation),
    ).rejects.toBeDefined();
  });
  it('accepted replay does not reemit fiscal effects', async () => {
    const service = harness('accepted');
    await service.reconcileAcceptedFromLedger(11, operation);
    expect(service.persistAcceptedInvoiceAndContract).not.toHaveBeenCalled();
  });
});
