import { InvoiceRetryListener, InvoiceRetryEvent } from './invoice-retry.listener';

describe('InvoiceRetryListener', () => {
  const event: InvoiceRetryEvent = {
    retry_queue_id: 10,
    invoice_id: 55,
    invoice_number: 'FE100',
    store_id: 2,
    organization_id: 1,
    attempt: 1,
    max_attempts: 3,
  };

  const createListener = (overrides: any = {}) => {
    const context_runner = {
      runInStoreContext: jest.fn(
        async (_store_id: number, callback: () => Promise<unknown>) =>
          callback(),
      ),
      ...overrides.context_runner,
    };
    const prisma = {
      invoices: {
        findFirst: jest.fn().mockResolvedValue({
          id: 55,
          status: 'validated',
          invoice_number: 'FE100',
        }),
      },
      ...overrides.prisma,
    };
    const invoice_flow = {
      send: jest.fn().mockResolvedValue({ id: 55, status: 'accepted' }),
      ...overrides.invoice_flow,
    };
    const retry_queue = {
      markSuccess: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      ...overrides.retry_queue,
    };

    return {
      listener: new InvoiceRetryListener(
        context_runner as any,
        prisma as any,
        invoice_flow as any,
        retry_queue as any,
      ),
      context_runner,
      prisma,
      invoice_flow,
      retry_queue,
    };
  };

  it('re-sends the invoice inside the store tenant context and marks success', async () => {
    const { listener, context_runner, invoice_flow, retry_queue } =
      createListener();

    await listener.handleInvoiceRetry(event);

    expect(context_runner.runInStoreContext).toHaveBeenCalledWith(
      2,
      expect.any(Function),
    );
    expect(invoice_flow.send).toHaveBeenCalledWith(55);
    expect(retry_queue.markSuccess).toHaveBeenCalledWith(10);
    expect(retry_queue.markFailed).not.toHaveBeenCalled();
  });

  it('marks the item failed (backoff) on a transient transmission error without throwing', async () => {
    const { listener, invoice_flow, retry_queue } = createListener({
      invoice_flow: {
        send: jest.fn().mockRejectedValue(new Error('ETIMEDOUT contacting DIAN')),
      },
    });

    await expect(listener.handleInvoiceRetry(event)).resolves.toBeUndefined();

    expect(invoice_flow.send).toHaveBeenCalledWith(55);
    expect(retry_queue.markFailed).toHaveBeenCalledWith(
      10,
      'ETIMEDOUT contacting DIAN',
    );
    expect(retry_queue.markSuccess).not.toHaveBeenCalled();
  });

  it('closes the queue item without re-sending when the invoice is already accepted', async () => {
    const { listener, invoice_flow, retry_queue } = createListener({
      prisma: {
        invoices: {
          findFirst: jest.fn().mockResolvedValue({
            id: 55,
            status: 'accepted',
            invoice_number: 'FE100',
          }),
        },
      },
    });

    await listener.handleInvoiceRetry(event);

    expect(invoice_flow.send).not.toHaveBeenCalled();
    expect(retry_queue.markSuccess).toHaveBeenCalledWith(10);
    expect(retry_queue.markFailed).not.toHaveBeenCalled();
  });

  it('marks the item failed when the invoice no longer exists in the store scope', async () => {
    const { listener, invoice_flow, retry_queue } = createListener({
      prisma: {
        invoices: { findFirst: jest.fn().mockResolvedValue(null) },
      },
    });

    await listener.handleInvoiceRetry(event);

    expect(invoice_flow.send).not.toHaveBeenCalled();
    expect(retry_queue.markFailed).toHaveBeenCalledWith(
      10,
      expect.stringContaining('not found'),
    );
  });

  it('never lets a markFailed error escape the handler', async () => {
    const { listener } = createListener({
      invoice_flow: {
        send: jest.fn().mockRejectedValue(new Error('network down')),
      },
      retry_queue: {
        markFailed: jest.fn().mockRejectedValue(new Error('db down')),
        markSuccess: jest.fn(),
      },
    });

    await expect(listener.handleInvoiceRetry(event)).resolves.toBeUndefined();
  });
});
