import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CrmInboundProcessor } from './crm-inbound.processor';
import { CrmInboundJob } from './crm-inbound.constants';
import { MetaWhatsappInboundService } from './meta-whatsapp-inbound.service';

function job(attemptsMade: number, attempts = 5): Job<CrmInboundJob> {
  return {
    data: { event_id: 99 },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<CrmInboundJob>;
}

function setup(result: unknown) {
  const inbound = {
    processEvent: jest
      .fn()
      .mockImplementation(() =>
        result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result),
      ),
    markFailed: jest.fn().mockResolvedValue(undefined),
  } as unknown as MetaWhatsappInboundService;
  return { processor: new CrmInboundProcessor(inbound), inbound };
}

describe('CrmInboundProcessor', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('passes attempt information to the service', async () => {
    const { processor, inbound } = setup({ status: 'processed' });

    await processor.process(job(0));
    await processor.process(job(4));

    expect(inbound.processEvent).toHaveBeenNthCalledWith(1, 99, {
      isLastAttempt: false,
      allowStatusRetry: true,
    });
    expect(inbound.processEvent).toHaveBeenNthCalledWith(2, 99, {
      isLastAttempt: true,
      allowStatusRetry: false,
    });
  });

  it('throws so BullMQ retries when statuses are not matched yet', async () => {
    const { processor, inbound } = setup({
      status: 'retry',
      statuses_missing: 1,
    });

    await expect(processor.process(job(0))).rejects.toThrow(/retry/);
    expect(inbound.markFailed).not.toHaveBeenCalled();
  });

  it('marks the event failed only on the last attempt', async () => {
    const early = setup(new Error('db down'));
    await expect(early.processor.process(job(1))).rejects.toThrow('db down');
    expect(early.inbound.markFailed).not.toHaveBeenCalled();

    const last = setup(new Error('db down'));
    await expect(last.processor.process(job(4))).rejects.toThrow('db down');
    expect(last.inbound.markFailed).toHaveBeenCalledWith(99, 'db down');
  });
});
