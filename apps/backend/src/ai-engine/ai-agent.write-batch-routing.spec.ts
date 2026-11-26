import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import {
  AIAgentService,
  WRITE_BATCH_ROUTING_RULE,
  deferredWriteMessage,
} from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AgentPlanHook } from './interfaces/agent-plan.interface';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { ErrorCodes, VendixHttpException } from '../common/errors';
import {
  PROPOSE_WRITE_BATCH,
  WRITE_BATCH_MAX_STEPS_PER_CALL,
  createWriteBatchTools,
} from './tools/domains/write-batch.tools';
import { createPricingTools } from './tools/domains/pricing.tools';
import { WriteBatchService } from '../domains/store/vex/services/write-batch.service';

/**
 * Vex: a goal that needs 2+ writes is proposed as ONE batch with ONE approval.
 * The rule reaches the model as a system message only when
 * `propose_write_batch` is in the turn's authority; the loop also redirects a
 * second loose write of a turn to the batch instead of another card.
 */
describe('Vex: 2+ escrituras → una propuesta en lote', () => {
  const def = (name: string) => ({
    type: 'function' as const,
    function: { name, description: name, parameters: {} },
  });
  const call = (id: string, name: string, args: any = {}) => ({
    id,
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  });
  const ok = (over: any) => ({
    success: true,
    content: '',
    usage: { totalTokens: 10 },
    ...over,
  });

  function build(withBatchTool: boolean) {
    const names = [
      'list_products',
      'update_product',
      ...(withBatchTool ? [PROPOSE_WRITE_BATCH] : []),
    ];
    const chat = jest.fn();
    const executeTool = jest.fn().mockResolvedValue('{"ok":true}');
    const registry: any = {
      getAvailableDefinitions: jest.fn(() => names.map(def)),
      getDeniedPermissions: jest.fn(() => []),
      canonicalName: (n: string) => n,
      matchesScope: () => true,
      get: (n: string) =>
        names.includes(n) ? { name: n, domain: 'products' } : undefined,
      getDeprecation: () => undefined,
      isClientSide: () => false,
      isReadOnly: (n: string) => n.startsWith('list_'),
      executeTool,
      executeToolResult: async (name: string, args: any) => {
        try {
          return normalizeToolResult(await executeTool(name, args));
        } catch (error) {
          if (
            error instanceof VendixHttpException &&
            (error.getResponse() as any).error_code === 'AI_AGENT_005'
          )
            throw error;
          return normalizeToolException(error);
        }
      },
    };
    const service = new AIAgentService(
      { chat, run: jest.fn(), chatWith: jest.fn() } as any,
      {} as any,
      registry,
      { emit: jest.fn() } as any,
      { awaitResult: jest.fn() } as any,
      {
        canUseAIFeature: jest.fn(),
        getAIFeatureConfig: jest.fn(),
        consumeAIQuota: jest.fn().mockResolvedValue(undefined),
        checkExtraQuota: jest.fn().mockResolvedValue({
          exceeded: false,
          cap: null,
          used: 0,
          degradation: 'block',
        }),
        consumeExtraQuota: jest.fn().mockResolvedValue(undefined),
      } as any,
    );
    const drain = async (params: any) => {
      const chunks: AIStreamChunk[] = [];
      const gen = service.runAgentStream({
        goal: 'sube 10 % el precio de estos 8 productos',
        ...params,
      });
      let next = await gen.next();
      while (!next.done) {
        chunks.push(next.value);
        next = await gen.next();
      }
      return { chunks, result: next.value };
    };
    return { chat, executeTool, drain };
  }

  const systemTexts = (chat: jest.Mock) =>
    (chat.mock.calls[0][0] as any[])
      .filter((m) => m.role === 'system')
      .map((m) => m.content as string);

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('la regla exige un solo lote, lecturas sin permiso, una pregunta agrupada y lotes del máximo tamaño', () => {
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(/2 o más escrituras/);
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(/NO las propongas una por una/);
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(
      /desde tu primera respuesta arma UN solo lote con propose_write_batch/,
    );
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(/apruebe una sola vez/);
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(/prevalece .*«de a una»/);
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(
      /sin pedir permiso por cada lectura/,
    );
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(/UNA sola pregunta que agrupe/);
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(
      /\{goal, steps:\[\{tool, arguments, label\}\]\}/,
    );
    // The size named in the rule is the tool's real per-call ceiling.
    expect(WRITE_BATCH_ROUTING_RULE).toContain(
      `máximo ${WRITE_BATCH_MAX_STEPS_PER_CALL} pasos`,
    );
    expect(WRITE_BATCH_ROUTING_RULE).toContain(
      `lotes de ${WRITE_BATCH_MAX_STEPS_PER_CALL}, nunca cambios sueltos`,
    );
  });

  it('la regla conserva las garantías: irreversibles fuera del lote y aprobación solo con la tarjeta', () => {
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(
      /Lo irreversible .* no entra al lote/,
    );
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(
      /Nada se aplica hasta que la persona aprueba la tarjeta/,
    );
    expect(WRITE_BATCH_ROUTING_RULE).toMatch(
      /un mensaje dictado o escrito no aprueba cambios/,
    );
  });

  it('Vex con propose_write_batch en su autoridad recibe la regla UNA vez como mensaje de sistema', async () => {
    const f = build(true);
    f.chat.mockResolvedValueOnce(ok({ content: 'Listo.' }));
    await f.drain({ agent_key: 'vex' });
    expect(
      systemTexts(f.chat).filter((t) => t === WRITE_BATCH_ROUTING_RULE),
    ).toHaveLength(1);
  });

  it('sin la herramienta de lote, o en Vexi, el turno no recibe la regla', async () => {
    const withoutTool = build(false);
    withoutTool.chat.mockResolvedValueOnce(ok({ content: 'Listo.' }));
    await withoutTool.drain({ agent_key: 'vex' });
    expect(systemTexts(withoutTool.chat).join('\n')).not.toContain(
      'Cambios múltiples',
    );

    const vexi = build(true);
    vexi.chat.mockResolvedValueOnce(ok({ content: 'Listo.' }));
    await vexi.drain({ agent_key: 'vexi' });
    expect(systemTexts(vexi.chat).join('\n')).not.toContain(
      'Cambios múltiples',
    );
  });

  it('dos escrituras sueltas en un turno: la primera pide aprobación y la segunda se redirige al lote', async () => {
    const f = build(true);
    const proposal = (args: any, token: string) =>
      new VendixHttpException(ErrorCodes.AI_AGENT_005, 'requiere confirmación', {
        tool: 'update_product',
        arguments: args,
        preview: { target: `producto ${args.id}` },
        confirmation_token: token,
      } as any);
    f.executeTool
      .mockRejectedValueOnce(proposal({ id: 1, price: 110 }, 'tok-1'))
      .mockRejectedValueOnce(proposal({ id: 2, price: 220 }, 'tok-2'));
    f.chat.mockResolvedValueOnce(
      ok({
        tool_calls: [
          call('c1', 'update_product', { id: 1, price: 110 }),
          call('c2', 'update_product', { id: 2, price: 220 }),
        ],
      }),
    );
    const plan: AgentPlanHook = {
      execute: jest.fn(),
      snapshot: jest.fn().mockResolvedValue({
        id: 'plan-1',
        status: 'active',
        goal: 'g',
        deliverables: [],
        steps: [],
        created_at: '',
        updated_at: '',
      }),
    };
    const { chunks } = await f.drain({
      agent_key: 'vex',
      plan,
      plan_approval: {
        redeem: jest.fn(),
        issueSingleUse: jest.fn(),
        classifyProposedSteps: jest.fn((steps: any[]) => ({
          covered: steps,
          reconfirm: [],
        })),
        saveProposedSteps: jest.fn().mockResolvedValue(undefined),
      },
    });

    // Safety unchanged: one explicit approval frame, one step, nothing applied.
    const approvals = chunks.filter((c) => c.type === 'plan_approval');
    expect(approvals).toHaveLength(1);
    expect(approvals[0].plan_approval!.steps).toHaveLength(1);
    // Both calls only reached the preview (AI_AGENT_005): none ran with a token.
    for (const [, , options] of f.executeTool.mock.calls)
      expect(options?.confirmationToken).toBeUndefined();
    // What the model reads for the second write sends the rest to ONE batch.
    const toolMessages = (f.chat.mock.calls[0][0] as any[]).filter(
      (m) => m.role === 'tool' && m.tool_call_id === 'c2',
    );
    expect(toolMessages).toHaveLength(1);
    const deferred = JSON.parse(toolMessages[0].content);
    expect(deferred.deferred).toBe(true);
    expect(deferred.message).toBe(deferredWriteMessage(true));
    expect(deferred.message).toMatch(
      /TODAS las escrituras que falten en UNA sola llamada a propose_write_batch/,
    );
    expect(deferred.message).toMatch(/no las propongas una por una/);
  });

  it('sin lote disponible el mensaje diferido conserva el texto anterior', () => {
    expect(deferredWriteMessage(false)).toBe(
      'Pendiente: esta escritura se propondrá tras la aprobación de la anterior. No se ejecutó; vuelve a proponerla en el siguiente turno.',
    );
  });

  it('propose_write_batch: pasarse del máximo pide lotes del máximo tamaño, no unitarios', async () => {
    const propose = jest.fn();
    const [tool] = createWriteBatchTools({ batches: { propose } as any });
    const steps = Array.from(
      { length: WRITE_BATCH_MAX_STEPS_PER_CALL + 1 },
      (_, i) => ({ tool: 'update_product', arguments: { id: i }, label: 'x' }),
    );
    const raw = await tool.handler!({ goal: 'g', steps }, {} as any);
    expect(propose).not.toHaveBeenCalled();
    expect(raw).toContain(
      `Propón lotes de ${WRITE_BATCH_MAX_STEPS_PER_CALL} cambios (el máximo por llamada), nunca cambios sueltos.`,
    );
    expect(raw).not.toContain('uno por uno');
  });

  // T3 — la asignación masiva de tarifas es un paso válido del lote.
  describe('T3: manage_product_price_tiers como paso de propose_write_batch', () => {
    const ALL = Array.from({ length: 68 }, (_, i) => i + 1);
    const HAVE = new Set(ALL.slice(0, 12));

    function harness(granted: string[]) {
      const bulk = {
        listActiveProductIds: jest.fn().mockResolvedValue(ALL),
        apply: jest.fn(),
        preview: jest.fn(async (dto: any) => ({
          items: dto.ids.map((id: number) => ({
            id,
            name: `Producto ${id}`,
            sku: null,
            status: 'ok',
            changes: HAVE.has(id) ? [] : [{ field: 'price_tiers', current: [], next: [] }],
          })),
        })),
      };
      const tools = createPricingTools({
        priceTiersService: {
          findOne: jest.fn().mockResolvedValue({ id: 21, name: 'Manaure', is_active: true }),
        } as any,
        productsService: {} as any,
        productsBulkEditService: bulk as any,
      });
      const byName = new Map(tools.map((t) => [t.name, t]));
      const createMany = jest.fn().mockResolvedValue({ count: 1 });
      const registry = {
        canonicalName: (n: string) => n,
        get: (n: string) => byName.get(n),
        isIrreversible: (n: string) => byName.get(n)?.irreversible === true,
        getToolVersion: () => '1',
        // Same gate as the real registry: an error preview mints nothing.
        previewForConsent: async (n: string, args: any) => {
          const preview = await byName.get(n)!.preview!(args, { store_id: 7 } as any);
          if (preview.status === 'error') {
            throw new VendixHttpException(ErrorCodes.AI_AGENT_005, preview.message);
          }
          return { preview };
        },
      };
      const service = new WriteBatchService(
        {
          ai_agent_write_batches: { createMany },
          ai_conversations: { findFirst: async (a: any) => ({ id: a.where.id }) },
        } as any,
        registry as any,
        { classifySteps: () => ({ covered: [], reconfirm: [] }) } as any,
        {
          create: jest.fn(async () => ({ id: 'blk1' })),
          toUiBlock: jest.fn(async (b: any) => ({ id: b.id, kind: 'write_batch' })),
        } as any,
      );
      const propose = (steps: any[]) =>
        RequestContextService.run(
          {
            organization_id: 3,
            store_id: 7,
            user_id: 11,
            roles: ['owner'],
            permissions: granted,
          } as any,
          () => service.propose({ conversationId: 9, goal: 'Tarifa Manaure a todos', steps }),
        ) as Promise<any>;
      return { tools: byName, propose, createMany, bulk };
    }

    const OWNER = [
      'store:products:read',
      'store:price-tiers:read',
      'store:products:bulk_update',
      'store:price-tiers:update',
    ];

    it('los batch_steps del preview entran tal cual: una tarjeta, un paso, 56 registros', async () => {
      jest.restoreAllMocks();
      const h = harness(OWNER);
      const read = JSON.parse(
        await h.tools.get('preview_product_price_tiers')!.handler!(
          { price_tier_id: 21, all_active_products: true },
          { store_id: 7 } as any,
        ),
      );
      const res = await h.propose(read.data.batch_steps);
      expect(res.refused).toBeUndefined();
      expect(res.batches).toHaveLength(1);
      const row = h.createMany.mock.calls[0][0].data[0];
      expect(row.step_count).toBe(1);
      expect(row.affected_records).toBe(56);
      expect(row.steps[0]).toMatchObject({
        tool: 'manage_product_price_tiers',
        arguments: { action: 'assign', price_tier_id: 21, product_ids: ALL.slice(12) },
        preview: { status: 'ok', target: 'Tarifa "Manaure" en 56 producto(s)' },
      });
      // Proposing never writes.
      expect(h.bulk.apply).not.toHaveBeenCalled();
    });

    it('sin store:products:bulk_update el rol no obtiene lote', async () => {
      jest.restoreAllMocks();
      const h = harness(OWNER.filter((p) => p !== 'store:products:bulk_update'));
      const res = await h.propose([
        {
          tool: 'manage_product_price_tiers',
          arguments: { price_tier_id: 21, product_ids: ALL },
          label: 'Asignar Manaure',
        },
      ]);
      expect(res.refused).toBe(true);
      expect(res.reason).toBe('permission_denied');
      expect(h.createMany).not.toHaveBeenCalled();
    });

    it('si ya la tienen todos, el lote se rechaza (nunca un lote vacío)', async () => {
      jest.restoreAllMocks();
      const h = harness(OWNER);
      const res = await h.propose([
        {
          tool: 'manage_product_price_tiers',
          arguments: { price_tier_id: 21, product_ids: ALL.slice(0, 12) },
          label: 'Asignar Manaure',
        },
      ]);
      expect(res.refused).toBe(true);
      expect(res.reason).toBe('preview_error');
      expect(res.explanation).toContain('Ya la tienen todos');
      expect(h.createMany).not.toHaveBeenCalled();
    });

    it('la regla del turno manda la tarifa masiva por preview + un solo lote', () => {
      expect(WRITE_BATCH_ROUTING_RULE).toContain(
        'llama UNA vez a preview_product_price_tiers',
      );
      expect(WRITE_BATCH_ROUTING_RULE).toContain(
        'propón sus batch_steps tal cual en UNA llamada a propose_write_batch',
      );
      expect(WRITE_BATCH_ROUTING_RULE).toContain('Si no falta ninguno, dilo y no propongas lote.');
    });
  });
});
