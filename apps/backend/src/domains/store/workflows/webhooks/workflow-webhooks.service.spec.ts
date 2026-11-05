import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { FakeWorkflowDb } from '../../../../testing/workflows/fake-workflow-prisma';
import { WorkflowWebhookEmitter } from './workflow-webhook-emitter.service';
import { WorkflowWebhooksService } from './workflow-webhooks.service';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e instanceof VendixHttpException
      ? e.errorCode
      : `OTHER:${(e as Error).message}`;
  }
};

describe('WorkflowWebhooksService', () => {
  let db: FakeWorkflowDb;
  let service: WorkflowWebhooksService;
  let encryption: EncryptionService;
  let storeId = 1;

  const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
  const run = <T>(fn: () => Promise<T>, store = storeId, user = 1) =>
    RequestContextService.runIsolated(
      {
        store_id: store,
        organization_id: 1,
        user_id: user,
        is_super_admin: false,
        is_owner: false,
      },
      fn,
    );
  const dto = (over: Record<string, unknown> = {}) => ({
    url: 'https://hooks.example.com/vendix',
    event_types: ['workflow.instance.started'],
    ...over,
  });
  const create = (over: Record<string, unknown> = {}) =>
    run(() => service.create(dto(over) as any));

  beforeEach(() => {
    storeId = 1;
    db = new FakeWorkflowDb();
    encryption = new EncryptionService();
    service = new WorkflowWebhooksService(
      db.asStorePrisma(),
      encryption,
      new WorkflowWebhookEmitter(),
    );
    service.resolver = publicDns;
  });

  describe('crear y secreto', () => {
    it('devuelve el secreto whsec_ una sola vez y lo guarda cifrado', async () => {
      const created = await create();
      expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      const stored = db.table('workflow_webhook_endpoints')[0];
      expect(stored.secret_enc).not.toContain(created.secret);
      expect(stored.secret_enc).not.toBe(created.secret);
      expect(encryption.decrypt(stored.secret_enc)).toBe(created.secret);
      expect(stored).toMatchObject({
        store_id: 1,
        organization_id: 1,
        is_active: true,
        created_by_user_id: 1,
      });
      expect((created as any).secret_enc).toBeUndefined();
    });

    it('list / update / rotate / remove nunca vuelven a mostrar el secreto ni secret_enc', async () => {
      const created = await create();
      const all = [
        ...(await run(() => service.list())),
        await run(() => service.update(created.id, { description: 'x' })),
        await run(() => service.remove(created.id)),
      ];
      for (const item of all) {
        expect(JSON.stringify(item)).not.toContain(created.secret);
        expect(item).not.toHaveProperty('secret');
        expect(item).not.toHaveProperty('secret_enc');
      }
    });

    it('cada secreto es distinto y la rotación entrega uno nuevo una vez y reemplaza al anterior', async () => {
      const a = await create();
      const b = await create({ url: 'https://other.example.com/h' });
      expect(a.secret).not.toBe(b.secret);
      const before = db.table('workflow_webhook_endpoints')[0].secret_enc;
      const rotated = await run(() => service.rotateSecret(a.id));
      expect(rotated.secret).toMatch(/^whsec_/);
      expect(rotated.secret).not.toBe(a.secret);
      const after = db.table('workflow_webhook_endpoints')[0].secret_enc;
      expect(after).not.toBe(before);
      expect(encryption.decrypt(after)).toBe(rotated.secret);
      expect(await run(() => service.list())).toEqual(
        expect.not.arrayContaining([
          expect.objectContaining({ secret: expect.anything() }),
        ]),
      );
    });

    it('valida eventos: vacío, desconocido o "ping" no se pueden suscribir', async () => {
      for (const event_types of [
        [],
        ['order.created'],
        ['ping'],
        ['workflow.instance.started', 'x'],
      ]) {
        expect(await code(create({ event_types }))).toBe(
          'WEBHOOK_EVENT_INVALID',
        );
      }
      expect(db.table('workflow_webhook_endpoints')).toHaveLength(0);
    });
  });

  describe('política de URL (SSRF) al crear y editar', () => {
    it.each([
      ['http plano', 'http://hooks.example.com/x'],
      ['IP privada', 'https://10.0.0.5/x'],
      ['metadata', 'https://169.254.169.254/latest/meta-data'],
      ['loopback', 'https://127.0.0.1/x'],
      ['IPv6 mapeada', 'https://[::ffff:7f00:1]/x'],
      ['decimal', 'https://2130706433/x'],
      ['localhost', 'https://localhost/x'],
      ['credenciales', 'https://u:p@hooks.example.com/x'],
      ['puerto 22', 'https://hooks.example.com:22/x'],
    ])('rechaza %s', async (_n, url) => {
      expect(await code(create({ url }))).toBe('WEBHOOK_URL_INVALID');
      expect(db.table('workflow_webhook_endpoints')).toHaveLength(0);
    });

    it('rechaza un nombre que resuelve a una IP privada o que no resuelve', async () => {
      service.resolver = async () => [{ address: '192.168.1.20', family: 4 }];
      expect(await code(create())).toBe('WEBHOOK_URL_INVALID');
      service.resolver = async () => {
        throw new Error('ENOTFOUND');
      };
      expect(await code(create())).toBe('WEBHOOK_URL_INVALID');
    });

    it('al editar la URL se vuelve a validar', async () => {
      const created = await create();
      expect(
        await code(
          run(() => service.update(created.id, { url: 'https://127.0.0.1/x' })),
        ),
      ).toBe('WEBHOOK_URL_INVALID');
      expect(db.table('workflow_webhook_endpoints')[0].url).toBe(
        'https://hooks.example.com/vendix',
      );
      const ok = await run(() =>
        service.update(created.id, { url: 'https://new.example.com/h' }),
      );
      expect(ok.url).toBe('https://new.example.com/h');
    });
  });

  describe('límite de 10 endpoints activos por tienda', () => {
    it('el 11.º activo falla; desactivar uno libera cupo; reactivar respeta el tope', async () => {
      const made: Awaited<ReturnType<typeof create>>[] = [];
      for (let i = 0; i < 10; i++)
        made.push(await create({ url: `https://h${i}.example.com/x` }));
      expect(await code(create({ url: 'https://h10.example.com/x' }))).toBe(
        'WEBHOOK_LIMIT_REACHED',
      );
      await run(() => service.remove(made[0].id));
      const eleventh = await create({ url: 'https://h10.example.com/x' });
      expect(eleventh.id).toBeDefined();
      expect(
        await code(run(() => service.update(made[0].id, { is_active: true }))),
      ).toBe('WEBHOOK_LIMIT_REACHED');
    });

    it('el tope es por tienda', async () => {
      for (let i = 0; i < 10; i++)
        await create({ url: `https://h${i}.example.com/x` });
      storeId = 2;
      expect((await create()).id).toBeDefined();
    });
  });

  describe('aislamiento por tienda', () => {
    it('otra tienda no ve, edita, rota, borra, prueba ni lista entregas', async () => {
      const mine = await create();
      storeId = 2;
      expect(await run(() => service.list())).toEqual([]);
      expect(
        await code(run(() => service.update(mine.id, { description: 'x' }))),
      ).toBe('WEBHOOK_NOT_FOUND');
      expect(await code(run(() => service.rotateSecret(mine.id)))).toBe(
        'WEBHOOK_NOT_FOUND',
      );
      expect(await code(run(() => service.remove(mine.id)))).toBe(
        'WEBHOOK_NOT_FOUND',
      );
      expect(await code(run(() => service.test(mine.id)))).toBe(
        'WEBHOOK_NOT_FOUND',
      );
      expect(await code(run(() => service.deliveries(mine.id, {})))).toBe(
        'WEBHOOK_NOT_FOUND',
      );
      expect(db.table('workflow_webhook_endpoints')[0].is_active).toBe(true);
    });

    it('otra tienda no puede reintentar la entrega ajena', async () => {
      const mine = await create();
      const d = db.insert('workflow_webhook_deliveries', {
        store_id: 1,
        endpoint_id: mine.id,
        event_id: 'e',
        event_type: 'ping',
        payload: {},
        status: 'dead',
      });
      storeId = 2;
      expect(await code(run(() => service.retryDelivery(d.id)))).toBe(
        'WEBHOOK_DELIVERY_NOT_FOUND',
      );
      expect(db.table('workflow_outbox')).toHaveLength(0);
    });
  });

  describe('borrado suave, prueba, panel y reintento', () => {
    it('remove desactiva (no borra) y deja el historial', async () => {
      const c = await create();
      const removed = await run(() => service.remove(c.id));
      expect(removed.is_active).toBe(false);
      expect(db.table('workflow_webhook_endpoints')).toHaveLength(1);
    });

    it('test encola un evento ping por el outbox y falla si el endpoint está inactivo', async () => {
      const c = await create();
      const r = await run(() => service.test(c.id));
      const delivery = db.table('workflow_webhook_deliveries')[0];
      expect(delivery).toMatchObject({
        endpoint_id: c.id,
        event_type: 'ping',
        status: 'pending',
        store_id: 1,
      });
      expect(delivery.payload).toMatchObject({
        type: 'ping',
        event_id: r.event_id,
        store_id: 1,
      });
      expect(db.table('workflow_outbox')[0]).toMatchObject({
        kind: 'webhook',
        store_id: 1,
        payload: { delivery_id: delivery.id },
      });
      await run(() => service.remove(c.id));
      expect(await code(run(() => service.test(c.id)))).toBe(
        'WEBHOOK_INACTIVE',
      );
    });

    it('deliveries pagina, filtra por estado y no expone el payload ni el secreto', async () => {
      const c = await create();
      for (let i = 0; i < 5; i++) {
        db.insert('workflow_webhook_deliveries', {
          store_id: 1,
          endpoint_id: c.id,
          event_id: `e${i}`,
          event_type: 'x',
          payload: { secret: 'no' },
          status: i < 2 ? 'dead' : 'delivered',
        });
      }
      const page = await run(() =>
        service.deliveries(c.id, { page: 1, limit: 2 }),
      );
      expect(page).toMatchObject({ total: 5, page: 1, limit: 2 });
      expect(page.data).toHaveLength(2);
      expect(page.data[0]).not.toHaveProperty('payload');
      const dead = await run(() =>
        service.deliveries(c.id, { status: 'dead' }),
      );
      expect(dead.total).toBe(2);
    });

    it('retry reencola solo entregas failed/dead, conservando event_id y cuerpo', async () => {
      const c = await create();
      const mk = (status: string, id: string) =>
        db.insert('workflow_webhook_deliveries', {
          store_id: 1,
          endpoint_id: c.id,
          event_id: id,
          event_type: 'x',
          payload: { event_id: id },
          status,
          attempts: 6,
        });
      const dead = mk('dead', 'e-dead');
      const delivered = mk('delivered', 'e-ok');
      const pending = mk('pending', 'e-pending');
      expect(await run(() => service.retryDelivery(dead.id))).toEqual({
        delivery_id: dead.id,
        status: 'pending',
      });
      expect(dead).toMatchObject({
        status: 'pending',
        event_id: 'e-dead',
        attempts: 6,
      });
      expect(db.table('workflow_outbox')).toHaveLength(1);
      expect(await code(run(() => service.retryDelivery(delivered.id)))).toBe(
        'WEBHOOK_DELIVERY_NOT_RETRYABLE',
      );
      expect(await code(run(() => service.retryDelivery(pending.id)))).toBe(
        'WEBHOOK_DELIVERY_NOT_RETRYABLE',
      );
      expect(db.table('workflow_outbox')).toHaveLength(1);
    });
  });
});
