import { RequestContextService } from '@common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import {
  OUTBOX_BACKOFF_MINUTES,
  OUTBOX_MAX_ATTEMPTS,
} from '../engine/workflow-outbox.dispatcher.constants';
import { verifySignatureHeader } from './webhook-signature';
import { WebhookTransport } from './webhook-transport';
import { WorkflowWebhookDeliveryService } from './workflow-webhook-delivery.service';

const SECRET = 'whsec_known_secret_for_tests';
const NOW = new Date('2026-11-05T12:00:00.000Z');

describe('WorkflowWebhookDeliveryService', () => {
  let db: FakeWorkflowDb;
  let service: WorkflowWebhookDeliveryService;
  let transport: jest.MockedFunction<WebhookTransport>;
  let encryption: EncryptionService;

  const inStore = <T>(storeId: number, fn: () => Promise<T>) =>
    RequestContextService.runIsolated(
      {
        store_id: storeId,
        organization_id: 1,
        is_super_admin: false,
        is_owner: false,
      },
      fn,
    );

  const BODY = {
    event_id: 'evt-1',
    occurred_at: NOW.toISOString(),
    store_id: 1,
    type: 'workflow.instance.started',
    data: { reference: 'FLU-000001' },
  };

  function seed(
    opts: { url?: string; active?: boolean; storeId?: number } = {},
  ) {
    const endpoint = db.insert('workflow_webhook_endpoints', {
      organization_id: 1,
      store_id: opts.storeId ?? 1,
      url: opts.url ?? 'https://hooks.example.com/vendix',
      secret_enc: encryption.encrypt(SECRET),
      event_types: [BODY.type],
      is_active: opts.active ?? true,
      created_by_user_id: 1,
    });
    const delivery = db.insert('workflow_webhook_deliveries', {
      store_id: opts.storeId ?? 1,
      endpoint_id: endpoint.id,
      event_id: BODY.event_id,
      event_type: BODY.type,
      payload: BODY,
    });
    return { endpoint, delivery };
  }

  const row = (deliveryId: number, attempts = 1, storeId = 1) => ({
    id: 10,
    store_id: storeId,
    attempts,
    payload: { delivery_id: deliveryId },
  });
  const delivery = (id: number) =>
    db.table('workflow_webhook_deliveries').find((d) => d.id === id)!;

  beforeEach(() => {
    db = new FakeWorkflowDb();
    encryption = new EncryptionService();
    service = new WorkflowWebhookDeliveryService(
      db.asStorePrisma(),
      encryption,
    );
    transport = jest.fn();
    service.transport = transport;
  });

  it('2xx: marca delivered con código, envía firma válida y cabeceras X-Vendix-*', async () => {
    const { delivery: d } = seed();
    transport.mockResolvedValue({ status: 200, body: 'ok' });
    await inStore(1, () => service.deliver(row(d.id), NOW));

    const sent = transport.mock.calls[0][0];
    expect(sent.url).toBe('https://hooks.example.com/vendix');
    expect(sent.body).toBe(JSON.stringify(BODY));
    expect(sent.headers['X-Vendix-Event']).toBe('workflow.instance.started');
    expect(sent.headers['X-Vendix-Delivery']).toBe(String(d.id));
    expect(sent.headers['Content-Type']).toBe('application/json');
    const nowSec = Math.floor(NOW.getTime() / 1000);
    expect(sent.headers['X-Vendix-Signature']).toMatch(
      new RegExp(`^t=${nowSec},v1=[0-9a-f]{64}$`),
    );
    expect(
      verifySignatureHeader(
        SECRET,
        sent.headers['X-Vendix-Signature'],
        sent.body,
        { now: nowSec },
      ),
    ).toBe(true);
    expect(delivery(d.id)).toMatchObject({
      status: 'delivered',
      attempts: 1,
      status_code: 200,
      last_error: null,
      delivered_at: NOW,
    });
  });

  it('el cuerpo es idéntico en cada reintento (mismo event_id)', async () => {
    const { delivery: d } = seed();
    transport
      .mockResolvedValueOnce({ status: 503, body: '' })
      .mockResolvedValueOnce({ status: 200, body: '' });
    await expect(
      inStore(1, () => service.deliver(row(d.id, 1), NOW)),
    ).rejects.toThrow('HTTP 503');
    await inStore(1, () => service.deliver(row(d.id, 2), NOW));
    expect(transport.mock.calls[0][0].body).toBe(
      transport.mock.calls[1][0].body,
    );
    expect(JSON.parse(transport.mock.calls[1][0].body).event_id).toBe('evt-1');
    expect(delivery(d.id)).toMatchObject({ status: 'delivered', attempts: 2 });
  });

  it('no-2xx: failed, guarda código y cuerpo truncado, programa el siguiente reintento y lanza', async () => {
    const { delivery: d } = seed();
    transport.mockResolvedValue({ status: 500, body: 'x'.repeat(4096) });
    await expect(
      inStore(1, () => service.deliver(row(d.id, 1), NOW)),
    ).rejects.toThrow('HTTP 500');
    const stored = delivery(d.id);
    expect(stored).toMatchObject({
      status: 'failed',
      attempts: 1,
      status_code: 500,
      delivered_at: null,
    });
    expect(stored.last_error.length).toBeLessThanOrEqual(501);
    expect(stored.next_retry_at).toEqual(
      new Date(NOW.getTime() + OUTBOX_BACKOFF_MINUTES[0] * 60_000),
    );
  });

  it('el backoff sigue la curva del outbox en cada intento', async () => {
    const { delivery: d } = seed();
    transport.mockResolvedValue({ status: 502, body: '' });
    for (let attempt = 1; attempt < OUTBOX_MAX_ATTEMPTS; attempt++) {
      await expect(
        inStore(1, () => service.deliver(row(d.id, attempt), NOW)),
      ).rejects.toThrow();
      expect(delivery(d.id).status).toBe('failed');
      expect(delivery(d.id).next_retry_at).toEqual(
        new Date(NOW.getTime() + OUTBOX_BACKOFF_MINUTES[attempt - 1] * 60_000),
      );
    }
  });

  it('dead al sexto intento: sin siguiente reintento', async () => {
    const { delivery: d } = seed();
    transport.mockResolvedValue({ status: 500, body: 'boom' });
    await expect(
      inStore(1, () => service.deliver(row(d.id, OUTBOX_MAX_ATTEMPTS), NOW)),
    ).rejects.toThrow('HTTP 500');
    expect(delivery(d.id)).toMatchObject({
      status: 'dead',
      status_code: 500,
      next_retry_at: null,
    });
  });

  it('no sigue redirecciones: un 301/302/307 es un fallo con su código', async () => {
    const { delivery: d } = seed();
    transport.mockResolvedValue({ status: 302, body: '' });
    await expect(
      inStore(1, () => service.deliver(row(d.id), NOW)),
    ).rejects.toThrow('HTTP 302');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(delivery(d.id)).toMatchObject({
      status: 'failed',
      status_code: 302,
    });
  });

  it('error de red / timeout: failed con el mensaje y sin código', async () => {
    const { delivery: d } = seed();
    transport.mockRejectedValue(new Error('Webhook request timed out'));
    await expect(
      inStore(1, () => service.deliver(row(d.id), NOW)),
    ).rejects.toThrow('timed out');
    expect(delivery(d.id)).toMatchObject({
      status: 'failed',
      status_code: null,
      last_error: 'Webhook request timed out',
    });
  });

  it('una URL que ya no pasa la política (o resuelve a privado) no se envía y queda dead sin reintentar', async () => {
    const { delivery: d } = seed({ url: 'https://169.254.169.254/latest' });
    await inStore(1, () => service.deliver(row(d.id), NOW));
    expect(transport).not.toHaveBeenCalled();
    expect(delivery(d.id)).toMatchObject({ status: 'dead', attempts: 1 });
    expect(delivery(d.id).last_error).toMatch(/not allowed/i);
  });

  it('el transporte que rechaza por DNS privado cuenta como fallo reintentable', async () => {
    const { delivery: d } = seed();
    transport.mockRejectedValue(
      new Error(
        'Webhook URL not allowed: host resolves to a private or reserved address',
      ),
    );
    await expect(
      inStore(1, () => service.deliver(row(d.id), NOW)),
    ).rejects.toThrow('private');
    expect(delivery(d.id).status).toBe('failed');
  });

  it('endpoint desactivado o borrado: dead sin enviar ni reintentar', async () => {
    const { delivery: d } = seed({ active: false });
    await inStore(1, () => service.deliver(row(d.id), NOW));
    expect(transport).not.toHaveBeenCalled();
    expect(delivery(d.id)).toMatchObject({
      status: 'dead',
      last_error: 'Endpoint disabled or deleted',
    });
  });

  it('un secreto que no se puede descifrar deja la entrega dead sin enviar', async () => {
    const { endpoint, delivery: d } = seed();
    endpoint.secret_enc = 'basura';
    await inStore(1, () => service.deliver(row(d.id), NOW));
    expect(transport).not.toHaveBeenCalled();
    expect(delivery(d.id).status).toBe('dead');
  });

  it('una entrega ya entregada no se reenvía; otra tienda no ve la entrega', async () => {
    const { delivery: d } = seed();
    d.status = 'delivered';
    await inStore(1, () => service.deliver(row(d.id), NOW));
    expect(transport).not.toHaveBeenCalled();

    const other = seed({ storeId: 2 });
    other.delivery.event_id = 'evt-2';
    await inStore(1, () => service.deliver(row(other.delivery.id, 1, 1), NOW));
    expect(transport).not.toHaveBeenCalled();
    expect(delivery(other.delivery.id).status).toBe('pending');
  });
});
