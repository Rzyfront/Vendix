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

function makePlanState(
  hashes: Array<{ order: number; tool: string; args_hash: string }> = [],
) {
  const state = {
    record: {
      plan_id: null as string | null,
      created_at: null as string | null,
      steps: hashes,
    },
  };
  return {
    state,
    getStepHashRecord: jest.fn(async () => state.record),
    getStepHashes: jest.fn(async () => state.record.steps),
    setStepHashes: jest.fn(async () => state.record.steps),
    clearStepHashes: jest.fn(async () => {
      state.record = { plan_id: null, created_at: null, steps: [] };
    }),
  };
}

/** Sembrar los hashes vigentes de un plan (con su identidad y antigüedad). */
function seedHashes(
  planState: ReturnType<typeof makePlanState>,
  planId: string,
  steps: Array<{ order: number; tool: string; args: Record<string, any> }>,
  createdAt: Date = new Date(),
) {
  planState.state.record = {
    plan_id: planId,
    created_at: createdAt.toISOString(),
    steps: steps.map((s) => ({
      order: s.order,
      tool: s.tool,
      args_hash: stepHash(s.tool, s.args),
    })),
  };
}

function makePrisma(userId: number | null = 11) {
  // Mensajes del asistente en memoria: `loadPlan` los lee, `savePlan` los
  // reescribe con `updateMany` (mismo contrato que la fila real).
  const messages: Array<{ id: number; metadata: any }> = [];
  return {
    messages,
    ai_conversations: {
      findFirst: jest.fn(async () =>
        userId === null ? null : { user_id: userId },
      ),
    },
    ai_messages: {
      findMany: jest.fn(async () =>
        [...messages].sort((a, b) => b.id - a.id).map((m) => ({ ...m })),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = messages.find((m) => m.id === where.id);
        if (!row) return { count: 0 };
        row.metadata = data.metadata;
        return { count: 1 };
      }),
    },
  };
}

function persistPlan(
  prisma: ReturnType<typeof makePrisma>,
  planId: string,
  steps: Array<{
    step_id: string;
    order: number;
    tool: string;
    arguments: Record<string, any>;
    irreversible: boolean;
    status?: string;
  }>,
  status = 'proposed',
) {
  prisma.messages.push({
    id: prisma.messages.length + 1,
    metadata: {
      plan: {
        plan_id: planId,
        status,
        steps: steps.map((s) => ({ status: 'pending', ...s })),
      },
    },
  });
}

describe('PlanApprovalService', () => {
  let redis: ReturnType<typeof makeRedis>;
  let registry: ReturnType<typeof makeRegistry>;
  let planState: ReturnType<typeof makePlanState>;
  let prisma: ReturnType<typeof makePrisma>;
  let service: PlanApprovalService;

  beforeEach(() => {
    redis = makeRedis();
    registry = makeRegistry();
    planState = makePlanState();
    prisma = makePrisma();
    service = new PlanApprovalService(
      redis as any,
      registry as any,
      planState as any,
      prisma as any,
    );
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

  it('(rx3-f) approve de otro usuario → 403 y no acuña token', async () => {
    const input = {
      planId: 'plan-x',
      conversationId: 7,
      userId: 99,
      clientSteps: [{ order: 1, tool: 'create_customer', args: { name: 'Acme' } }],
    };
    await expect(service.approvePlan(input)).rejects.toMatchObject({
      errorCode: 'AUTH_PERM_001',
    });
    expect(redis.hset).not.toHaveBeenCalled();

    // Fila inexistente (p. ej. otra tienda): el mismo 403, sin revelar nada.
    prisma.ai_conversations.findFirst.mockResolvedValue(null);
    await expect(
      service.approvePlan({ ...input, userId: 11 }),
    ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('(rx3-g) approve clasifica: reversibles cubiertos, irreversibles a reconfirmar', async () => {
    const steps = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
      { order: 2, tool: 'send_invoice_dian', args: { order_id: 1046 } },
    ];
    seedHashes(planState, 'plan-mix', steps);

    const out = await service.approvePlan({
      planId: 'plan-mix',
      conversationId: 7,
      userId: 11,
      clientSteps: steps,
    });

    expect(out.covered_steps).toEqual([1]);
    expect(out.reconfirm_steps).toEqual([2]);
    expect(out.ignored_steps).toEqual([]);
    expect(out.plan_token).toBeTruthy();
    expect(redis.expire).toHaveBeenCalledWith(expect.any(String), 900);
    // Círculo completo: el reversible ejecuta sin reconfirmar, el irreversible
    // queda pendiente de su propia tarjeta.
    await expect(
      service.redeemPlanStep(out.plan_token, 'plan-mix', 11, 'create_customer', {
        name: 'Acme',
      }),
    ).resolves.toBe('ok');
    await expect(
      service.redeemPlanStep(
        out.plan_token,
        'plan-mix',
        11,
        'send_invoice_dian',
        { order_id: 1046 },
      ),
    ).resolves.toBe('irreversible');
  });

  it('(rx3-h) steps del cliente alterados se ignoran: el token solo cubre lo verificado', async () => {
    const server = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
      { order: 2, tool: 'adjust_stock', args: { id: 7, qty: 2 } },
    ];
    seedHashes(planState, 'plan-alt', server);

    const out = await service.approvePlan({
      planId: 'plan-alt',
      conversationId: 7,
      userId: 11,
      clientSteps: [
        { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
        { order: 2, tool: 'adjust_stock', args: { id: 7, qty: 999 } },
        { order: 3, tool: 'create_customer', args: { name: 'Inventado' } },
      ],
    });

    expect(out.covered_steps).toEqual([1]);
    expect(out.reconfirm_steps).toEqual([]);
    expect(out.ignored_steps).toEqual([2, 3]);
    await expect(
      service.redeemPlanStep(out.plan_token, 'plan-alt', 11, 'create_customer', {
        name: 'Acme',
      }),
    ).resolves.toBe('ok');
    await expect(
      service.redeemPlanStep(out.plan_token, 'plan-alt', 11, 'adjust_stock', {
        id: 7,
        qty: 999,
      }),
    ).resolves.toBe('unknown_step');
  });

  it('(rx3-i) sin hashes de servidor o nada verificable → 409 sin token', async () => {
    await expect(
      service.approvePlan({
        planId: 'plan-stale',
        conversationId: 7,
        userId: 11,
        clientSteps: [
          { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
        ],
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });

    seedHashes(planState, 'plan-tampered', [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
    ]);
    await expect(
      service.approvePlan({
        planId: 'plan-tampered',
        conversationId: 7,
        userId: 11,
        clientSteps: [
          { order: 1, tool: 'create_customer', args: { name: 'Otro' } },
        ],
      }),
    ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
    expect(redis.hset).not.toHaveBeenCalled();
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
  describe('ciclo de vida del plan (vexR3-B)', () => {
    const PLAN = '11111111-1111-4111-8111-111111111111';
    const steps = [
      { order: 1, tool: 'create_customer', args: { name: 'Acme' } },
      { order: 2, tool: 'send_invoice_dian', args: { order_id: 1046 } },
    ];
    const persisted = [
      {
        step_id: 's1',
        order: 1,
        tool: 'create_customer',
        arguments: { name: 'Acme' },
        irreversible: false,
      },
      {
        step_id: 's2',
        order: 2,
        tool: 'send_invoice_dian',
        arguments: { order_id: 1046 },
        irreversible: true,
      },
    ];

    beforeEach(() => {
      seedHashes(planState, PLAN, steps);
      persistPlan(prisma, PLAN, persisted);
    });

    it('approve mueve el plan a approved y rechaza una segunda aprobación', async () => {
      await service.approvePlan({
        planId: PLAN,
        conversationId: 7,
        userId: 11,
        clientSteps: steps,
      });
      expect(prisma.messages[0].metadata.plan.status).toBe('approved');
      await expect(
        service.approvePlan({
          planId: PLAN,
          conversationId: 7,
          userId: 11,
          clientSteps: steps,
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
    });

    it('reject → pasos cancelled, hashes borrados, y approve responde 409', async () => {
      const out = await service.rejectPlan({
        planId: PLAN,
        conversationId: 7,
        userId: 11,
      });
      expect(out).toEqual({ plan_id: PLAN, status: 'rejected' });
      const plan = prisma.messages[0].metadata.plan;
      expect(plan.status).toBe('rejected');
      expect(plan.steps.map((s: any) => s.status)).toEqual([
        'cancelled',
        'cancelled',
      ]);
      expect(planState.clearStepHashes).toHaveBeenCalledWith(7);

      await expect(
        service.approvePlan({
          planId: PLAN,
          conversationId: 7,
          userId: 11,
          clientSteps: steps,
        }),
      ).rejects.toMatchObject({
        errorCode: 'SYS_CONFLICT_001',
        details: expect.objectContaining({ reason: 'plan_not_proposed' }),
      });
      expect(redis.hset).not.toHaveBeenCalled();
      // Y no se rechaza dos veces.
      await expect(
        service.rejectPlan({ planId: PLAN, conversationId: 7, userId: 11 }),
      ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
    });

    it('reject de otro usuario → 403 sin tocar el plan ni los hashes', async () => {
      await expect(
        service.rejectPlan({ planId: PLAN, conversationId: 7, userId: 99 }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
      expect(prisma.messages[0].metadata.plan.status).toBe('proposed');
      expect(planState.clearStepHashes).not.toHaveBeenCalled();
    });

    it('approve de otro usuario no lee hashes (propiedad antes que hashes)', async () => {
      await expect(
        service.approvePlan({
          planId: PLAN,
          conversationId: 7,
          userId: 99,
          clientSteps: steps,
        }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
      expect(planState.getStepHashRecord).not.toHaveBeenCalled();
    });

    it('approve con plan_id distinto al de los hashes → 409 plan_mismatch', async () => {
      await expect(
        service.approvePlan({
          planId: '22222222-2222-4222-8222-222222222222',
          conversationId: 7,
          userId: 11,
          clientSteps: steps,
        }),
      ).rejects.toMatchObject({
        errorCode: 'SYS_CONFLICT_001',
        details: expect.objectContaining({ reason: 'plan_mismatch' }),
      });
      expect(redis.hset).not.toHaveBeenCalled();
    });

    it('approve con hashes de más de 24 h → 409 plan_expired', async () => {
      seedHashes(
        planState,
        PLAN,
        steps,
        new Date(Date.now() - 25 * 60 * 60 * 1000),
      );
      await expect(
        service.approvePlan({
          planId: PLAN,
          conversationId: 7,
          userId: 11,
          clientSteps: steps,
        }),
      ).rejects.toMatchObject({
        errorCode: 'SYS_CONFLICT_001',
        details: expect.objectContaining({ reason: 'plan_expired' }),
      });
    });

    it('hashes antiguos (sin plan_id) no se aprueban', async () => {
      planState.state.record = {
        ...planState.state.record,
        plan_id: null,
        created_at: null,
      };
      await expect(
        service.approvePlan({
          planId: PLAN,
          conversationId: 7,
          userId: 11,
          clientSteps: steps,
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
    });

    it('confirmación por paso: solo plan approved, paso irreversible y pending, dueño', async () => {
      const input = {
        planId: PLAN,
        stepId: 's2',
        conversationId: 7,
        userId: 11,
      };
      // Plan aún proposed → 409.
      await expect(
        service.resolveStepForConfirmation(input),
      ).rejects.toMatchObject({
        errorCode: 'SYS_CONFLICT_001',
        details: expect.objectContaining({ reason: 'plan_not_approved' }),
      });

      await service.approvePlan({
        planId: PLAN,
        conversationId: 7,
        userId: 11,
        clientSteps: steps,
      });
      // Reversible → no necesita confirmación aparte.
      await expect(
        service.resolveStepForConfirmation({ ...input, stepId: 's1' }),
      ).rejects.toMatchObject({
        details: expect.objectContaining({ reason: 'step_not_irreversible' }),
      });
      // Otro usuario → 403.
      await expect(
        service.resolveStepForConfirmation({ ...input, userId: 99 }),
      ).rejects.toMatchObject({ errorCode: 'AUTH_PERM_001' });
      // Irreversible y pending → devuelve tool + argumentos del servidor.
      await expect(service.resolveStepForConfirmation(input)).resolves.toMatchObject(
        { tool: 'send_invoice_dian', arguments: { order_id: 1046 } },
      );
      // Paso inexistente → 404.
      await expect(
        service.resolveStepForConfirmation({ ...input, stepId: 'zzz' }),
      ).rejects.toMatchObject({ errorCode: 'SYS_NOT_FOUND_001' });
    });

    it('estados persistidos tras aplicar: approved → applied', async () => {
      await service.approvePlan({
        planId: PLAN,
        conversationId: 7,
        userId: 11,
        clientSteps: steps,
      });
      const first = await service.recordStepResult({
        planId: PLAN,
        conversationId: 7,
        stepId: 's1',
        outcome: 'applied',
      });
      expect(first).toEqual({ step_status: 'applied', plan_status: 'approved' });
      const last = await service.recordStepResult({
        planId: PLAN,
        conversationId: 7,
        stepId: 's2',
        outcome: 'applied',
      });
      expect(last).toEqual({ step_status: 'applied', plan_status: 'applied' });
      expect(prisma.messages[0].metadata.plan.status).toBe('applied');
      // Un paso resuelto no vuelve a aplicarse.
      await expect(
        service.resolveStepForApply({
          planId: PLAN,
          stepId: 's1',
          conversationId: 7,
          userId: 11,
        }),
      ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
    });

    it('estados persistidos con un paso fallido: partially_applied + error', async () => {
      await service.approvePlan({
        planId: PLAN,
        conversationId: 7,
        userId: 11,
        clientSteps: steps,
      });
      await service.recordStepResult({
        planId: PLAN,
        conversationId: 7,
        stepId: 's1',
        outcome: 'applied',
      });
      const out = await service.recordStepResult({
        planId: PLAN,
        conversationId: 7,
        stepId: 's2',
        outcome: 'failed',
        error: 'DIAN no respondió',
      });
      expect(out).toEqual({
        step_status: 'failed',
        plan_status: 'partially_applied',
      });
      const stored = prisma.messages[0].metadata.plan.steps[1];
      expect(stored).toMatchObject({ status: 'failed', error: 'DIAN no respondió' });
      // Un plan ya resuelto no se puede cancelar.
      await expect(
        service.rejectPlan({ planId: PLAN, conversationId: 7, userId: 11 }),
      ).rejects.toMatchObject({ errorCode: 'SYS_CONFLICT_001' });
    });

    it('lee mensajes antiguos sin status por paso como pending', async () => {
      prisma.messages.length = 0;
      prisma.messages.push({
        id: 1,
        metadata: {
          plan: {
            plan_id: PLAN,
            status: 'proposed',
            steps: [
              {
                step_id: 's1',
                order: 1,
                tool: 'create_customer',
                arguments: { name: 'Acme' },
                irreversible: false,
              },
            ],
          },
        },
      });
      const plan = await service.getPlan(7, PLAN);
      expect(plan?.steps[0].status).toBe('pending');
    });
  });
});
