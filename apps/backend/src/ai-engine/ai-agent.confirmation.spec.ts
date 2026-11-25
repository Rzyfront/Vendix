import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import {
  AIAgentService,
  CONFIRMATION_NUDGE,
  CONFIRMED_BUT_NOT_DONE,
  asksConfirmationAgain,
  confirmedQuestionRule,
  isAffirmativeReply,
} from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { VendixHttpException } from '../common/errors';
import { buildToolSuccessEnvelope } from './tools/interfaces/tool.interface';

/**
 * T9 — conversation 309 again: Vex asked «¿quieres que aplique la tarifa a
 * los 56?», the person said «sí, hazlo», and the next turn asked the same.
 * A yes closes the question: the turn acts or says why it cannot; it never
 * asks for the same go-ahead again.
 */
describe('Vex T9: un «hazlo» cierra la pregunta', () => {
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
        goal: 'sí, hazlo',
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

  const systemTexts = (messages: any[]) =>
    messages.filter((m) => m.role === 'system').map((m) => m.content as string);

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  const QUESTION =
    'Revisé: 12 ya la tienen y 56 faltan. ¿Quieres que le aplique la tarifa Manaure a los 56?';
  const HISTORY_309 = [
    { role: 'user', content: 'aplícale la tarifa Manaure a todos mis productos' },
    { role: 'assistant', content: QUESTION },
  ];
  const questions = (text: string) => (text.match(/¿/g) ?? []).length;

  it('reconoce el sí y la pregunta repetida', () => {
    for (const yes of ['sí, hazlo', 'Si', 'dale', 'hazlo', 'Hágale pues', 'ok', 'de una', 'aplícalo'])
      expect(isAffirmativeReply(yes)).toBe(true);
    for (const other of ['¿y cuánto vale?', 'no, espera', 'mejor solo a las bebidas', ''])
      expect(isAffirmativeReply(other)).toBe(false);
    expect(asksConfirmationAgain('¿Confirmas que la aplico a los 56?')).toBe(true);
    expect(asksConfirmationAgain('¿Quieres que la aplique?')).toBe(true);
    expect(asksConfirmationAgain('Listo, revisa la tarjeta.')).toBe(false);
  });

  it('309: tras el «sí, hazlo» hay UNA sola pregunta en toda la conversación', async () => {
    const f = build();
    f.executeTool.mockResolvedValueOnce(
      JSON.stringify(
        buildToolSuccessEnvelope('propose_write_batch', {
          block_id: 'blk1',
          proposed_steps: 1,
          summary: 'Propuse 1 cambio en una tarjeta.',
        }),
      ),
    );
    f.chat
      .mockResolvedValueOnce(
        ok({ content: '¿Confirmas que quieres aplicar la tarifa Manaure a los 56 productos?' }),
      )
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('b1', 'propose_write_batch', { goal: 'g', steps: [] })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'Te dejé la tarjeta con los 56 productos para aprobar.' }));

    const { chunks } = await f.drain({ agent_key: 'vex', messages: HISTORY_309 });

    const first = f.chat.mock.calls[0][0] as any[];
    expect(
      first.filter((m) => m.role === 'system' && m.content === confirmedQuestionRule(QUESTION)),
    ).toHaveLength(1);
    // The history array is shared across calls: find the nudge right after
    // the repeated question.
    const history = f.chat.mock.calls[2][0] as any[];
    const nudgeAt = history.findIndex(
      (m) => m.role === 'system' && m.content === CONFIRMATION_NUDGE,
    );
    expect(nudgeAt).toBeGreaterThan(0);
    expect(history[nudgeAt - 1]).toEqual({
      role: 'assistant',
      content: '¿Confirmas que quieres aplicar la tarifa Manaure a los 56 productos?',
    });
    const text = finalText(chunks);
    expect(text).toBe('Te dejé la tarjeta con los 56 productos para aprobar.');
    // The only question of the whole exchange is the one already answered.
    expect(questions(QUESTION) + questions(text)).toBe(1);
  });

  it('si vuelve a preguntar, la segunda pregunta nunca llega a la persona', async () => {
    const f = build();
    f.chat
      .mockResolvedValueOnce(ok({ content: '¿Quieres que la aplique a los 56?' }))
      .mockResolvedValueOnce(ok({ content: '¿Seguro que la aplico a todos?' }));
    const { chunks } = await f.drain({ agent_key: 'vex', messages: HISTORY_309 });
    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(finalText(chunks)).toBe(CONFIRMED_BUT_NOT_DONE);
    expect(questions(finalText(chunks))).toBe(0);
  });

  it('sin pregunta previa, un «sí» suelto no activa la regla', async () => {
    const f = build();
    f.chat.mockResolvedValueOnce(ok({ content: '¿Quieres que la aplique?' }));
    const { chunks } = await f.drain({
      agent_key: 'vex',
      messages: [{ role: 'assistant', content: 'Listo, ya revisé.' }],
    });
    const first = f.chat.mock.calls[0][0] as any[];
    expect(first.some((m) => String(m.content).startsWith('La persona ya respondió'))).toBe(false);
    expect(finalText(chunks)).toBe('¿Quieres que la aplique?');
  });

  it('una pregunta de dato nuevo tras el sí no se bloquea', async () => {
    const f = build();
    f.chat.mockResolvedValueOnce(
      ok({ content: 'Hay dos tarifas llamadas Manaure. ¿Cuál uso, la de mayoristas o la de bulto?' }),
    );
    const { chunks } = await f.drain({ agent_key: 'vex', messages: HISTORY_309 });
    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(finalText(chunks)).toContain('¿Cuál uso');
  });
});
