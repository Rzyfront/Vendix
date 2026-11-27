import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import {
  AIAgentService,
  DISCOVERY_BUDGET_CLOSING,
  VEX_DISCOVERY_BUDGET_PER_TURN,
} from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { VendixHttpException } from '../common/errors';

/**
 * T8 — exploration budget of a Vex turn. Conversation 309: page after page of
 * list_products and no write. Past the budget the turn stops reading and
 * closes with what it knows and the fact it lacks; it never loops.
 */
describe('Vex T8: presupuesto de exploración por turno', () => {
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

  function build(extra: string[] = []) {
    const names = ['list_products', 'propose_write_batch', ...extra];
    const chat = jest.fn();
    const executeTool = jest.fn();
    const registry: any = {
      getAvailableDefinitions: jest.fn(() => names.map(def)),
      getDeniedPermissions: jest.fn(() => []),
      canonicalName: (n: string) => n,
      matchesScope: () => true,
      get: (n: string) =>
        names.includes(n) ? { name: n, domain: 'products' } : undefined,
      getDeprecation: () => undefined,
      isClientSide: () => false,
      isReadOnly: (n: string) =>
        n.startsWith('list_') || n === 'propose_write_batch',
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
        goal: 'aplícale la tarifa Manaure a todos mis productos',
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

  const finalText = (chunks: AIStreamChunk[]) =>
    chunks
      .filter((c) => c.type === 'text')
      .map((c) => c.content)
      .join('');

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const page = (n: number) =>
    ok({ tool_calls: [call(`c${n}`, 'list_products', { page: n })] });

  it('12 list_products simulados: corta en el tope y responde sin bucle', async () => {
    expect(VEX_DISCOVERY_BUDGET_PER_TURN).toBe(10);
    const f = build();
    f.executeTool.mockResolvedValue('{"data":[{"id":1,"name":"Producto 1"}]}');
    // The model would keep paging forever (12+ list_products); only the
    // tool-free closing gets a text answer.
    let n = 0;
    f.chat.mockImplementation(async (messages: any[]) =>
      messages[messages.length - 1]?.content === DISCOVERY_BUDGET_CLOSING
        ? ok({
            content:
              'Revisé 10 páginas de productos; me falta el id de la tarifa Manaure.',
          })
        : page(++n),
    );

    const { chunks, result } = await f.drain({ agent_key: 'vex', max_iterations: 40 });

    // Exactly the budget ran; the 11th page was never executed.
    expect(f.executeTool).toHaveBeenCalledTimes(VEX_DISCOVERY_BUDGET_PER_TURN);
    // 11 loop rounds + 1 tool-free closing; nothing after it.
    expect(f.chat).toHaveBeenCalledTimes(VEX_DISCOVERY_BUDGET_PER_TURN + 2);
    const closing = f.chat.mock.calls[VEX_DISCOVERY_BUDGET_PER_TURN + 1][0] as any[];
    expect(closing[closing.length - 1]).toEqual({
      role: 'user',
      content: DISCOVERY_BUDGET_CLOSING,
    });
    // The unrun call never reached the history.
    expect(
      closing.some((m) => m.tool_calls?.some((c: any) => c.id === 'c11')),
    ).toBe(false);
    expect(finalText(chunks)).toBe(
      'Revisé 10 páginas de productos; me falta el id de la tarifa Manaure.',
    );
    expect((result as any).success).toBe(true);
  });

  it('propose_write_batch no gasta el presupuesto', async () => {
    const f = build();
    f.executeTool.mockResolvedValue('{"ok":true}');
    for (let n = 1; n <= VEX_DISCOVERY_BUDGET_PER_TURN; n++)
      f.chat.mockResolvedValueOnce(page(n));
    f.chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('b1', 'propose_write_batch', { goal: 'g', steps: [] })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'Revisa la tarjeta.' }));
    const { chunks } = await f.drain({ agent_key: 'vex', max_iterations: 40 });
    expect(f.executeTool).toHaveBeenCalledTimes(VEX_DISCOVERY_BUDGET_PER_TURN + 1);
    expect(finalText(chunks)).toBe('Revisa la tarjeta.');
  });

  // Vexi público F1: Vexi ya no tiene tools internas (catálogo cerrado), así
  // que el alcance «solo Vex» se fija con un turno sin agente.
  it('un turno sin agente no tiene este presupuesto (alcance: Vex)', async () => {
    const f = build();
    f.executeTool.mockResolvedValue('{"data":[]}');
    for (let n = 1; n <= 12; n++) f.chat.mockResolvedValueOnce(page(n));
    f.chat.mockResolvedValueOnce(ok({ content: 'Listo.' }));
    await f.drain({ max_iterations: 40 });
    expect(f.executeTool).toHaveBeenCalledTimes(12);
  });
});
