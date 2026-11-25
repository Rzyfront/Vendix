import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import {
  AIAgentService,
  HONESTY_NUDGE,
  HONEST_NO_WRITE_FALLBACK,
  honestyRule,
  promisesUnbackedWrite,
} from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { ErrorCodes, VendixHttpException } from '../common/errors';
import { buildToolSuccessEnvelope } from './tools/interfaces/tool.interface';

/**
 * T4 — Vex never promises a write it did not persist. Conversation 309: «voy
 * a aplicar la tarifa…» five times, zero writes. The turn rule says it; the
 * loop enforces it: a promise with no batch card, no confirmation and nothing
 * applied is resumed once, and a second promise is replaced by an honest line.
 */
describe('Vex T4: sin lote persistido no hay promesa', () => {
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

  const systemTexts = (messages: any[]) =>
    messages.filter((m) => m.role === 'system').map((m) => m.content as string);

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('detecta promesas de escritura y deja pasar preguntas y lecturas', () => {
    expect(
      promisesUnbackedWrite(
        'Perfecto, voy a aplicar la tarifa Manaure a todos tus productos.',
      ),
    ).toBe(true);
    expect(promisesUnbackedWrite('Ahora mismo actualizo los 56 productos.')).toBe(true);
    expect(promisesUnbackedWrite('Listo, te aviso cuando termine.')).toBe(true);
    expect(promisesUnbackedWrite('Estoy procesando tus productos.')).toBe(true);
    expect(
      promisesUnbackedWrite('¿Quieres que le asigne la tarifa a los 56 que faltan?'),
    ).toBe(false);
    expect(promisesUnbackedWrite('12 ya la tienen y 56 faltan.')).toBe(false);
    expect(
      promisesUnbackedWrite('No tengo una herramienta para cambiar el color del botón.'),
    ).toBe(false);
  });

  it('la regla del turno llega una vez a Vex y nombra el ticket solo si está ofrecido', async () => {
    expect(honestyRule(false)).toContain('sin tarjeta no hay promesa');
    expect(honestyRule(false)).not.toContain('request_capability');
    expect(honestyRule(true)).toContain('request_capability');
    expect(honestyRule(true)).toContain('dilo en UNA frase');

    const vex = build(['request_capability']);
    vex.chat.mockResolvedValueOnce(ok({ content: 'Hola.' }));
    await vex.drain({ agent_key: 'vex' });
    expect(
      systemTexts(vex.chat.mock.calls[0][0]).filter((t) => t === honestyRule(true)),
    ).toHaveLength(1);

    const vexi = build(['request_capability']);
    vexi.chat.mockResolvedValueOnce(ok({ content: 'Hola.' }));
    await vexi.drain({ agent_key: 'vexi' });
    expect(systemTexts(vexi.chat.mock.calls[0][0]).join('\n')).not.toContain(
      'Honestidad:',
    );
  });

  it('promesa sin propose_write_batch: se retoma UNA vez y queda la respuesta honesta', async () => {
    const f = build();
    f.chat
      .mockResolvedValueOnce(
        ok({ content: 'Perfecto, voy a aplicar la tarifa Manaure a todos tus productos.' }),
      )
      .mockResolvedValueOnce(
        ok({ content: 'No tengo cómo asignar esa tarifa desde aquí.' }),
      );
    const { chunks } = await f.drain({ agent_key: 'vex' });
    expect(f.chat).toHaveBeenCalledTimes(2);
    const second = f.chat.mock.calls[1][0] as any[];
    expect(second[second.length - 1]).toEqual({
      role: 'system',
      content: HONESTY_NUDGE,
    });
    expect(finalText(chunks)).toBe('No tengo cómo asignar esa tarifa desde aquí.');
  });

  it('si vuelve a prometer sin lote, la promesa nunca llega a la persona', async () => {
    const f = build();
    f.chat
      .mockResolvedValueOnce(ok({ content: 'Voy a aplicar la tarifa ya mismo.' }))
      .mockResolvedValueOnce(ok({ content: 'En un momento asigno la tarifa a todos.' }));
    const { chunks } = await f.drain({ agent_key: 'vex' });
    expect(f.chat).toHaveBeenCalledTimes(2);
    const text = finalText(chunks);
    expect(text).toBe(HONEST_NO_WRITE_FALLBACK);
    expect(promisesUnbackedWrite(text)).toBe(false);
  });

  it('con el lote persistido por propose_write_batch no hay gate', async () => {
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
        ok({
          tool_calls: [
            call('c1', 'propose_write_batch', { goal: 'g', steps: [] }),
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({ content: 'Revisa la tarjeta: al aprobarla voy a aplicar la tarifa a 56 productos.' }),
      );
    const { chunks } = await f.drain({ agent_key: 'vex' });
    expect(f.chat).toHaveBeenCalledTimes(2);
    expect(finalText(chunks)).toBe(
      'Revisa la tarjeta: al aprobarla voy a aplicar la tarifa a 56 productos.',
    );
  });

  it('Vexi no pasa por el gate (alcance: Vex)', async () => {
    const f = build();
    f.chat.mockResolvedValueOnce(ok({ content: 'Voy a aplicar la tarifa.' }));
    const { chunks } = await f.drain({ agent_key: 'vexi' });
    expect(f.chat).toHaveBeenCalledTimes(1);
    expect(finalText(chunks)).toBe('Voy a aplicar la tarifa.');
  });

  it('un error de propose_write_batch no cuenta como lote persistido', async () => {
    const f = build();
    f.executeTool.mockRejectedValueOnce(
      new VendixHttpException(ErrorCodes.AI_AGENT_004, 'rol sin permiso'),
    );
    f.chat
      .mockResolvedValueOnce(
        ok({ tool_calls: [call('c1', 'propose_write_batch', { goal: 'g', steps: [] })] }),
      )
      .mockResolvedValueOnce(ok({ content: 'Voy a aplicar la tarifa en un rato.' }));
    const { chunks } = await f.drain({ agent_key: 'vex' });
    // A blocked receipt halts the loop into the tool-free closing; a promise
    // there is replaced, never shown.
    expect(finalText(chunks)).toBe(HONEST_NO_WRITE_FALLBACK);
  });
});
