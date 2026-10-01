import { BadRequestException, HttpStatus } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { PATH_METADATA, METHOD_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PublicDocumentReceptionWebhookController } from './public-document-reception-webhook.controller';

describe('PublicDocumentReceptionWebhookController', () => {
  const token = 'public-token-never-echo';
  const headers = {
    'x-vendix-timestamp': '1780257600',
    'x-vendix-event-id': 'e1f36e8d-141b-498c-9ac8-fb1d69af4382',
    'x-vendix-signature': 'sha256=signature-never-echo',
  };

  function harness() {
    const webhook = { accept: jest.fn().mockResolvedValue({ run_id: 42, duplicate: false }) };
    const syncQueue = { enqueue: jest.fn().mockResolvedValue({ run_id: 42, job_id: 'dr-sync-42' }) };
    const response = {
      success: jest.fn((data: unknown, message: string) => ({ success: true, data, message })),
    };
    const controller = new PublicDocumentReceptionWebhookController(webhook as any, syncQueue as any, response as any);
    return { controller, webhook, syncQueue, response };
  }

  it('exposes exactly one public POST ingress and reads request/raw buffer without @Body', () => {
    const prototype = PublicDocumentReceptionWebhookController.prototype;
    expect(Reflect.getMetadata(PATH_METADATA, PublicDocumentReceptionWebhookController)).toBe('public/received-documents/webhook');
    expect(Reflect.getMetadata(PATH_METADATA, prototype.receive)).toBe(':publicToken');
    expect(Reflect.getMetadata(METHOD_METADATA, prototype.receive)).toBe(1); // RequestMethod.POST
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, prototype.receive)).toBe(HttpStatus.ACCEPTED);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, prototype.receive)).toBe(true);
    const routeArgs = Reflect.getMetadata(ROUTE_ARGS_METADATA, PublicDocumentReceptionWebhookController, 'receive') ?? {};
    expect(Object.keys(routeArgs).some((key) => Number(key.split(':')[0]) === RouteParamtypes.BODY)).toBe(false);
    expect(Object.keys(routeArgs).some((key) => Number(key.split(':')[0]) === RouteParamtypes.REQUEST)).toBe(true);
  });

  it('passes exact raw bytes and HMAC headers to durable claim, then returns only safe acknowledgement fields', async () => {
    const h = harness();
    const rawBody = Buffer.from('{"version":1,"secret":"must-not-echo"}');
    const request = { rawReceptionBody: rawBody, headers } as any;
    const result = await h.controller.receive(token, request);
    expect(h.webhook.accept).toHaveBeenCalledWith(token, {
      timestamp: headers['x-vendix-timestamp'], event_id: headers['x-vendix-event-id'], signature: headers['x-vendix-signature'],
    }, rawBody);
    expect(h.webhook.accept.mock.calls[0][2]).toBe(rawBody);
    expect(h.syncQueue.enqueue).toHaveBeenCalledWith(42);
    expect(result).toEqual({ success: true, data: { run_id: 42, duplicate: false, queued: true }, message: 'Webhook received' });
    const serialized = JSON.stringify(result);
    for (const privateValue of [token, headers['x-vendix-signature'], 'must-not-echo', 'dr-sync-42']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('returns accepted durable acknowledgement when Redis enqueue fails', async () => {
    const h = harness();
    h.webhook.accept.mockResolvedValueOnce({ run_id: 99, duplicate: true });
    h.syncQueue.enqueue.mockRejectedValueOnce(new Error('redis credential and raw payload leak'));
    const result = await h.controller.receive(token, { rawReceptionBody: Buffer.from('{}'), headers } as any);
    expect(result).toEqual({ success: true, data: { run_id: 99, duplicate: true, queued: false }, message: 'Webhook received' });
    expect(JSON.stringify(result)).not.toContain('redis credential');
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it.each([undefined, 'not-a-buffer', new Uint8Array([1, 2])])('rejects missing/non-Buffer raw request bodies before service call', async (rawReceptionBody) => {
    const h = harness();
    await expect(h.controller.receive(token, { rawReceptionBody, headers } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.webhook.accept).not.toHaveBeenCalled();
    expect(h.syncQueue.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue when durable webhook claim rejects malformed/authentication headers', async () => {
    const h = harness();
    const safeAuthFailure = new Error('Webhook authentication failed.');
    h.webhook.accept.mockRejectedValueOnce(safeAuthFailure);
    await expect(h.controller.receive(token, { rawReceptionBody: Buffer.from('{}'), headers: {} } as any)).rejects.toBe(safeAuthFailure);
    expect(h.syncQueue.enqueue).not.toHaveBeenCalled();
  });
});
