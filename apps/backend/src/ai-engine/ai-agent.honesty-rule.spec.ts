import {
  normalizeToolException,
  normalizeToolResult,
} from './tools/tool-result.normalizer';
import { AIAgentService, honestyRule } from './ai-agent.service';
import { RequestContextService } from '../common/context/request-context.service';
import { AIStreamChunk } from './interfaces/ai-provider.interface';
import { VendixHttpException } from '../common/errors';

/**
 * La regla de honestidad sobrevivió al retiro de los gates de texto: ya no
 * reemplaza respuestas, pero sigue siendo la única defensa frente a «te aviso
 * cuando termine» sin tarjeta. Esta prueba evita que la regla o su inyección
 * desaparezcan sin que nadie lo note.
 */
describe('Vex: regla de honestidad en el prompt (sin reemplazo de texto)', () => {
  const def = (name: string) => ({
    type: 'function' as const,
    function: { name, description: name, parameters: {} },
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

  const systemTexts = (messages: any[]) =>
    messages.filter((m) => m.role === 'system').map((m) => m.content as string);

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      permissions: ['p'],
      roles: [],
    } as any);
  });
  afterEach(() => jest.restoreAllMocks());

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
});
