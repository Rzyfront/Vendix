import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import {
  AIAgentService,
  TURN_CLOSE_NUDGE,
  TURN_CLOSE_RULE,
} from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { FINISH_TURN_TOOL } from './tools/domains/turn.tools';

/**
 * Turn-close contract: a chat turn of Vex/Vexi ends legitimately only when it
 * ran at least one tool or called `finish_turn`. Otherwise it is resumed once;
 * a second failure closes it flagged `pending_continuation`.
 */
describe('Contrato de cierre de turno (finish_turn)', () => {
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

  function build(names = ['list_products', FINISH_TURN_TOOL]) {
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
      isReadOnly: () => true,
      executeTool,
      executeToolResult: async (name: string, args: any) => {
        try {
          return normalizeToolResult(await executeTool(name, args));
        } catch (error) {
          return normalizeToolException(error);
        }
      },
    };
    const emit = jest.fn();
    const service = new AIAgentService(
      { chat, run: jest.fn(), chatWith: jest.fn() } as any,
      {} as any,
      registry,
      { emit } as any,
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
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    const drain = async (params: any = {}) => {
      const chunks: AIStreamChunk[] = [];
      const gen = service.runAgentStream({
        goal: '¿cuánto vendí hoy?',
        agent_key: 'vex',
        stream_id: 'stream-1',
        ...params,
      });
      let next = await gen.next();
      while (!next.done) {
        chunks.push(next.value);
        next = await gen.next();
      }
      return { chunks, result: next.value };
    };
    const gateLogs = () =>
      warn.mock.calls
        .map((c) => String(c[0]))
        .filter((line) => line.includes('agent_turn_close_gate'));
    return { chat, executeTool, drain, gateLogs };
  }

  const systemTexts = (messages: any[]) =>
    messages.filter((m) => m.role === 'system').map((m) => m.content);
  const doneOf = (chunks: AIStreamChunk[]) =>
    chunks.find((c) => c.type === 'done');
  const textOf = (chunks: AIStreamChunk[]) =>
    chunks
      .filter((c) => c.type === 'text')
      .map((c) => c.content)
      .join('');

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
      store_id: 7,
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('la regla del prompt prohíbe anunciar acciones futuras y nombra finish_turn', () => {
    expect(TURN_CLOSE_RULE).toBe(
      'No anuncies una acción futura: o la ejecutas en este mismo turno o la planteas como pregunta. Para cerrar, llama a `finish_turn`.',
    );
  });

  it('un turno de chat con finish_turn en su autoridad recibe la regla una vez', async () => {
    const f = build();
    f.chat.mockResolvedValueOnce(
      ok({ content: 'Hola.', tool_calls: [call('c1', FINISH_TURN_TOOL)] }),
    );
    await f.drain();
    expect(
      systemTexts(f.chat.mock.calls[0][0]).filter((t) => t === TURN_CLOSE_RULE),
    ).toHaveLength(1);
  });

  it('0 herramientas y sin finish_turn: reanuda UNA vez con el mensaje de sistema', async () => {
    const f = build();
    f.chat
      .mockResolvedValueOnce(ok({ content: 'Listo, ya voy a buscar tus ventas…' }))
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'list_products', {})] }),
      )
      .mockResolvedValueOnce(ok({ content: 'Hoy vendiste $120.000.' }));

    const { chunks, result } = await f.drain();

    expect(f.chat).toHaveBeenCalledTimes(3);
    // The provider receives the same (growing) array: locate the resume pair.
    const history = f.chat.mock.calls[1][0] as any[];
    const at = history.findIndex(
      (m) =>
        m.role === 'assistant' &&
        m.content === 'Listo, ya voy a buscar tus ventas…',
    );
    expect(at).toBeGreaterThan(-1);
    expect(history[at + 1]).toEqual({
      role: 'system',
      content:
        'No cerraste el turno y no ejecutaste nada. Si tenías algo que hacer, hazlo ahora con la herramienta que corresponda; si ya terminaste, llama a finish_turn.',
    });
    expect(TURN_CLOSE_NUDGE).toBe(history[at + 1].content);
    expect(
      history.filter((m) => m.content === TURN_CLOSE_NUDGE),
    ).toHaveLength(1);
    expect(f.executeTool).toHaveBeenCalledTimes(1);
    expect(f.executeTool.mock.calls[0][0]).toBe('list_products');
    expect(textOf(chunks)).toBe('Hoy vendiste $120.000.');
    expect(doneOf(chunks)?.pending_continuation).toBeUndefined();
    expect(result.pending_continuation).toBeUndefined();
    expect(f.gateLogs()).toHaveLength(1);
    expect(JSON.parse(f.gateLogs()[0])).toEqual(
      expect.objectContaining({
        outcome: 'resumed',
        store_id: 7,
        stream_id: 'stream-1',
      }),
    );
  });

  it('con herramientas ejecutadas cierra directo con su texto: cero pasadas extra', async () => {
    const f = build();
    f.chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'list_products', {})] }),
      )
      .mockResolvedValueOnce(ok({ content: 'Tienes 12 productos.' }));

    const { chunks, result } = await f.drain();

    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(textOf(chunks)).toBe('Tienes 12 productos.');
    expect(result.pending_continuation).toBeUndefined();
    expect(f.gateLogs()).toHaveLength(0);
  });

  it('finish_turn solo cierra el turno con el texto, sin ejecutarlo ni otra pasada', async () => {
    const f = build();
    f.chat.mockResolvedValueOnce(
      ok({
        content: 'Hola, ¿en qué te ayudo?',
        tool_calls: [call('c1', FINISH_TURN_TOOL, { summary: 'saludo' })],
      }),
    );

    const { chunks, result } = await f.drain();

    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(f.executeTool).not.toHaveBeenCalled();
    expect(textOf(chunks)).toBe('Hola, ¿en qué te ayudo?');
    expect(result.success).toBe(true);
    expect(result.pending_continuation).toBeUndefined();
    expect(f.gateLogs()).toHaveLength(0);
  });

  it('segundo fallo: cierra con el texto del modelo y pending_continuation en el frame final', async () => {
    const f = build();
    f.chat
      .mockResolvedValueOnce(ok({ content: 'Ya voy a revisar el inventario.' }))
      .mockResolvedValueOnce(ok({ content: 'Dame un momento, ya lo reviso.' }));

    const { chunks, result } = await f.drain();

    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(textOf(chunks)).toBe('Dame un momento, ya lo reviso.');
    expect(doneOf(chunks)?.pending_continuation).toBe(true);
    expect(result.pending_continuation).toBe(true);
    expect(result.content).toBe('Dame un momento, ya lo reviso.');
    expect(f.gateLogs().map((l) => JSON.parse(l).outcome)).toEqual([
      'resumed',
      'pending_continuation',
    ]);
  });

  it('fuera del chat (sin stream_id) no hay gate, ni regla, ni finish_turn ofrecido', async () => {
    const f = build();
    f.chat.mockResolvedValueOnce(ok({ content: 'Ya voy a buscar.' }));

    const { result } = await f.drain({ stream_id: undefined });

    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(result.pending_continuation).toBeUndefined();
    const [messages, options] = f.chat.mock.calls[0];
    expect(systemTexts(messages)).not.toContain(TURN_CLOSE_RULE);
    expect(
      (options.tools ?? []).map((t: any) => t.function.name),
    ).not.toContain(FINISH_TURN_TOOL);
  });

  it('sin finish_turn en la autoridad del turno el cierre no se exige', async () => {
    const f = build(['list_products']);
    f.chat.mockResolvedValueOnce(ok({ content: 'Ya voy a buscar.' }));

    const { result } = await f.drain();

    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(result.pending_continuation).toBeUndefined();
    expect(systemTexts(f.chat.mock.calls[0][0])).not.toContain(TURN_CLOSE_RULE);
  });
});
