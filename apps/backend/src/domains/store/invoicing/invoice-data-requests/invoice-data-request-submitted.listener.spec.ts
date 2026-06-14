import { InvoiceDataRequestSubmittedListener } from './invoice-data-request-submitted.listener';
import { InvoiceDataRequestEvent } from './interfaces/invoice-data-request-events.interface';

describe('InvoiceDataRequestSubmittedListener', () => {
  const event: InvoiceDataRequestEvent = {
    store_id: 2,
    request_id: 7,
    order_id: 30,
    token: 'tok-123',
    status: 'submitted',
    customer_name: 'Ana Diaz',
    document_number: '123456',
  };

  const createListener = (overrides: any = {}) => {
    const context_runner = {
      runInStoreContext: jest.fn(
        async (_store_id: number, callback: () => Promise<unknown>) =>
          callback(),
      ),
      ...overrides.context_runner,
    };
    const service = {
      processRequest: jest
        .fn()
        .mockResolvedValue({ id: 7, status: 'completed' }),
      ...overrides.service,
    };

    return {
      listener: new InvoiceDataRequestSubmittedListener(
        context_runner as any,
        service as any,
      ),
      context_runner,
      service,
    };
  };

  it('processes the request inside the store tenant context', async () => {
    const { listener, context_runner, service } = createListener();

    await listener.handleSubmitted(event);

    expect(context_runner.runInStoreContext).toHaveBeenCalledWith(
      2,
      expect.any(Function),
    );
    expect(service.processRequest).toHaveBeenCalledWith(7, 2);
  });

  it('never propagates processing errors (request stays failed, admin endpoint is the fallback)', async () => {
    const { listener, service } = createListener({
      service: {
        processRequest: jest
          .fn()
          .mockRejectedValue(new Error('DIAN provider down')),
      },
    });

    await expect(listener.handleSubmitted(event)).resolves.toBeUndefined();
    expect(service.processRequest).toHaveBeenCalledWith(7, 2);
  });

  it('never propagates context resolution errors', async () => {
    const { listener, service } = createListener({
      context_runner: {
        runInStoreContext: jest
          .fn()
          .mockRejectedValue(new Error('Store #2 not found')),
      },
    });

    await expect(listener.handleSubmitted(event)).resolves.toBeUndefined();
    expect(service.processRequest).not.toHaveBeenCalled();
  });
});
