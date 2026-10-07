import { BadRequestException, ConflictException } from '@nestjs/common';
import { ErrorCodes } from '../../../common/errors';
import { EncryptionService } from '../../../common/services/encryption.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { ReceivedDocumentsContext } from '../received-documents.service';
import { DocumentReceptionEnvelopeService } from './document-reception-envelope.service';
import { DocumentReceptionHttpService } from './document-reception-http.service';
import { DocumentReceptionIngestService } from './document-reception-ingest.service';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import { DocumentReceptionSyncService } from './document-reception-sync.service';

const context: ReceivedDocumentsContext = {
  organization_id: 7, accounting_entity_id: 12, store_id: 19, actor_id: undefined, is_organization: true,
};

function startResult(overrides: Record<string, unknown> = {}) {
  return {
    run_id: 40,
    connection_id: 20,
    connection_version: 5,
    lease_token: 'lease-token',
    connection: {
      id: 20, connection_type: 'api_poll', endpoint: 'https://supplier.example.com/feed',
      encrypted_secret: 'ciphertext-only', cursor: 'cursor-before', poll_interval_minutes: 15,
    },
    context,
    cursor_before: 'cursor-before',
    input_payload: null,
    payload_sha256: null,
    ...overrides,
  } as any;
}

function envelope(documents: unknown[] = [], next_cursor: string | null = 'cursor-next') {
  return { version: 1 as const, documents, next_cursor };
}

function ingestResult(overrides: Record<string, unknown> = {}) {
  return {
    received_count: 0, duplicate_count: 0, error_count: 0, document_ids: [], error_codes: [], next_cursor: 'cursor-next',
    ...overrides,
  };
}

function harness() {
  const leases = {
    start: jest.fn().mockResolvedValue(startResult()),
    heartbeat: jest.fn().mockResolvedValue(true),
    finish: jest.fn().mockResolvedValue(true),
  };
  const subscription = { canUseModule: jest.fn().mockResolvedValue({ allowed: true, mode: 'allow', reason: undefined }) };
  const encryption = { decrypt: jest.fn().mockReturnValue('bearer-secret') };
  const transport = { fetch: jest.fn().mockResolvedValue(Buffer.from('{"signed":"provider bytes"}')) };
  const envelopes = { decode: jest.fn().mockReturnValue(envelope()) };
  const ingest = {
    ingest: jest.fn(async (_ctx: any, input: any, _source: string, beforeEach?: () => Promise<void>) => {
      for (const _doc of input.documents) if (beforeEach) await beforeEach();
      return ingestResult({ next_cursor: input.next_cursor });
    }),
  };
  const service = new DocumentReceptionSyncService(
    leases as unknown as DocumentReceptionSyncLeaseService,
    subscription as unknown as SubscriptionAccessService,
    encryption as unknown as EncryptionService,
    transport as unknown as DocumentReceptionHttpService,
    envelopes as unknown as DocumentReceptionEnvelopeService,
    ingest as unknown as DocumentReceptionIngestService,
  );
  return { service, leases, subscription, encryption, transport, envelopes, ingest };
}

describe('DocumentReceptionSyncService', () => {
  it('fetches successive API pages from the prior cursor and commits only the last durable cursor', async () => {
    const h = harness();
    h.envelopes.decode
      .mockReturnValueOnce(envelope([{ external_id: 'a' }], 'cursor-1'))
      .mockReturnValueOnce(envelope([{ external_id: 'b' }], 'cursor-2'))
      .mockReturnValueOnce(envelope([], null));
    h.transport.fetch
      .mockResolvedValueOnce(Buffer.from('page-one'))
      .mockResolvedValueOnce(Buffer.from('page-two'))
      .mockResolvedValueOnce(Buffer.from('page-three-empty'));
    const pageResults = [
      ingestResult({ received_count: 1, document_ids: [101], next_cursor: 'cursor-1' }),
      ingestResult({ duplicate_count: 1, document_ids: [102], next_cursor: 'cursor-2' }),
      ingestResult({ next_cursor: null }),
    ];
    h.ingest.ingest.mockImplementation(async (_ctx: any, input: any, _source: string, beforeEach?: () => Promise<void>) => {
      for (const _doc of input.documents) if (beforeEach) await beforeEach();
      return pageResults.shift() as any;
    });

    const result = await h.service.process(40);
    expect(result).toEqual({ run_id: 40, status: 'completed', received_count: 1, duplicate_count: 1, error_count: 0 });
    expect(h.subscription.canUseModule).toHaveBeenCalledWith(19, 'received_documents');
    expect(h.encryption.decrypt).toHaveBeenCalledWith('ciphertext-only');
    expect(h.transport.fetch.mock.calls).toEqual([
      ['https://supplier.example.com/feed', 'bearer-secret', 'cursor-before'],
      ['https://supplier.example.com/feed', 'bearer-secret', 'cursor-1'],
      ['https://supplier.example.com/feed', 'bearer-secret', 'cursor-2'],
    ]);
    expect(h.ingest.ingest).toHaveBeenNthCalledWith(1, context, expect.any(Object), 'api', expect.any(Function));
    expect(h.ingest.ingest).toHaveBeenNthCalledWith(2, context, expect.any(Object), 'api', expect.any(Function));
    expect(h.leases.heartbeat).toHaveBeenCalledTimes(6); // before both pages, each document, and finalization
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      received_count: 1, duplicate_count: 1, error_count: 0, next_cursor: 'cursor-2', failed: false,
    }));
  });

  it('treats empty plus null cursor as end-of-feed while preserving the durable checkpoint', async () => {
    const h = harness();
    h.envelopes.decode.mockReturnValueOnce(envelope([], null));
    h.ingest.ingest.mockResolvedValueOnce(ingestResult({ next_cursor: null }));
    const result = await h.service.process(40);
    expect(result).toEqual({ run_id: 40, status: 'completed', received_count: 0, duplicate_count: 0, error_count: 0 });
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      next_cursor: 'cursor-before', error_count: 0,
    }));
  });

  it('marks nonempty null-cursor pages partial and never advances the checkpoint', async () => {
    const h = harness();
    h.envelopes.decode.mockReturnValueOnce(envelope([{ external_id: 'uncursored' }], null));
    h.ingest.ingest.mockResolvedValueOnce(ingestResult({ received_count: 1, document_ids: [7], next_cursor: null }));
    const result = await h.service.process(40);
    expect(result).toEqual({ run_id: 40, status: 'partial', received_count: 1, duplicate_count: 0, error_count: 1 });
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      failed: false, error_count: 1, next_cursor: 'cursor-before',
    }));
  });

  it('marks repeated or nonadvancing API cursors partial', async () => {
    const h = harness();
    h.envelopes.decode.mockReturnValueOnce(envelope([], 'cursor-before'));
    const result = await h.service.process(40);
    expect(result.status).toBe('partial');
    expect(h.transport.fetch).toHaveBeenCalledTimes(1);
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      next_cursor: 'cursor-before', error_count: 1,
    }));
  });

  it('caps at ten pages and requests immediate continuation when another cursor remains', async () => {
    const h = harness();
    h.envelopes.decode.mockImplementation(() => envelope(
      Array.from({ length: 10 }, (_, i) => ({ external_id: `page-${h.envelopes.decode.mock.calls.length}-doc-${i}` })),
      `cursor-${h.envelopes.decode.mock.calls.length}`,
    ));
    h.transport.fetch.mockImplementation(async () => Buffer.from('page'));
    const result = await h.service.process(40);
    expect(h.transport.fetch).toHaveBeenCalledTimes(10);
    expect(result).toEqual({ run_id: 40, status: 'completed', received_count: 0, duplicate_count: 0, error_count: 0 });
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      next_cursor: 'cursor-10', continue_immediately: true,
    }));
  });

  it('uses durable webhook input payload without network fetch or secret decryption', async () => {
    const payload = { next_cursor: null, version: 1, documents: [] };
    const h = harness();
    h.leases.start.mockResolvedValueOnce(startResult({
      connection: { connection_type: 'webhook', endpoint: null, encrypted_secret: 'must-not-decrypt' },
      input_payload: payload,
    }));
    h.envelopes.decode.mockReturnValueOnce(envelope([], null));
    h.ingest.ingest.mockResolvedValueOnce(ingestResult({ next_cursor: null }));
    const result = await h.service.process(40);
    expect(result.status).toBe('completed');
    expect(h.envelopes.decode).toHaveBeenCalledWith(Buffer.from('{"documents":[],"next_cursor":null,"version":1}'));
    expect(h.ingest.ingest).toHaveBeenCalledWith(context, expect.any(Object), 'automated', expect.any(Function));
    expect(h.transport.fetch).not.toHaveBeenCalled();
    expect(h.encryption.decrypt).not.toHaveBeenCalled();
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({ next_cursor: 'cursor-before' }));
  });

  it('fails closed on subscription blocks and internal subscription failures before external work', async () => {
    const blocked = harness();
    blocked.subscription.canUseModule.mockResolvedValueOnce({ allowed: false, mode: 'block', reason: 'SUBSCRIPTION_006' } as any);
    const blockedResult = await blocked.service.process(40);
    expect(blockedResult).toEqual({ run_id: 40, status: 'failed', received_count: 0, duplicate_count: 0, error_count: 1 });
    expect(blocked.transport.fetch).not.toHaveBeenCalled();
    expect(blocked.encryption.decrypt).not.toHaveBeenCalled();
    expect(blocked.ingest.ingest).not.toHaveBeenCalled();
    expect(blocked.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({ failed: true }));
    expect(blocked.leases.finish.mock.calls[0][2].error_codes).toEqual([ErrorCodes.SUBSCRIPTION_006.code]);

    const internal = harness();
    internal.subscription.canUseModule.mockResolvedValueOnce({ allowed: true, mode: 'allow', reason: 'SUBSCRIPTION_INTERNAL_ERROR' } as any);
    const internalResult = await internal.service.process(40);
    expect(internalResult.status).toBe('failed');
    expect(internal.leases.finish.mock.calls[0][2].error_codes).toEqual([ErrorCodes.SYS_INTERNAL_001.code]);
    expect(internal.transport.fetch).not.toHaveBeenCalled();
  });

  it('surfaces lost lease as conflict without fetching or reporting false success', async () => {
    const h = harness();
    h.leases.heartbeat.mockResolvedValueOnce(false);
    await expect(h.service.process(40)).rejects.toBeInstanceOf(ConflictException);
    expect(h.transport.fetch).not.toHaveBeenCalled();
    expect(h.leases.finish).not.toHaveBeenCalled();
  });

  it('renews ownership before each item and aborts when the lease expires during a page', async () => {
    const h = harness();
    h.envelopes.decode.mockReturnValueOnce(envelope([{ external_id: 'doc' }], 'cursor-1'));
    h.leases.heartbeat.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(h.service.process(40)).rejects.toBeInstanceOf(ConflictException);
    expect(h.transport.fetch).toHaveBeenCalledTimes(1);
    expect(h.ingest.ingest).toHaveBeenCalledTimes(1);
    expect(h.leases.heartbeat).toHaveBeenCalledTimes(2);
    expect(h.leases.finish).not.toHaveBeenCalled();
  });

  it('records upstream failures using a safe registered code and does not leak provider details', async () => {
    const h = harness();
    h.transport.fetch.mockRejectedValueOnce(new Error('Authorization: bearer-secret response body leaked'));
    const result = await h.service.process(40);
    expect(result).toEqual({ run_id: 40, status: 'failed', received_count: 0, duplicate_count: 0, error_count: 1 });
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      failed: true, next_cursor: 'cursor-before',
    }));
  });

  it('records malformed envelope and decryption failures safely before further ingestion', async () => {
    const malformed = harness();
    malformed.envelopes.decode.mockImplementationOnce(() => { throw new BadRequestException('private provider XML payload'); });
    const malformedResult = await malformed.service.process(40);
    expect(malformedResult).toEqual({ run_id: 40, status: 'failed', received_count: 0, duplicate_count: 0, error_count: 1 });
    expect(malformed.leases.finish.mock.calls[0][2].error_codes).toEqual([ErrorCodes.SYS_VALIDATION_001.code]);
    expect(malformed.ingest.ingest).not.toHaveBeenCalled();

    const decryptFailure = harness();
    decryptFailure.encryption.decrypt.mockImplementationOnce(() => { throw new Error('ciphertext plaintext leak'); });
    const decryptResult = await decryptFailure.service.process(40);
    expect(decryptResult.status).toBe('failed');
    expect(decryptFailure.transport.fetch).not.toHaveBeenCalled();
    expect(decryptFailure.leases.finish.mock.calls[0][2].error_codes).toEqual([ErrorCodes.SYS_INTERNAL_001.code]);
  });

  it('keeps the cursor when any document intake in a page is partial', async () => {
    const h = harness();
    h.envelopes.decode.mockReturnValueOnce(envelope([{ external_id: 'bad-one' }], 'cursor-1'));
    h.ingest.ingest.mockResolvedValueOnce(ingestResult({ error_count: 1, error_codes: [ErrorCodes.SYS_VALIDATION_001.code] }));
    const result = await h.service.process(40);
    expect(result.status).toBe('partial');
    expect(h.transport.fetch).toHaveBeenCalledTimes(1);
    expect(h.leases.finish).toHaveBeenCalledWith(40, 'lease-token', expect.objectContaining({
      error_count: 1, error_codes: [ErrorCodes.SYS_VALIDATION_001.code], next_cursor: 'cursor-before', failed: false,
    }));
  });

  it('returns a safe terminal outcome when lease start reports a terminal run', async () => {
    const h = harness();
    h.leases.start.mockResolvedValueOnce(null);
    await expect(h.service.process(40)).resolves.toEqual({ run_id: 40, status: 'terminal', received_count: 0, duplicate_count: 0, error_count: 0 });
    expect(h.subscription.canUseModule).not.toHaveBeenCalled();
    expect(h.leases.finish).not.toHaveBeenCalled();
  });

  it('returns failed when the lease finish compare-and-set fails', async () => {
    const h = harness();
    h.leases.finish.mockResolvedValueOnce(false);
    await expect(h.service.process(40)).rejects.toBeInstanceOf(ConflictException);
  });
});
