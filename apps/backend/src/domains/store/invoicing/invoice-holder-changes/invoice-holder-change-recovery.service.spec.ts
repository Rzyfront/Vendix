import { InvoiceHolderChangeRecoveryService } from './invoice-holder-change-recovery.service';

describe('durable holder recovery scheduling', () => {
  const previousRole = process.env.VENDIX_PROCESS_ROLE;
  function harness() {
    const prisma = {
      invoice_holder_changes: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
      },
      invoice_data_requests: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
    };
    const context = {
      runInStoreContext: jest.fn(async (_store: number, work: () => unknown) =>
        work(),
      ),
    };
    const changes = {
      resume: jest.fn().mockResolvedValue({}),
      adoptLegacySubmittedRequest: jest.fn().mockResolvedValue({}),
    };
    const service = new InvoiceHolderChangeRecoveryService(
      prisma as never,
      context as never,
      changes as never,
    );
    return { service, prisma, context, changes };
  }
  beforeEach(() => {
    process.env.VENDIX_PROCESS_ROLE = 'worker';
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
    if (previousRole === undefined) delete process.env.VENDIX_PROCESS_ROLE;
    else process.env.VENDIX_PROCESS_ROLE = previousRole;
  });
  it('API-only processes do not sweep or mutate recovery state', async () => {
    process.env.VENDIX_PROCESS_ROLE = 'api';
    const { service, prisma } = harness();
    await service.recoverBatch();
    expect(prisma.invoice_holder_changes.findMany).not.toHaveBeenCalled();
  });
  it('uses due leases, bounded fair batches and excludes legitimate human waiting', async () => {
    const { service, prisma, changes, context } = harness();
    prisma.invoice_holder_changes.findMany.mockResolvedValue([
      { id: 21, store_id: 3 },
    ]);
    await service.recoverBatch();
    expect(prisma.invoice_holder_changes.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: expect.objectContaining({
          phase: { notIn: ['completed', 'awaiting_customer'] },
          run_status: {
            in: ['ready', 'running', 'waiting', 'retryable_error'],
          },
          AND: expect.arrayContaining([
            {
              OR: [
                { next_retry_at: null },
                { next_retry_at: { lte: expect.any(Date) } },
              ],
            },
            {
              OR: [
                { lease_expires_at: null },
                { lease_expires_at: { lt: expect.any(Date) } },
              ],
            },
          ]),
        }),
        orderBy: [
          { next_retry_at: { sort: 'asc', nulls: 'first' } },
          { id: 'asc' },
        ],
      }),
    );
    expect(context.runInStoreContext).toHaveBeenCalledWith(
      3,
      expect.any(Function),
    );
    expect(changes.resume).toHaveBeenCalledWith(21);
  });
  it('never sweeps untouched eager pending requests; submitted adoption remains bounded', async () => {
    const { service, prisma, changes } = harness();
    prisma.invoice_data_requests.findMany.mockResolvedValue([
      { id: 8, store_id: 3 },
    ]);
    await service.recoverBatch();
    expect(prisma.invoice_data_requests.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: {
          status: 'submitted',
          submitted_at: { not: null },
          invoice_holder_changes_request_id: null,
        },
      }),
    );
    expect(changes.adoptLegacySubmittedRequest).toHaveBeenCalledWith(8);
  });
  it('an unprovable legacy capture requires review and does not invent an invoice', async () => {
    const { service, prisma, changes } = harness();
    prisma.invoice_data_requests.findMany.mockResolvedValue([
      { id: 8, store_id: 3 },
    ]);
    changes.adoptLegacySubmittedRequest.mockRejectedValue(
      new Error('incomplete capture'),
    );
    await service.recoverBatch();
    expect(prisma.invoice_data_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 8, store_id: 3, status: 'submitted' },
      data: { status: 'failed' },
    });
    expect(changes.resume).not.toHaveBeenCalled();
  });
  it('overlapping ticks do not launch a second local sweep', async () => {
    const { service, prisma } = harness();
    let release!: (rows: never[]) => void;
    prisma.invoice_holder_changes.findMany.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const first = service.recoverBatch();
    await service.recoverBatch();
    expect(prisma.invoice_holder_changes.findMany).toHaveBeenCalledTimes(1);
    release([]);
    await first;
    prisma.invoice_holder_changes.findMany.mockResolvedValue([]);
    await service.recoverBatch();
    expect(prisma.invoice_holder_changes.findMany).toHaveBeenCalledTimes(2);
  });
  it('acceptance wakes only its existing active operation in isolated tenant context', async () => {
    const { service, prisma, context, changes } = harness();
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({
      id: 21,
      store_id: 3,
    });
    await service.accepted({ invoice_id: 11, store_id: 3, organization_id: 7 });
    expect(prisma.invoice_holder_changes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organization_id: 7,
          store_id: 3,
          active_order_key: { not: null },
        }),
      }),
    );
    expect(context.runInStoreContext).toHaveBeenCalledWith(
      3,
      expect.any(Function),
    );
    expect(changes.resume).toHaveBeenCalledWith(21);
  });
});
