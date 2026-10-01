import { createHash, randomUUID } from 'node:crypto';
import { PlanApprovalService } from './plan-approval.service';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from '../../../../ai-engine/tools/bridge/capability-registry.service';

/** Mirrors the service's canonical JSON so the spec hashes identically. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

function stepHash(tool: string, args: Record<string, any>): string {
  return createHash('sha256')
    .update(`${tool}|${canonicalJson(args ?? {})}`)
    .digest('hex');
}

/**
 * In-memory twin of the Redis hash + Lua redeem script: same fields, same
 * return codes. The spec asserts behavior through it instead of
 * re-implementing Redis.
 */
function makeRedis() {
  const store = new Map<string, Map<string, string>>();
  return {
    hset: jest.fn(async (key: string, fields: Record<string, string>) => {
      let hash = store.get(key);
      if (!hash) {
        hash = new Map();
        store.set(key, hash);
      }
      for (const [k, v] of Object.entries(fields)) hash.set(k, v);
      return Object.keys(fields).length;
    }),
    hgetall: jest.fn(async (key: string) => {
      const hash = store.get(key);
      const out: Record<string, string> = {};
      hash?.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    }),
    expire: jest.fn(async () => 1),
    eval: jest.fn(
      async (
        _script: string,
        _nkeys: number,
        key: string,
        fp: string,
        field: string,
      ) => {
        const hash = store.get(key);
        const stored = hash?.get('fp');
        if (!stored) return 0;
        if (stored !== fp) return -1;
        const v = hash?.get(field);
        if (!v) return -2;
        if (v === 'I') return -3;
        if (v === '1') return -4;
        hash?.set(field, '1');
        return 1;
      },
    ),
  };
}

function makeRegistry() {
  const tools = new Map<string, { domain: string; irreversible?: boolean }>([
    ['update_product_price', { domain: 'products' }],
    ['create_customer', { domain: 'customers' }],
    ['adjust_stock', { domain: 'inventory' }],
    ['send_invoice_dian', { domain: 'invoicing' }],
    ['settle_payroll', { domain: 'payroll', irreversible: true }],
    // Sin marca explícita a propósito: la red por dominio debe atraparlos.
    ['close_cash_session', { domain: 'cash-register' }],
    ['collect_receivable', { domain: 'receivables-payables' }],
    ['submit_exogenous_report', { domain: 'withholding', irreversible: true }],
    ['write_endpoint', { domain: 'bridge' }],
  ]);
  return { get: jest.fn((name: string) => tools.get(name)) };
}

describe('PlanApprovalService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let registry: ReturnType<typeof makeRegistry>;
  let service: PlanApprovalService;

  beforeEach(() => {
    redis = makeRedis();
    registry = makeRegistry();
    service = new PlanApprovalService(redis as any, registry as any);
  });

  it('approves three reversible writes once and runs each exactly once', async () => {
    const steps = [
      { order: 1, tool: 'update_product_price', args: { id: 7, price: 5000 } },
      { order: 2, tool: 'create_customer', args: { name: 'Acme' } },
      { order: 3, tool: 'adjust_stock', args: { id: 7, qty: 2 } },
    ];
    const planId = randomUUID();
    const token = await service.issuePlanToken(planId, 11, steps);

    for (const s of steps) {
      await expect(
        service.redeemPlanStep(token, planId, 11, s.tool, s.args),
      ).resolves.toBe('ok');
    }
    // Every step ran: replaying any of them is rejected.
    await expect(
      service.redeemPlanStep(token, planId, 11, steps[0].tool, steps[0].args),
    ).resolves.toBe('replayed');
  });

  it('rejects altered arguments as an unknown step', async () => {
    const steps = [
      { order: 1, tool: 'update_product_price', args: { id: 7, price: 5000 } },
    ];
    const planId = randomUUID();
    const token = await service.issuePlanToken(planId, 11, steps);

    await expect(
      service.redeemPlanStep(token, planId, 11, 'update_product_price', {
        id: 7,
        price: 999999,
      }),
    ).resolves.toBe('unknown_step');
  });

  it('is insensitive to argument key order between proposal and apply', async () => {
    const steps = [
      {
        order: 1,
        tool: 'update_product_price',
        args: { id: 7, price: 5000 },
      },
    ];
    const planId = randomUUID();
    const token = await service.issuePlanToken(planId, 11, steps);

    await expect(
      service.redeemPlanStep(token, planId, 11, 'update_product_price', {
        price: 5000,
        id: 7,
      }),
    ).resolves.toBe('ok');
  });

  it('rejects a token redeemed by another user', async () => {
    const steps = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
    ];
    const planId = randomUUID();
    const token = await service.issuePlanToken(planId, 11, steps);

    await expect(
      service.redeemPlanStep(token, planId, 99, 'create_customer', {
        name: 'Acme',
      }),
    ).resolves.toBe('mismatch');
  });

  it('rejects an unknown token as missing', async () => {
    await expect(
      service.redeemPlanStep('never-issued', randomUUID(), 11, 'create_customer', {
        name: 'Acme',
      }),
    ).resolves.toBe('missing');
  });

  it('never covers an irreversible domain step, even inside an approved plan', async () => {
    const steps = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
      { order: 2, tool: 'send_invoice_dian', args: { order_id: 1046 } },
    ];
    const planId = randomUUID();

    expect(service.classifySteps(steps).reconfirm.map((s) => s.tool)).toEqual([
      'send_invoice_dian',
    ]);

    const token = await service.issuePlanToken(planId, 11, steps);
    await expect(
      service.redeemPlanStep(token, planId, 11, 'create_customer', {
        name: 'Acme',
      }),
    ).resolves.toBe('ok');
    await expect(
      service.redeemPlanStep(token, planId, 11, 'send_invoice_dian', {
        order_id: 1046,
      }),
    ).resolves.toBe('irreversible');
  });

  it('honors the explicit irreversible mark over a reversible domain', async () => {
    const steps = [
      { order: 1, tool: 'settle_payroll', args: { period: '2026-09' } },
    ];
    expect(service.classifySteps(steps).covered).toEqual([]);
    const token = await service.issuePlanToken('plan-settle', 11, steps);
    await expect(
      service.redeemPlanStep(token, 'plan-settle', 11, 'settle_payroll', {
        period: '2026-09',
      }),
    ).resolves.toBe('irreversible');
  });

  it('treats bridge writes to irreversible segments and DELETE as irreversible', async () => {
    const refund = {
      order: 1,
      tool: 'write_endpoint',
      args: { path: 'store/payments/apply', method: 'POST', body: {} },
    };
    const del = {
      order: 2,
      tool: 'write_endpoint',
      args: { path: 'store/products/7', method: 'DELETE' },
    };
    const plain = {
      order: 3,
      tool: 'write_endpoint',
      args: { path: 'store/products', method: 'POST', body: {} },
    };
    const { covered, reconfirm } = service.classifySteps([refund, del, plain]);
    expect(covered.map((s) => s.order)).toEqual([3]);
    expect(reconfirm.map((s) => s.order)).toEqual([1, 2]);
  });

  it('fails closed on unknown tools', async () => {
    const steps = [{ order: 1, tool: 'invented_tool', args: {} }];
    expect(service.classifySteps(steps).reconfirm).toHaveLength(1);
  });

  it('pins the shared irreversible segment membership (single source)', () => {
    // Si un segmento se retira de IRREVERSIBLE_DOMAINS, este pin obliga a
    // decidirlo aquí en vez de silenciar la red de seguridad por dominio.
    for (const segment of [
      'invoicing',
      'dian-config',
      'payroll',
      'pila',
      'cash-register',
      'cash-registers',
      'payments',
      'refunds',
      'subscriptions',
      'declarations',
      'fiscal',
      'returns',
      'accounting',
      'orders',
      'withholding',
      'receivables',
      'payables',
      'receivables-payables',
    ]) {
      expect(IRREVERSIBLE_DOMAIN_SEGMENTS.has(segment)).toBe(true);
    }
  });

  it('reconfirms the cash-register singular spelling via the shared net', async () => {
    // Regresión del espejo local: la lista vieja solo traía `cash-registers`
    // (rutas) y el dominio tipado `cash-register` colaba como reversible.
    // La entrada del registry no porta la marca: solo la red la atrapa.
    const steps = [
      { order: 1, tool: 'close_cash_session', args: { session_id: 5 } },
    ];
    expect(service.classifySteps(steps).covered).toEqual([]);
    const token = await service.issuePlanToken('plan-cash', 11, steps);
    await expect(
      service.redeemPlanStep(token, 'plan-cash', 11, 'close_cash_session', {
        session_id: 5,
      }),
    ).resolves.toBe('irreversible');
  });

  it('reconfirms receivables/payables typed tools and bridge paths', () => {
    const typed = {
      order: 1,
      tool: 'collect_receivable',
      args: { receivable_id: 9 },
    };
    const bridgeRecv = {
      order: 2,
      tool: 'write_endpoint',
      args: { path: 'store/receivables/9/collect', method: 'POST', body: {} },
    };
    const bridgePay = {
      order: 3,
      tool: 'write_endpoint',
      args: { path: 'store/payables/4/pay', method: 'POST', body: {} },
    };
    const { covered, reconfirm } = service.classifySteps([
      typed,
      bridgeRecv,
      bridgePay,
    ]);
    expect(covered).toEqual([]);
    expect(reconfirm.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it('honors the explicit mark on withholding declarations', async () => {
    const steps = [
      { order: 1, tool: 'submit_exogenous_report', args: { report_id: 3 } },
    ];
    expect(service.classifySteps(steps).covered).toEqual([]);
    const token = await service.issuePlanToken('plan-exog', 11, steps);
    await expect(
      service.redeemPlanStep(token, 'plan-exog', 11, 'submit_exogenous_report', {
        report_id: 3,
      }),
    ).resolves.toBe('irreversible');
  });

  it('marks unknown steps irreversible at redeem time, not only classify', async () => {
    const steps = [{ order: 1, tool: 'invented_tool', args: {} }];
    const token = await service.issuePlanToken('plan-unknown', 11, steps);
    await expect(
      service.redeemPlanStep(token, 'plan-unknown', 11, 'invented_tool', {}),
    ).resolves.toBe('irreversible');
  });

  it('binds the fingerprint to the approved step list, not the call sequence', async () => {
    const steps = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
      { order: 2, tool: 'adjust_stock', args: { id: 7, qty: 2 } },
    ];
    const planId = randomUUID();
    const token = await service.issuePlanToken(planId, 11, steps);

    // Steps may run in any order — each redeems independently…
    await expect(
      service.redeemPlanStep(token, planId, 11, 'adjust_stock', {
        id: 7,
        qty: 2,
      }),
    ).resolves.toBe('ok');

    // …but the token only ever authorizes the approved list: a step that was
    // never approved is unknown, even with a valid token in hand.
    await expect(
      service.redeemPlanStep(token, planId, 11, 'update_product_price', {
        id: 7,
        price: 1,
      }),
    ).resolves.toBe('unknown_step');
  });

  it('stores fields the Lua script expects', async () => {
    const steps = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
    ];
    await service.issuePlanToken('plan-1', 11, steps);
    const fields = redis.hset.mock.calls[0][1] as Record<string, string>;
    expect(fields.fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fields[`s:${stepHash('create_customer', { name: 'Acme' })}`]).toBe(
      '0',
    );
    expect(JSON.parse(fields.steps)).toEqual([
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
    ]);
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 900);
  });
});
