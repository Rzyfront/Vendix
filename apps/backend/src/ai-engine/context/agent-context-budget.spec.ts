import {
  applyAgentContextBudget,
  estimateAgentInputTokens,
  historicalAssistantProse,
} from './agent-context-budget';
import type {
  AIMessage,
  AIToolDefinition,
} from '../interfaces/ai-provider.interface';

describe('H conservative agent context budget', () => {
  const apply = (
    messages: AIMessage[],
    contextWindowTokens = 6000,
    tools: AIToolDefinition[] = [],
  ) =>
    applyAgentContextBudget(messages, tools, {
      contextWindowTokens,
      maxOutputTokens: 512,
      safetyTokens: 512,
    });
  const prose = (text: string): AIMessage => ({
    role: 'assistant',
    content: text,
    context_retention: 'history',
  });
  it('keeps short inputs and does not mutate messages or tool schemas', () => {
    const messages: AIMessage[] = [
      { role: 'system', content: 'reglas' },
      { role: 'user', content: 'consulta' },
    ];
    const before = JSON.stringify(messages);
    expect(apply(messages)).toMatchObject({
      messages,
      omittedMessages: 0,
      method: 'conservative_estimate',
    });
    expect(JSON.stringify(messages)).toBe(before);
  });
  it('reserves output + safety and omits only dispensable old prose with references', () => {
    const messages: AIMessage[] = [
      { role: 'system', content: 'Autoridad vigente y propuesta protegida' },
      ...Array.from({ length: 10 }, () =>
        prose('Una explicación antigua auxiliar. '.repeat(50)),
      ),
      { role: 'user', content: 'Objetivo actual: continuar con producto 12' },
    ];
    const result = apply(messages);
    expect(result.estimatedInputTokens).toBeLessThanOrEqual(4976);
    expect(result.estimatedInputTokens).toBeLessThan(
      estimateAgentInputTokens(messages, []) * 0.6,
    );
    expect(result.omittedMessages).toBeGreaterThan(0);
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
    expect(
      result.messages.filter((m) => m.content === messages[1].content),
    ).toHaveLength(2);
    const notice = result.messages.find((m) =>
      String(m.content).includes('historical_prose_omitted'),
    )!;
    expect(JSON.parse(String(notice.content))).toMatchObject({
      complete: false,
      history_refs: expect.any(Array),
    });
  });
  it('never removes tool-only turns, grouped tool IDs or results even when mis-tagged history', () => {
    const messages: AIMessage[] = [
      ...Array.from({ length: 9 }, () =>
        prose('Auxiliar sin compromisos. '.repeat(100)),
      ),
      {
        role: 'assistant',
        content: '',
        context_retention: 'history',
        tool_calls: [
          {
            id: 'a',
            type: 'function',
            function: { name: 'get_product', arguments: '{"id":12}' },
          },
          {
            id: 'b',
            type: 'function',
            function: { name: 'get_product', arguments: '{"id":13}' },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"evidence_ref":"artifact:x"}',
        tool_call_id: 'a',
        context_retention: 'history',
      },
      {
        role: 'tool',
        content: '{"effect_status":"unknown"}',
        tool_call_id: 'b',
        context_retention: 'history',
      },
      { role: 'user', content: 'No cambiar cantidades ni proveedor' },
    ];
    const result = apply(messages, 8000);
    expect(result.messages.slice(-4)).toEqual(messages.slice(-4));
  });
  it.each([
    'La aprobación está pendiente',
    'Producto id 2',
    'Cantidad cinco',
    'Recibo receipt:a',
    'El objetivo no está verificado',
  ])('pins obligation/evidence prose: %s', (text) => {
    expect(historicalAssistantProse(prose(text))).toBe(false);
  });
  it('fails closed when required content does not fit, rather than truncating JSON', () => {
    const messages: AIMessage[] = [
      { role: 'system', content: 'x'.repeat(6000) },
      { role: 'user', content: 'mantén esto' },
    ];
    expect(() => apply(messages)).toThrow('AI_AGENT_CONTEXT_REQUIRED_OVERFLOW');
    expect(messages[0].content).toHaveLength(6000);
  });
  it('counts schema overhead and never drops authorized tools for cache hits', () => {
    const tools: AIToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'get_product',
          description: 'x'.repeat(7000),
          parameters: { type: 'object' },
        },
      },
    ];
    expect(() =>
      apply([{ role: 'user', content: 'consulta' }], 6000, tools),
    ).toThrow('AI_AGENT_CONTEXT_REQUIRED_OVERFLOW');
    expect(tools[0].function.description).toHaveLength(7000);
  });
  it('does not confuse character counts with observed tokens for escaped and multibyte strings', () => {
    const ascii = estimateAgentInputTokens(
      [{ role: 'user', content: 'a'.repeat(40) }],
      [],
    );
    const multibyte = estimateAgentInputTokens(
      [{ role: 'user', content: '😀'.repeat(40) }],
      [],
    );
    expect(multibyte).toBeGreaterThan(ascii);
    expect(
      estimateAgentInputTokens(
        [{ role: 'user', content: '\\"'.repeat(40) }],
        [],
      ),
    ).toBeGreaterThan(ascii);
  });
  it('rejects uncounted remote multimodal content and invalid reserves', () => {
    expect(() =>
      apply([
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'https://example.invalid/x' },
            },
          ],
        },
      ]),
    ).toThrow('AI_AGENT_CONTEXT_UNCOUNTED_MULTIMODAL');
    expect(() =>
      applyAgentContextBudget([], [], {
        contextWindowTokens: 100,
        maxOutputTokens: 100,
      }),
    ).toThrow('AI_AGENT_CONTEXT_INVALID_BUDGET');
  });
});
