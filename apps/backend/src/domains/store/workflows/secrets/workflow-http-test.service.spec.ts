import 'reflect-metadata';
import { RequestContextService } from '@common/context/request-context.service';
import { INDUSTRY_MODULE_KEY } from '../../../../common/decorators/industry-module.decorator';
import { PERMISSIONS_KEY } from '../../../auth/decorators/permissions.decorator';
import { WorkflowHttpActions } from '../engine/actions/http.actions';
import { WorkflowHttpTestController } from './workflow-http-test.controller';
import { WorkflowSecretsController } from './workflow-secrets.controller';
import { WorkflowHttpTestService } from './workflow-http-test.service';

const SECRET = 'tok_live_9f8e7d6c5b4a';

function build(reply: Partial<{ status: number; body: string; headers: Record<string, string>; truncated: boolean }> = {}) {
  const secrets = {
    resolveMany: jest.fn(async (_s: number, names: readonly string[]) =>
      new Map(names.filter((n) => n === 'CRM_TOKEN').map((n) => [n, SECRET])),
    ),
  };
  const actions = new WorkflowHttpActions(secrets as never);
  actions.transport = jest.fn(async () => ({
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': 's=1', 'x-echo': `got ${SECRET}` },
    body: JSON.stringify({ id: 'crm-5', echo: `Bearer ${SECRET}` }),
    truncated: false,
    ...reply,
  }));
  actions.resolver = async () => [{ address: '93.184.216.34', family: 4 }];
  return { tester: new WorkflowHttpTestService(actions), actions, secrets };
}

const run = <T>(fn: () => Promise<T>) =>
  RequestContextService.runIsolated(
    { store_id: 1, organization_id: 1, user_id: 1, is_super_admin: false, is_owner: false },
    fn,
  );

const dto = (over: Record<string, unknown> = {}) => ({
  map: {
    method: 'POST',
    url: 'https://api.example.com/c/{{fields.cliente}}',
    headers: 'Authorization: Bearer {{secrets.CRM_TOKEN}}',
    body: '{"n":"{{fields.cliente}}"}',
  },
  output: { crm_id: 'body.id', http: 'status' },
  sample_fields: { cliente: 'acme' },
  ...over,
});

describe('"Probar esta acción" (WorkflowHttpTestService)', () => {
  it('hace la llamada real con los valores de muestra y devuelve estado, encabezados, cuerpo y campos', async () => {
    const { tester, actions } = build();
    const res = await run(() => tester.test(dto() as never));
    const sent = (actions.transport as jest.Mock).mock.calls[0][0];
    expect(sent.url).toBe('https://api.example.com/c/acme');
    expect(sent.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(res).toMatchObject({
      ok: true,
      status: 200,
      body_truncated: false,
      output: { crm_id: 'crm-5', http: 200 },
    });
    if (res.ok) {
      expect(res.headers['content-type']).toBe('application/json');
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(typeof res.duration_ms).toBe('number');
    }
  });

  it('nunca devuelve el valor del secreto, ni siquiera si el servicio lo repite', async () => {
    const { tester } = build();
    const res = await run(() => tester.test(dto() as never));
    expect(JSON.stringify(res)).not.toContain(SECRET);
    if (res.ok) {
      expect(res.body).toContain('Bearer ••••');
      expect(res.headers['x-echo']).toBe('got ••••');
    }
  });

  it('el cuerpo se corta a 20 KB como vista previa', async () => {
    const { tester } = build({ body: 'x'.repeat(30_000) });
    const res = await run(() => tester.test(dto({ output: {} }) as never));
    expect(res.ok && res.body.length).toBe(20 * 1024);
    expect(res.ok && res.body_truncated).toBe(true);
  });

  it('devuelve un mensaje claro si el destino está bloqueado, sin llamar', async () => {
    const { tester, actions } = build();
    const res = await run(() =>
      tester.test(dto({ map: { method: 'GET', url: 'http://169.254.169.254/' } }) as never),
    );
    expect(res).toEqual({
      ok: false,
      error: { kind: 'blocked', message: 'Destino bloqueado: dirección privada o de metadatos' },
    });
    expect(actions.transport).not.toHaveBeenCalled();
  });

  it('un secreto inexistente, una salida inválida y un fallo de red se explican', async () => {
    const { tester, actions } = build();
    const secret = await run(() =>
      tester.test(dto({ map: { method: 'GET', url: 'https://a.example.com/', headers: 'X: {{secrets.NOPE}}' } }) as never),
    );
    expect(secret).toMatchObject({ ok: false, error: { kind: 'secret' } });
    const out = await run(() => tester.test(dto({ output: { a: 'body..x' } }) as never));
    expect(out).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    (actions.transport as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
    const net = await run(() => tester.test(dto() as never));
    expect(net).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(net.ok === false && net.error.message).toContain('ECONNREFUSED');
  });

  it('un 4xx del servicio se muestra como respuesta real (no es error de la prueba)', async () => {
    const { tester } = build({ status: 404, body: 'no existe' });
    const res = await run(() => tester.test(dto({ output: { s: 'status' } }) as never));
    expect(res).toMatchObject({ ok: true, status: 404, body: 'no existe', output: { s: 404 } });
  });
});

describe('superficie de los controladores de secretos y prueba', () => {
  const perm = (c: object, m: string) =>
    Reflect.getMetadata(PERMISSIONS_KEY, (c as never as Record<string, object>)[m]);

  it('lectura con diseño; escritura y borrado con manage; la prueba con diseño', () => {
    const p = WorkflowSecretsController.prototype;
    expect(Reflect.getMetadata('path', WorkflowSecretsController)).toBe('store/workflows/secrets');
    expect(perm(p, 'list')).toEqual(['store:workflows:design']);
    for (const m of ['create', 'replace', 'remove']) expect(perm(p, m)).toEqual(['store:workflows:manage']);
    expect(Reflect.getMetadata(INDUSTRY_MODULE_KEY, WorkflowSecretsController)).toBe('flows');
    expect(Reflect.getMetadata('path', WorkflowHttpTestController)).toBe('store/workflows/http');
    expect(perm(WorkflowHttpTestController.prototype, 'test')).toEqual(['store:workflows:design']);
  });
});
