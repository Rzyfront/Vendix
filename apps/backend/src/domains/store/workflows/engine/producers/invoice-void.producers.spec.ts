import { Prisma } from '@prisma/client';
import { InvoiceFlowService } from '../../../invoicing/invoice-flow/invoice-flow.service';
import { recordTriggerEvent } from '../workflow-trigger.outbox';
import { runAsStoreAdmin, transactionOf } from './producers.test-util';

jest.mock('../workflow-trigger.outbox', () => ({
  recordTriggerEvent: jest.fn().mockResolvedValue(true),
}));

const record = recordTriggerEvent as jest.Mock;

describe('Flujos P1.1 producer: invoice.voided (InvoiceFlowService.void)', () => {
  const invoice = {
    id: 40,
    store_id: 11,
    invoice_type: 'sales_invoice',
    invoice_number: 'FV-40',
    status: 'rejected',
    accounting_entity_id: 1,
    issue_date: new Date('2026-11-01T00:00:00Z'),
    total_amount: new Prisma.Decimal(250),
  };

  const build = () => {
    const tx = {
      invoices: {
        update: jest.fn().mockResolvedValue({ ...invoice, status: 'voided' }),
      },
    };
    const prisma = {
      $transaction: transactionOf(tx),
      invoices: { findFirst: jest.fn().mockResolvedValue(invoice) },
    };
    const service = new InvoiceFlowService(
      prisma as never,
      {} as never,
      { emit: jest.fn() } as never,
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
    jest
      .spyOn(
        service as unknown as { assertFiscalPeriodOpen: () => Promise<void> },
        'assertFiscalPeriodOpen',
      )
      .mockResolvedValue(undefined);
    return { tx, service };
  };

  beforeEach(() => record.mockClear());

  it('records the event with the transaction client of the status write', async () => {
    const { tx, service } = build();
    await runAsStoreAdmin(() => service.void(40));
    expect(tx.invoices.update).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(tx, 'invoice.voided', {
      store_id: 11,
      invoice_id: 40,
      invoice_number: 'FV-40',
      total_amount: invoice.total_amount,
      reason: null,
    });
  });

  it('fails the void when the outbox write fails', async () => {
    const { service } = build();
    record.mockRejectedValueOnce(new Error('outbox down'));
    await expect(runAsStoreAdmin(() => service.void(40))).rejects.toThrow(
      'outbox down',
    );
  });

  it('records nothing when the transition is refused', async () => {
    const { service } = build();
    const prisma = (service as unknown as {
      prisma: { invoices: { findFirst: jest.Mock } };
    }).prisma;
    prisma.invoices.findFirst.mockResolvedValue({ ...invoice, status: 'accepted' });
    await expect(runAsStoreAdmin(() => service.void(40))).rejects.toBeDefined();
    expect(record).not.toHaveBeenCalled();
  });
});
