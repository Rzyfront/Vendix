import { VendixHttpException } from '../../../../common/errors';
import {
  PlatformInvoicePaymentsService,
  computeCollectionStatus,
  derivePlatformInvoiceState,
} from './platform-invoice-payments.service';

function build(opts: {
  total: number;
  dianStatus?: string;
  transmissionStatus?: string;
  due_date?: string;
  found?: boolean;
}) {
  const evidences: any[] = [];
  let nextId = 100;
  const transmission =
    opts.found === false
      ? null
      : {
          id: 7,
          organization_id: 1,
          accounting_entity_id: 5,
          document_number: 'VNDS3',
          dian_status: opts.dianStatus ?? 'accepted',
          transmission_status: opts.transmissionStatus ?? 'accepted',
        };
  const snapshot = {
    metadata: {
      kind: 'platform_invoice_snapshot',
      totals: { total: opts.total },
      due_date: opts.due_date ?? '2099-01-01',
    },
  };
  const client: any = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    fiscal_transmissions: { findFirst: jest.fn().mockResolvedValue(transmission) },
    fiscal_evidences: {
      findFirst: jest.fn().mockResolvedValue(snapshot),
      findMany: jest.fn(async () => [...evidences].reverse()),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nextId++, created_at: new Date(), ...data };
        evidences.push(row);
        return row;
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    accounting_entries: { findFirst: jest.fn().mockResolvedValue({ id: 900 }) },
  };
  const prisma: any = {
    ...client,
    withoutScope: () => client,
    $transaction: (fn: any) => fn(client),
  };
  const emitter: any = { emitAsync: jest.fn().mockResolvedValue([]) };
  const service = new PlatformInvoicePaymentsService(prisma, emitter);
  return { service, emitter, client, evidences };
}

const dto = (amount: number) => ({
  amount,
  paid_at: '2026-10-01',
  payment_method: 'bank_transfer' as const,
});

describe('PlatformInvoicePaymentsService', () => {
  it('partial payment -> partial, emits event and links the journal entry', async () => {
    const { service, emitter, client } = build({ total: 1000 });
    const p = await service.registerPayment(7, dto(400), 3);
    expect(p.amount).toBe('400.00');
    expect(p.journal_entry_id).toBe(900);
    expect(emitter.emitAsync).toHaveBeenCalledWith(
      'platform_invoice.payment_received',
      expect.objectContaining({
        accounting_entity_id: 5,
        document_number: 'VNDS3',
        amount: 400,
        paid_at: '2026-10-01',
      }),
    );
    expect(client.fiscal_evidences.update).toHaveBeenCalled();
    const s = await service.summarize({
      transmissionId: 7,
      total: 1000,
      dueDate: '2099-01-01',
      state: 'accepted',
    });
    expect(s.collection_status).toBe('partial');
    expect(s.balance_due).toBe('600.00');
  });

  it('second payment that closes the balance -> paid, two events', async () => {
    const { service, emitter } = build({ total: 1000 });
    await service.registerPayment(7, dto(400), 3);
    await service.registerPayment(7, dto(600), 3);
    expect(emitter.emitAsync).toHaveBeenCalledTimes(2);
    const s = await service.summarize({
      transmissionId: 7,
      total: 1000,
      dueDate: '2099-01-01',
      state: 'accepted',
    });
    expect(s.collection_status).toBe('paid');
    expect(s.balance_due).toBe('0.00');
    expect(s.amount_paid).toBe('1000.00');
  });

  it('rejects a payment above the balance with 409', async () => {
    const { service, emitter } = build({ total: 1000 });
    await service.registerPayment(7, dto(999.99), 3);
    await expect(service.registerPayment(7, dto(0.02), 3)).rejects.toMatchObject({
      status: 409,
    });
    expect(emitter.emitAsync).toHaveBeenCalledTimes(1);
  });

  it('rejects a payment on a non accepted invoice with 409', async () => {
    const { service } = build({
      total: 1000,
      dianStatus: 'rejected',
      transmissionStatus: 'rejected',
    });
    const err = await service.registerPayment(7, dto(10), 3).catch((e) => e);
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.getStatus()).toBe(409);
  });

  it('404 when the transmission is not a platform invoice', async () => {
    const { service } = build({ total: 1000, found: false });
    await expect(service.registerPayment(7, dto(10), 3)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('computeCollectionStatus: overdue when due_date < today and balance > 0', () => {
    const base = {
      state: 'accepted' as const,
      totalCents: 100000,
      dueDate: '2026-01-01',
      today: '2026-10-13',
    };
    expect(computeCollectionStatus({ ...base, paidCents: 0 })).toBe('overdue');
    expect(computeCollectionStatus({ ...base, paidCents: 100000 })).toBe('paid');
    expect(
      computeCollectionStatus({ ...base, paidCents: 0, dueDate: '2026-10-13' }),
    ).toBe('pending');
    expect(
      computeCollectionStatus({ ...base, paidCents: 0, state: 'rejected' }),
    ).toBeNull();
  });

  it('derivePlatformInvoiceState maps unknown values to pending', () => {
    expect(derivePlatformInvoiceState('accepted', 'queued')).toBe('accepted');
    expect(derivePlatformInvoiceState('weird', 'queued')).toBe('pending');
    expect(derivePlatformInvoiceState('pending', 'error')).toBe('error');
  });
});
