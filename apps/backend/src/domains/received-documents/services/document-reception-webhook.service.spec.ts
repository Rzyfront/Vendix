import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EncryptionService } from '../../../common/services/encryption.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { DocumentReceptionEnvelopeService } from './document-reception-envelope.service';
import { DocumentReceptionSyncLeaseService } from './document-reception-sync-lease.service';
import { DocumentReceptionWebhookService } from './document-reception-webhook.service';

const PUBLIC_TOKEN = '123e4567-e89b-42d3-a456-426614174000';
const EVENT_ID = '123e4567-e89b-42d3-a456-426614174001';
const SECRET = 'supplier-secret-never-disclose';
const NOW_MS = 1_783_000_000_000;
const TIMESTAMP = String(Math.floor(NOW_MS / 1000));

const CONTEXT = {
  organization_id: 10,
  accounting_entity_id: 30,
  store_id: 20,
  actor_id: 42,
  is_organization: false,
};

const makeRawBody = (externalId = 'supplier-invoice-1'): Buffer => Buffer.from(JSON.stringify({
  version: 1,
  documents: [{
    external_id: externalId,
    file_name: 'supplier-invoice.xml',
    mime_type: 'application/xml',
    content_base64: Buffer.from('<Invoice/>', 'utf8').toString('base64'),
  }],
  next_cursor: 'opaque-next-cursor',
}), 'utf8');

const signatureFor = (rawBody: Buffer, timestamp = TIMESTAMP, eventId = EVENT_ID): string =>
  `sha256=${createHmac('sha256', SECRET)
    .update(Buffer.from(`${timestamp}.${eventId}.`, 'utf8'))
    .update(rawBody)
    .digest('hex')}`;

class TestWebhookService extends DocumentReceptionWebhookService {
  protected override currentTimeMs(): number { return NOW_MS; }
}

function harness() {
  const connection = {
    id: 51,
    organization_id: CONTEXT.organization_id,
    store_id: CONTEXT.store_id,
    accounting_entity_id: CONTEXT.accounting_entity_id,
    version: 7,
    encrypted_secret: 'encrypted-secret',
    connection_type: 'webhook',
    enabled: true,
  };
  const connectionDelegate = { findUnique: jest.fn().mockResolvedValue(connection) };
  const client = { document_reception_connections: connectionDelegate };
  const prisma = { withoutScope: () => client };
  const encryption = { decrypt: jest.fn().mockReturnValue(SECRET) };
  const leases = {
    getWorkerContext: jest.fn().mockResolvedValue(CONTEXT),
    claim: jest.fn().mockResolvedValue({ run_id: 99, duplicate: false }),
  };
  const subscriptionAccess = {
    canUseModule: jest.fn().mockResolvedValue({
      allowed: true,
      mode: 'allow',
      severity: 'info',
      subscription_state: 'active',
      plan_id: 1,
      has_record: true,
    }),
  };
  const envelopes = new DocumentReceptionEnvelopeService();
  jest.spyOn(envelopes, 'decode');
  const service = new TestWebhookService(
    prisma as unknown as GlobalPrismaService,
    encryption as unknown as EncryptionService,
    leases as unknown as DocumentReceptionSyncLeaseService,
    subscriptionAccess as unknown as SubscriptionAccessService,
    envelopes,
  );
  return { service, connection, connectionDelegate, prisma, encryption, leases, subscriptionAccess, envelopes };
}

describe('DocumentReceptionWebhookService', () => {
  it('authenticates exact raw bytes, checks current tenant context/subscription, and stores a canonical envelope only', async () => {
    const h = harness();
    const rawBody = makeRawBody();
    const response = await h.service.accept(PUBLIC_TOKEN, {
      timestamp: TIMESTAMP,
      event_id: EVENT_ID,
      signature: signatureFor(rawBody),
    }, rawBody);

    expect(response).toEqual({ run_id: 99, duplicate: false });
    expect(Object.keys(response).sort()).toEqual(['duplicate', 'run_id']);
    expect(response).not.toHaveProperty('documents');
    expect(response).not.toHaveProperty('invoice_id');
    expect(h.prisma.withoutScope().document_reception_connections.findUnique).toHaveBeenCalledWith({
      where: { public_token: PUBLIC_TOKEN },
      select: expect.objectContaining({ encrypted_secret: true, version: true, connection_type: true }),
    });
    expect(h.encryption.decrypt).toHaveBeenCalledWith('encrypted-secret');
    expect(h.leases.getWorkerContext).toHaveBeenCalledWith(51);
    expect(h.subscriptionAccess.canUseModule).toHaveBeenCalledWith(20, 'received_documents');
    expect(h.envelopes.decode).toHaveBeenCalledTimes(1);
    expect(h.leases.claim).toHaveBeenCalledWith(CONTEXT, 51, {
      trigger: 'webhook',
      idempotency_key: `webhook:${EVENT_ID}`,
      expected_version: 7,
      payload_sha256: createHash('sha256').update(rawBody).digest('hex'),
      input_payload: {
        version: 1,
        documents: [{
          external_id: 'supplier-invoice-1',
          file_name: 'supplier-invoice.xml',
          mime_type: 'application/xml',
          content_base64: Buffer.from('<Invoice/>', 'utf8').toString('base64'),
        }],
        next_cursor: 'opaque-next-cursor',
      },
    });
  });

  it('uses the same safe authentication failure for unknown, disabled, non-webhook, and missing-secret connections', async () => {
    const cases = [
      (connection: ReturnType<typeof harness>['connection']) => ({ ...connection, enabled: false }),
      (connection: ReturnType<typeof harness>['connection']) => ({ ...connection, connection_type: 'api_poll' }),
      (connection: ReturnType<typeof harness>['connection']) => ({ ...connection, encrypted_secret: null }),
    ];
    const responses: unknown[] = [];
    for (const configure of cases) {
      const h = harness();
      const result = configure(h.connection);
      h.connectionDelegate.findUnique.mockResolvedValueOnce(result);
      const rawBody = makeRawBody();
      try {
        await h.service.accept(PUBLIC_TOKEN, { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, rawBody);
        fail('Expected safe webhook authentication rejection.');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        responses.push((error as ForbiddenException).getResponse());
      }
      expect(h.leases.claim).not.toHaveBeenCalled();
    }
    const unknown = harness();
    unknown.connectionDelegate.findUnique.mockResolvedValueOnce(null);
    const rawBody = makeRawBody();
    try {
      await unknown.service.accept(PUBLIC_TOKEN, { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, rawBody);
      fail('Expected unknown token rejection.');
    } catch (error) {
      responses.push((error as ForbiddenException).getResponse());
    }
    expect(responses.length).toBe(4);
    for (const response of responses) {
      expect(response).toEqual({ statusCode: 403, message: 'Webhook authentication failed.', error: 'Forbidden' });
    }
  });

  it('rejects invalid UUIDs, stale timestamps, malformed headers and bad HMAC before tenant/subscription work', async () => {
    const rawBody = makeRawBody();
    const invalidRequests = [
      { token: 'not-a-uuid', headers: { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, lookupExpected: 0 },
      { token: PUBLIC_TOKEN, headers: { timestamp: '1000000000', event_id: EVENT_ID, signature: signatureFor(rawBody, '1000000000') }, lookupExpected: 0 },
      { token: PUBLIC_TOKEN, headers: { timestamp: TIMESTAMP, event_id: 'not-a-uuid', signature: 'a'.repeat(64) }, lookupExpected: 0 },
      { token: PUBLIC_TOKEN, headers: { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: `sha256=${'A'.repeat(64)}` }, lookupExpected: 0 },
      { token: PUBLIC_TOKEN, headers: { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: `sha256=${'0'.repeat(64)}` }, lookupExpected: 1 },
      { token: PUBLIC_TOKEN, headers: { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: '0'.repeat(64) }, lookupExpected: 0 },
    ];
    for (const request of invalidRequests) {
      const h = harness();
      await expect(h.service.accept(request.token, request.headers, rawBody)).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.connectionDelegate.findUnique).toHaveBeenCalledTimes(request.lookupExpected);
      expect(h.encryption.decrypt).toHaveBeenCalledTimes(request.lookupExpected);
      expect(h.leases.getWorkerContext).not.toHaveBeenCalled();
      expect(h.subscriptionAccess.canUseModule).not.toHaveBeenCalled();
    }
  });

  it('does not expose the token, event, signature, raw body, or secret in authentication errors', async () => {
    const h = harness();
    const rawBody = makeRawBody();
    h.encryption.decrypt.mockImplementationOnce(() => { throw new Error(`decrypt ${SECRET}`); });
    try {
      await h.service.accept(PUBLIC_TOKEN, { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, rawBody);
      fail('Expected authentication failure.');
    } catch (error) {
      const response = (error as ForbiddenException).getResponse();
      const safe = JSON.stringify(response);
      expect(response).toEqual({ statusCode: 403, message: 'Webhook authentication failed.', error: 'Forbidden' });
      expect(safe).not.toContain(PUBLIC_TOKEN);
      expect(safe).not.toContain(EVENT_ID);
      expect(safe).not.toContain(SECRET);
      expect(safe).not.toContain(rawBody.toString('utf8'));
    }
    expect(h.leases.claim).not.toHaveBeenCalled();
  });

  it('rejects a worker-context ownership mismatch without checking subscription or claiming a run', async () => {
    const h = harness();
    h.leases.getWorkerContext.mockResolvedValueOnce({ ...CONTEXT, accounting_entity_id: 999 });
    const rawBody = makeRawBody();
    await expect(h.service.accept(PUBLIC_TOKEN, { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, rawBody))
      .rejects.toMatchObject({ response: expect.objectContaining({ message: 'Webhook authentication failed.' }) });
    expect(h.subscriptionAccess.canUseModule).not.toHaveBeenCalled();
    expect(h.leases.claim).not.toHaveBeenCalled();
  });

  it('blocks subscription denial and internal access failures before decoding or claiming', async () => {
    for (const result of [
      { allowed: false, mode: 'block', reason: 'SUBSCRIPTION_004' },
      { allowed: false, mode: 'block', reason: 'SUBSCRIPTION_INTERNAL_ERROR' },
    ]) {
      const h = harness();
      h.subscriptionAccess.canUseModule.mockResolvedValueOnce(result);
      const rawBody = makeRawBody();
      const request = h.service.accept(PUBLIC_TOKEN, { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, rawBody);
      if (result.reason === 'SUBSCRIPTION_INTERNAL_ERROR') await expect(request).rejects.toBeInstanceOf(ServiceUnavailableException);
      else await expect(request).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.envelopes.decode).not.toHaveBeenCalled();
      expect(h.leases.claim).not.toHaveBeenCalled();
    }
  });

  it('uses lease idempotency output for exact replays and hashes each signed body', async () => {
    const h = harness();
    h.leases.claim.mockResolvedValueOnce({ run_id: 99, duplicate: false });
    h.leases.claim.mockResolvedValueOnce({ run_id: 99, duplicate: true });
    const rawBody = makeRawBody('source-two');
    const headers = { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) };
    await expect(h.service.accept(PUBLIC_TOKEN, headers, rawBody)).resolves.toEqual({ run_id: 99, duplicate: false });
    await expect(h.service.accept(PUBLIC_TOKEN, headers, rawBody)).resolves.toEqual({ run_id: 99, duplicate: true });
    expect(h.leases.claim).toHaveBeenCalledTimes(2);
    expect(h.leases.claim).toHaveBeenCalledWith(CONTEXT, 51, expect.objectContaining({
      idempotency_key: `webhook:${EVENT_ID}`,
      payload_sha256: createHash('sha256').update(rawBody).digest('hex'),
    }));
  });

  it('delegates same-event different-payload replay conflicts to the durable lease', async () => {
    const h = harness();
    h.leases.claim.mockRejectedValueOnce(new ConflictException('La clave de idempotencia del webhook ya se usó con otro contenido.'));
    const rawBody = makeRawBody('different-source');
    await expect(h.service.accept(PUBLIC_TOKEN, { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: signatureFor(rawBody) }, rawBody))
      .rejects.toBeInstanceOf(ConflictException);
    expect(h.leases.claim).toHaveBeenCalledWith(CONTEXT, 51, expect.objectContaining({
      idempotency_key: `webhook:${EVENT_ID}`,
      payload_sha256: createHash('sha256').update(rawBody).digest('hex'),
    }));
  });

  it('rejects empty, non-buffer, and oversized payloads before any lookup', async () => {
    const h = harness();
    const headers = { timestamp: TIMESTAMP, event_id: EVENT_ID, signature: `sha256=${'0'.repeat(64)}` };
    await expect(h.service.accept(PUBLIC_TOKEN, headers, Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.accept(PUBLIC_TOKEN, headers, Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(BadRequestException);
    await expect(h.service.accept(PUBLIC_TOKEN, headers, 'body' as unknown as Buffer)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.connectionDelegate.findUnique).not.toHaveBeenCalled();
  });
});
