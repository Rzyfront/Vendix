import { WorkflowInstanceRow } from '../workflow-engine.types';
import { OutboundHttpRequest, OutboundTimeoutError } from '../../webhooks/webhook-transport';
import {
  HTTP_MAX_RESPONSE_BYTES,
  HttpCallError,
  WorkflowHttpActions,
  mapResponseOutput,
} from './http.actions';
import { WorkflowActionContext, WorkflowActionInputError } from './workflow-action.types';

const PUBLIC_URL = 'https://api.example.com/v1/clients';
const SECRET_VALUE = 'tok_live_9f8e7d6c5b4a';

function build(opts: { secrets?: Record<string, string>; resolver?: Record<string, string[]> } = {}) {
  const secrets = {
    resolveMany: jest.fn(async (_store: number, names: readonly string[]) => {
      const out = new Map<string, string>();
      for (const n of names) if (opts.secrets?.[n] !== undefined) out.set(n, opts.secrets[n]);
      return out;
    }),
  };
  const actions = new WorkflowHttpActions(secrets as never);
  const sent: OutboundHttpRequest[] = [];
  const reply = {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'r-1' } as Record<string, string>,
    body: JSON.stringify({ id: 'crm-77', items: [{ name: 'Ana' }], total: '12.5' }),
    truncated: false,
  };
  actions.transport = jest.fn(async (req: OutboundHttpRequest) => {
    sent.push(req);
    return { ...reply };
  });
  const table = opts.resolver ?? {};
  actions.resolver = async (host) => {
    const addrs = table[host] ?? ['93.184.216.34'];
    return addrs.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { actions, secrets, sent, reply };
}

const ctx = (map: Record<string, unknown>, output?: Record<string, string>): WorkflowActionContext => ({
  instance: { store_id: 1, organization_id: 1 } as WorkflowInstanceRow,
  map,
  ...(output ? { output } : {}),
  actingUserId: 1,
  permissions: [],
  asPublisher: (fn) => fn(),
});

const call = (b: ReturnType<typeof build>, map: Record<string, unknown>, output?: Record<string, string>) =>
  b.actions.handlers['vendix.http.request']!(ctx({ method: 'POST', url: PUBLIC_URL, ...map }, output));

describe('vendix.http.request', () => {
  it('resuelve {{secrets.NAME}} al ejecutar y lo manda en el encabezado, no antes', async () => {
    const b = build({ secrets: { CRM_TOKEN: SECRET_VALUE } });
    await call(b, {
      headers: 'Authorization: Bearer {{secrets.CRM_TOKEN}}\nX-Source: vendix',
      body: '{"name":"Ana"}',
    });
    expect(b.secrets.resolveMany).toHaveBeenCalledWith(1, ['CRM_TOKEN']);
    expect(b.sent).toHaveLength(1);
    expect(b.sent[0]).toMatchObject({
      method: 'POST',
      url: PUBLIC_URL,
      body: '{"name":"Ana"}',
      timeoutMs: 10_000,
      maxResponseBytes: HTTP_MAX_RESPONSE_BYTES,
    });
    expect(b.sent[0].headers).toMatchObject({
      Authorization: `Bearer ${SECRET_VALUE}`,
      'X-Source': 'vendix',
      'Content-Type': 'application/json',
    });
  });

  it('un secreto que no existe falla sin reintento y con un mensaje claro', async () => {
    const b = build({ secrets: {} });
    const p = call(b, { headers: 'Authorization: Bearer {{secrets.NOPE}}' });
    await expect(p).rejects.toBeInstanceOf(WorkflowActionInputError);
    await expect(p).rejects.toThrow('El secreto "NOPE" no existe');
    expect(b.sent).toHaveLength(0);
  });

  it.each([
    ['127.0.0.1', 'http://127.0.0.1/admin'],
    ['red 10.x', 'http://10.1.2.3/'],
    ['metadatos IPv4', 'http://169.254.169.254/latest/meta-data'],
    ['metadatos IPv6', 'http://[fd00:ec2::254]/'],
    ['localhost', 'https://localhost/'],
  ])('bloquea %s sin llamar al transporte', async (_n, url) => {
    const b = build();
    const p = call(b, { url });
    await expect(p).rejects.toBeInstanceOf(WorkflowActionInputError);
    await expect(p).rejects.toThrow(/Destino (bloqueado|no permitido)/);
    expect(b.sent).toHaveLength(0);
  });

  it('bloquea un nombre que resuelve a una IP privada', async () => {
    const b = build({ resolver: { 'evil.example.com': ['93.184.216.34', '10.0.0.5'] } });
    await expect(call(b, { url: 'https://evil.example.com/x' })).rejects.toThrow(
      'Destino bloqueado: dirección privada o de metadatos',
    );
    expect(b.sent).toHaveLength(0);
  });

  it('permite http solo hacia direcciones públicas', async () => {
    const b = build();
    await call(b, { url: 'http://api.example.com/ping' });
    expect(b.sent[0].url).toBe('http://api.example.com/ping');
  });

  it('rechaza inyección de encabezados y los encabezados reservados', async () => {
    const b = build({ secrets: { T: 'abc\r\nX-Evil: 1' } });
    await expect(call(b, { headers: 'X-A: 1\nHost: evil.com' })).rejects.toThrow(/Host/);
    await expect(call(b, { headers: 'Content-Length: 5' })).rejects.toThrow(/Content-Length/);
    await expect(call(b, { headers: 'Transfer-Encoding: chunked' })).rejects.toThrow(/Transfer-Encoding/);
    await expect(call(b, { headers: 'Connection: keep-alive' })).rejects.toThrow(/Connection/);
    await expect(call(b, { headers: 'X-A: uno\rdos' })).rejects.toThrow(/control/);
    await expect(call(b, { headers: 'X-Token: {{secrets.T}}' })).rejects.toThrow(/control/);
    await expect(call(b, { headers: 'sin dos puntos' })).rejects.toThrow(/no válido/);
    expect(b.sent).toHaveLength(0);
  });

  it('5xx, 429 y red son reintentables; 4xx y redirecciones no', async () => {
    const b = build();
    for (const status of [500, 503, 429]) {
      b.actions.transport = jest.fn(async () => ({ status, headers: {}, body: '', truncated: false }));
      const e = await call(b, {}).catch((x) => x);
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(WorkflowActionInputError);
    }
    for (const status of [400, 401, 404, 422, 302]) {
      b.actions.transport = jest.fn(async () => ({ status, headers: {}, body: '', truncated: false }));
      await expect(call(b, {})).rejects.toBeInstanceOf(WorkflowActionInputError);
    }
    b.actions.transport = jest.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'ECONNRESET' });
    });
    const net = await call(b, {}).catch((x) => x);
    expect(net).not.toBeInstanceOf(WorkflowActionInputError);
    expect(net.message).toContain('ECONNRESET');
  });

  it('el tiempo máximo: 10 s por defecto, hasta 30 s, y un tiempo agotado se reintenta', async () => {
    const b = build();
    await call(b, { timeout_seconds: '25' });
    expect(b.sent[0].timeoutMs).toBe(25_000);
    await expect(call(b, { timeout_seconds: '31' })).rejects.toBeInstanceOf(WorkflowActionInputError);
    b.actions.transport = jest.fn(async () => {
      throw new OutboundTimeoutError(10);
    });
    const e = await call(b, {}).catch((x) => x);
    expect(e).not.toBeInstanceOf(WorkflowActionInputError);
    expect(e.message).toBe('El servicio no respondió en 10 segundos.');
  });

  it('GET con cuerpo se rechaza (nada se descarta en silencio)', async () => {
    const b = build();
    await expect(call(b, { method: 'GET', body: 'x' })).rejects.toThrow(/GET no lleva cuerpo/);
  });

  it('devuelve los campos mapeados de la respuesta (status, body.ruta, headers) y nada más', async () => {
    const b = build();
    const res = await call(b, {}, {
      crm_id: 'body.id',
      first: 'body.items.0.name',
      total: 'body.total',
      http_status: 'status',
      req: 'headers.x-request-id',
      missing: 'body.nope.deep',
    });
    expect(res.record_id).toBeNull();
    expect(res.fields).toEqual({
      crm_id: 'crm-77',
      first: 'Ana',
      total: '12.5',
      http_status: 200,
      req: 'r-1',
    });
  });

  it('manda Idempotency-Key con la fila del outbox (igual en cada reintento) y respeta la del flujo', async () => {
    const b = build();
    const withRow = (map: Record<string, unknown>) =>
      b.actions.handlers['vendix.http.request']!({
        ...ctx({ method: 'POST', url: PUBLIC_URL, ...map }),
        outboxId: 42,
      });
    await withRow({});
    await withRow({});
    expect(b.sent.map((r) => r.headers['Idempotency-Key'])).toEqual(['wf-42', 'wf-42']);
    await withRow({ headers: 'idempotency-key: mia' });
    expect(b.sent[2].headers).toMatchObject({ 'idempotency-key': 'mia' });
    expect(b.sent[2].headers).not.toHaveProperty('Idempotency-Key');
    // "Probar esta acción" has no outbox row: no key.
    await b.actions.perform(1, { method: 'POST', url: PUBLIC_URL });
    expect(b.sent[3].headers).not.toHaveProperty('Idempotency-Key');
  });

  it('enmascara un secreto que el destino devuelve en un encabezado', async () => {
    const b = build({ secrets: { CRM_TOKEN: SECRET_VALUE } });
    b.reply.headers = { 'x-echo': `Bearer ${SECRET_VALUE}` };
    const map = { method: 'POST', url: PUBLIC_URL, headers: 'Authorization: Bearer {{secrets.CRM_TOKEN}}' };
    const res = await b.actions.handlers['vendix.http.request']!(ctx(map, { eco: 'headers.x-echo' }));
    expect(res.fields).toEqual({ eco: 'Bearer ••••' });
    const outcome = await b.actions.perform(1, map);
    expect(JSON.stringify(outcome.headers)).not.toContain(SECRET_VALUE);
  });

  it('un cuerpo que no es JSON solo se puede mapear entero', () => {
    const res = { status: 200, headers: {}, body: 'OK plano' };
    expect(mapResponseOutput({ a: 'body', b: 'body.x' }, res)).toEqual({ a: 'OK plano' });
  });

  it('HttpCallError conserva su tipo para "Probar esta acción"', async () => {
    const b = build();
    const e = await b.actions.perform(1, { method: 'GET', url: 'http://127.0.0.1/' }).catch((x) => x);
    expect(e).toBeInstanceOf(HttpCallError);
    expect(e.kind).toBe('blocked');
    expect(e.retryable).toBe(false);
  });
});
