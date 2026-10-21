import {
  AnthropicCompatibleProvider,
  NATIVE_TOOL_SEARCH_BETA,
  resetNativeToolSearchCapabilityCache,
} from './anthropic-compatible.provider';
import { AIProviderConfig } from '../interfaces/ai-provider.interface';
import { Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

describe('AnthropicCompatibleProvider prompt caching (Vex step 5)', () => {
  const buildProvider = (): AnthropicCompatibleProvider => {
    const config: AIProviderConfig = {
      provider: 'Anthropic',
      sdkType: 'anthropic_compatible',
      apiKey: 'test-key',
      modelId: 'test-model',
    };
    return new AnthropicCompatibleProvider(config);
  };

  const toolDef = (name: string) => ({
    type: 'function' as const,
    function: {
      name,
      description: `${name} desc`,
      parameters: { type: 'object' },
    },
  });

  it('marks system and the last tool block ephemeral in chat()', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hola' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    (provider as any).client.messages.create = create;

    await provider.chat([{ role: 'system', content: 'eres Vex' }], {
      tools: [toolDef('a_tool'), toolDef('z_tool')],
    });

    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0][0];
    expect(payload.system).toEqual([
      {
        type: 'text',
        text: 'eres Vex',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(payload.tools).toHaveLength(2);
    expect(payload.tools[0]).not.toHaveProperty('cache_control');
    expect(payload.tools[1]).toMatchObject({
      name: 'z_tool',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('omits the system block without a system prompt but still caches tools', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hola' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    (provider as any).client.messages.create = create;

    await provider.chat([{ role: 'user', content: 'hola' }], {
      tools: [toolDef('solo')],
    });

    const payload = create.mock.calls[0][0];
    expect(payload).not.toHaveProperty('system');
    expect(payload.tools).toEqual([
      expect.objectContaining({
        name: 'solo',
        cache_control: { type: 'ephemeral' },
      }),
    ]);
  });

  it('marks system and the last tool block ephemeral in chatStream()', async () => {
    const provider = buildProvider();
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hola' },
        };
      },
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'hola' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    (provider as any).client.messages.stream = stream;

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(
      [{ role: 'system', content: 'eres Vex' }],
      { tools: [toolDef('a_tool'), toolDef('z_tool')] },
    )) {
      chunks.push(chunk);
    }

    expect(stream).toHaveBeenCalledTimes(1);
    const payload = stream.mock.calls[0][0];
    expect(payload.system).toEqual([
      {
        type: 'text',
        text: 'eres Vex',
        cache_control: { type: 'ephemeral' },
      },
    ]);
    expect(payload.tools[0]).not.toHaveProperty('cache_control');
    expect(payload.tools[1]).toMatchObject({
      cache_control: { type: 'ephemeral' },
    });
    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
  });

  it('carga dinámica: cache_control va en la última tool del núcleo y el orden se preserva', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hola' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    (provider as any).client.messages.create = create;

    await provider.chat([{ role: 'system', content: 'eres Vex' }], {
      tools: [
        toolDef('core_a'),
        toolDef('core_b'),
        toolDef('z_loaded'),
        toolDef('a_loaded'),
      ],
      toolCachePrefix: 2,
    });

    const payload = create.mock.calls[0][0];
    expect(payload.tools.map((t: any) => t.name)).toEqual([
      'core_a',
      'core_b',
      'z_loaded',
      'a_loaded',
    ]);
    expect(
      payload.tools
        .map((t: any, i: number) => (t.cache_control ? i : -1))
        .filter((i: number) => i >= 0),
    ).toEqual([1]);
    expect(payload).not.toHaveProperty('toolCachePrefix');
  });

  it('maps cache_read_input_tokens/cache_creation_input_tokens in chat()', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hola' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 50,
      },
    });
    (provider as any).client.messages.create = create;

    const response = await provider.chat([{ role: 'user', content: 'hola' }]);

    expect(response.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 265,
      cacheReadTokens: 200,
      cacheCreationTokens: 50,
    });
  });

  it('defaults cache tokens to 0 in chat() when the provider omits them', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'hola' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    (provider as any).client.messages.create = create;

    const response = await provider.chat([{ role: 'user', content: 'hola' }]);

    expect(response.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  it('maps cache tokens on the chatStream() done chunk', async () => {
    const provider = buildProvider();
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'hola' },
        };
      },
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'hola' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 0,
        },
      }),
    });
    (provider as any).client.messages.stream = stream;

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream([
      { role: 'user', content: 'hola' },
    ])) {
      chunks.push(chunk);
    }

    const done = chunks.find((c) => c.type === 'done');
    expect(done.usage).toMatchObject({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 315,
      cacheReadTokens: 300,
      cacheCreationTokens: 0,
    });
  });
});

describe('AnthropicCompatibleProvider ReAct history contract', () => {
  const providerFor = () =>
    new AnthropicCompatibleProvider({
      provider: 'Anthropic',
      sdkType: 'anthropic_compatible',
      apiKey: 'test-key',
      modelId: 'test-model',
    });
  const final = () => ({
    content: [{ type: 'text', text: 'Listo' }],
    model: 'test-model',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  it('runs two rounds, preserving assistant tool_use and grouped results with IDs', async () => {
    const provider = providerFor();
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        ...final(),
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Consulto ambos' },
          {
            type: 'tool_use',
            id: 'a',
            name: 'list_orders',
            input: { limit: 2 },
          },
          { type: 'tool_use', id: 'b', name: 'list_customers', input: {} },
        ],
      })
      .mockResolvedValueOnce(final());
    (provider as any).client.messages.create = create;
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] =
      [
        { role: 'system', content: 'Base estable' },
        { role: 'user', content: 'Consulta' },
      ];
    const first = await provider.chat(messages);
    expect(first.success).toBe(true);
    messages.push({
      role: 'assistant',
      content: first.content!,
      tool_calls: first.tool_calls,
    });
    messages.push({ role: 'system', content: 'No aplicar sin aprobación' });
    messages.push({
      role: 'tool',
      tool_call_id: 'a',
      content: '{"data":[{"id":42}]}',
    });
    messages.push({
      role: 'tool',
      tool_call_id: 'b',
      content: '{"error":"Permiso revocado"}',
    });
    const second = await provider.chat(messages);
    expect(second.content).toBe('Listo');
    expect(create.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Consulta' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Consulto ambos' },
          {
            type: 'tool_use',
            id: 'a',
            name: 'list_orders',
            input: { limit: 2 },
          },
          { type: 'tool_use', id: 'b', name: 'list_customers', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'a',
            content: '{"data":[{"id":42}]}',
          },
          {
            type: 'tool_result',
            tool_use_id: 'b',
            content: '{"error":"Permiso revocado"}',
            is_error: true,
          },
        ],
      },
    ]);
    expect(create.mock.calls[1][0].system.map((s: any) => s.text)).toEqual([
      'Base estable',
      'No aplicar sin aprobación',
    ]);
  });

  it('chat and stream normalize identically, retaining all runtime systems and images', async () => {
    const provider = providerFor();
    const create = jest.fn().mockResolvedValue(final());
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
      finalMessage: async () => final(),
    });
    (provider as any).client.messages.create = create;
    (provider as any).client.messages.stream = stream;
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] =
      [
        { role: 'system', content: 'Base antigua' },
        { role: 'system', content: [{ type: 'text', text: 'Plan activo' }] },
        { role: 'system', content: 'Confirmación pendiente' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Mira' },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png' },
            },
          ],
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'a',
              type: 'function',
              function: { name: 'probe', arguments: '{}' },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'a',
          content: '{"pending_confirmation":true}',
        },
        { role: 'user', content: 'Continúa' },
      ];
    const options = { systemPrompt: 'Base nueva' };
    await provider.chat(messages, options);
    for await (const chunk of provider.chatStream(messages, options)) {
      expect(chunk.type).not.toBe('error');
    }
    const payload = create.mock.calls[0][0];
    expect(stream.mock.calls[0][0]).toEqual(payload);
    expect(payload.system.map((s: any) => s.text)).toEqual([
      'Base nueva',
      'Plan activo',
      'Confirmación pendiente',
    ]);
    expect(payload.system.filter((s: any) => s.cache_control)).toHaveLength(1);
    expect(payload.messages[0].content[1]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/a.png' },
    });
    expect(payload.messages[1].content).toEqual([
      { type: 'tool_use', id: 'a', name: 'probe', input: {} },
    ]);
    expect(payload.messages[2].content).toEqual([
      {
        type: 'tool_result',
        tool_use_id: 'a',
        content: '{"pending_confirmation":true}',
      },
      { type: 'text', text: 'Continúa' },
    ]);
    expect(messages[0].content).toBe('Base antigua');
  });

  it.each(['{', '[]', 'null', '42', '"wrong"'])(
    'rejects invalid tool arguments %s locally, never replacing them with {}',
    async (args) => {
      const provider = providerFor();
      const create = jest.fn();
      const stream = jest.fn();
      (provider as any).client.messages.create = create;
      (provider as any).client.messages.stream = stream;
      const messages: import('../interfaces/ai-provider.interface').AIMessage[] =
        [
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'a',
                type: 'function',
                function: { name: 'write_endpoint', arguments: args },
              },
            ],
          },
        ];
      expect((await provider.chat(messages)).success).toBe(false);
      const chunks: import('../interfaces/ai-provider.interface').AIStreamChunk[] =
        [];
      for await (const chunk of provider.chatStream(messages))
        chunks.push(chunk);
      expect(chunks.map((c) => c.type)).toEqual(['error']);
      expect(create).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    },
  );

  it('rejects a tool result without its correlation ID', async () => {
    const provider = providerFor();
    const create = jest.fn();
    (provider as any).client.messages.create = create;
    const response = await provider.chat([
      { role: 'tool', content: 'missing id' },
    ]);
    expect(response).toMatchObject({
      success: false,
      error: 'Tool result is missing tool_call_id',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps 50 tool-only calls/results together without reordering or mutating input', async () => {
    const provider = providerFor();
    const create = jest.fn().mockResolvedValue(final());
    (provider as any).client.messages.create = create;
    const calls = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      type: 'function' as const,
      function: { name: `read_${i}`, arguments: JSON.stringify({ id: i }) },
    }));
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] =
      [
        { role: 'user', content: 'Lee' },
        { role: 'assistant', content: '', tool_calls: calls },
        ...calls.map((c) => ({
          role: 'tool' as const,
          tool_call_id: c.id,
          content: c.id,
        })),
      ];
    const before = JSON.stringify(messages);
    await provider.chat(messages);
    const payload = create.mock.calls[0][0];
    expect(payload.messages.map((m: any) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(payload.messages[2].content.map((c: any) => c.tool_use_id)).toEqual(
      calls.map((c) => c.id),
    );
    expect(payload.messages[1].content).toHaveLength(50);
    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe('Anthropic D0 discriminated tool results', () => {
  it.each([
    ['recoverable_error', true],
    ['blocked', true],
    ['pending_confirmation', false],
    ['needs_user_input', false],
    ['unknown_effect', false],
    ['ok', false],
  ])('%s preserves native is_error semantics', (status, expected) => {
    const provider = new AnthropicCompatibleProvider({
      provider: 'Anthropic',
      sdkType: 'anthropic_compatible',
      apiKey: 'test-key',
      modelId: 'test-model',
    });
    expect(
      (provider as any).isToolError(
        JSON.stringify({ schema_version: '1', status }),
      ),
    ).toBe(expected);
  });
});

describe('Anthropic B generic routing compatibility (native search intentionally OFF)', () => {
  it('accepts expanded catalogs across rounds without native/deferred fields or history loss', async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: 'Custom',
      sdkType: 'anthropic_compatible',
      apiKey: 'test-key',
      modelId: 'test-model',
      baseUrl: 'https://example.invalid',
    });
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    (provider as any).client.messages.create = create;
    const definitions = Array.from({ length: 25 }, (_, i) => ({
      type: 'function' as const,
      function: {
        name: `operation_${i}`,
        description: 'sintética',
        parameters: { type: 'object' },
      },
    }));
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] =
      [
        { role: 'user', content: 'Busca' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'discovery1',
              type: 'function',
              function: {
                name: 'search_tools',
                arguments: '{"query":"operation_24"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'discovery1',
          content: '{"enabled_next_inference":true}',
        },
      ];
    const before = JSON.stringify(messages);
    await provider.chat(messages, { tools: definitions.slice(0, 13) });
    await provider.chat(messages, { tools: definitions });
    expect(create.mock.calls[1][0].tools).toHaveLength(25);
    expect(create.mock.calls[0][0].messages).toEqual(
      create.mock.calls[1][0].messages,
    );
    expect(JSON.stringify(messages)).toBe(before);
    const payload = JSON.stringify(create.mock.calls[1][0]);
    for (const native of [
      'defer_loading',
      'tool_search_tool',
      'server_tool_use',
      'tool_reference',
      'pause_turn',
    ])
      expect(payload).not.toContain(native);
  });
});

describe('Anthropic-compatible D2 opt-in cancellation', () => {
  const provider = () =>
    new AnthropicCompatibleProvider({
      provider: 'QA',
      sdkType: 'anthropic_compatible',
      apiKey: 'synthetic-test-only',
      modelId: 'test-model',
    });
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes AbortSignal in SDK request options without changing the model payload', async () => {
    const instance = provider();
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    (instance as any).client.messages.create = create;
    await expect(
      instance.chat([{ role: 'user', content: 'read' }], {
        deadlineMs: Date.now() + 1000,
      }),
    ).resolves.toMatchObject({ success: true });
    expect(create.mock.calls[0][0]).not.toHaveProperty('signal');
    expect(create.mock.calls[0][0]).not.toHaveProperty('deadlineMs');
    expect(create.mock.calls[0][1]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it('avoids a pre-aborted dispatch and fences a late provider completion', async () => {
    const instance = provider();
    let finish!: (value: any) => void;
    const create = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    (instance as any).client.messages.create = create;
    const caller = new AbortController();
    caller.abort();
    await expect(
      instance.chat([], { signal: caller.signal }),
    ).resolves.toMatchObject({
      success: false,
      error_code: 'AGENT_CANCELLED',
      retryable: false,
    });
    expect(create).not.toHaveBeenCalled();
    const result = instance.chat([], { deadlineMs: Date.now() + 50 });
    await jest.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toMatchObject({
      success: false,
      error_code: 'AGENT_DEADLINE_EXCEEDED',
      retryable: false,
    });
    finish({
      content: [{ type: 'text', text: 'late success' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation to messages.stream and fences late frames', async () => {
    const instance = provider();
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise(() => undefined),
      }),
      finalMessage: jest.fn(),
    });
    (instance as any).client.messages.stream = stream;
    const chunks: any[] = [];
    const result = (async () => {
      for await (const chunk of instance.chatStream([], {
        deadlineMs: Date.now() + 20,
      }))
        chunks.push(chunk);
    })();
    await jest.advanceTimersByTimeAsync(20);
    await result;
    expect(chunks).toEqual([
      { type: 'error', error: 'Agent deadline exceeded' },
    ]);
    expect(stream.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('propagates abort into the installed SDK fetch without transport retry', async () => {
    const fetcher = jest.fn(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new DOMException('aborted', 'AbortError'));
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) abort();
        }),
    );
    const instance = new AnthropicCompatibleProvider({
      provider: 'QA',
      sdkType: 'anthropic_compatible',
      apiKey: 'synthetic-test-only',
      modelId: 'test-model',
      fetch: fetcher,
    });
    const result = instance.chat([], { deadlineMs: Date.now() + 30 });
    await jest.advanceTimersByTimeAsync(30);
    await expect(result).resolves.toMatchObject({
      success: false,
      retryable: false,
      error_code: 'AGENT_DEADLINE_EXCEEDED',
    });
    await jest.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

describe('Anthropic-compatible H assembled agent stream', () => {
  const tools = ['z_read', 'a_read'].map((name) => ({
    type: 'function' as const,
    function: { name, description: name, parameters: { type: 'object' } },
  }));
  const build = (final: Record<string, any>, events: any[] = []) => {
    const observeUsage = jest.fn();
    const provider = new AnthropicCompatibleProvider({
      provider: 'test',
      sdkType: 'anthropic_compatible',
      apiKey: 'not-real',
      modelId: 'configured',
      observeUsage,
    });
    const finalMessage = jest.fn().mockResolvedValue(final);
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield* events;
      },
      finalMessage,
    });
    (provider as any).client.messages.stream = stream;
    return { provider, stream, finalMessage, observeUsage };
  };
  const collect = async (source: AsyncIterable<unknown>) => {
    const chunks: any[] = [];
    for await (const chunk of source) chunks.push(chunk);
    return chunks;
  };

  it('does not expose partial input JSON and emits the complete tool-only batch only in done', async () => {
    const final = {
      model: 'configured',
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'a', name: 'a_read', input: { quantity: 2 } },
        { type: 'tool_use', id: 'b', name: 'z_read', input: {} },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 20,
      },
    };
    const { provider, observeUsage } = build(final, [
      {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"quantity":' },
      },
    ]);
    const chunks = await collect(
      provider.chatStream([], { agenticStream: true, tools }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: 'done',
      finish_reason: 'tool_calls',
      usage_state: 'reported',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 65,
        cacheReadTokens: 30,
        cacheCreationTokens: 20,
      },
    });
    expect(chunks[0].tool_calls.map((c: any) => c.id)).toEqual(['a', 'b']);
    expect(chunks[0].tool_calls[0].function.arguments).toBe('{"quantity":2}');
    expect(observeUsage).toHaveBeenCalledWith({
      promptTokens: 10,
      completionTokens: 5,
      cacheReadTokens: 30,
      cacheCreationTokens: 20,
    });
  });

  it.each([null, [], 42, 'malformed'])(
    'rejects completed non-object input %p without any executable frame',
    async (input) => {
      const { provider } = build({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'a', name: 'a_read', input }],
      });
      const chunks = await collect(
        provider.chatStream([], { agenticStream: true, tools }),
      );
      expect(chunks.map((c) => c.type)).toEqual(['error']);
    },
  );

  it('streams text before finalMessage and unknown usage remains absent, not fake zero/cache hit', async () => {
    const { provider, finalMessage } = build(
      {
        model: 'configured',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'ok' }],
      },
      [
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'ok' },
        },
      ],
    );
    const source = provider.chatStream([], { agenticStream: true });
    expect((await source.next()).value).toEqual({
      type: 'text',
      content: 'ok',
    });
    expect(finalMessage).not.toHaveBeenCalled();
    const done: any = (await source.next()).value;
    expect(done.usage_state).toBe('unknown');
    expect(done.usage).toBeUndefined();
    await source.return(undefined);
  });

  it('canonical working set and stable cache boundaries retain dynamic systems and grouped tool results', async () => {
    const final = {
      model: 'configured',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    };
    const { provider, stream } = build(final);
    const messages: any[] = [
      { role: 'system', content: 'stable base' },
      { role: 'system', content: 'tenant and pending approval' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'a',
            type: 'function',
            function: { name: 'a_read', arguments: '{}' },
          },
          {
            id: 'b',
            type: 'function',
            function: { name: 'z_read', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' },
      {
        role: 'tool',
        tool_call_id: 'b',
        content: '{"pending_confirmation":true}',
      },
    ];
    await collect(
      provider.chatStream(messages, {
        agenticStream: true,
        tools,
        tool_choice: 'auto',
      }),
    );
    const payload = stream.mock.calls[0][0];
    expect(payload.tools.map((t: any) => t.name)).toEqual(['z_read', 'a_read']);
    expect(payload.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(payload.system).toEqual([
      {
        type: 'text',
        text: 'stable base',
        cache_control: { type: 'ephemeral' },
      },
      { type: 'text', text: 'tenant and pending approval' },
    ]);
    expect(payload.messages[1].content.map((b: any) => b.tool_use_id)).toEqual([
      'a',
      'b',
    ]);
    expect(payload.messages[1].content[1]).not.toHaveProperty('is_error');
    expect(payload.tool_choice).toEqual({ type: 'auto' });
    expect(JSON.stringify(payload)).not.toContain('agenticStream');
  });

  it('rejects tool batches truncated by max_tokens even when assembled input is valid', async () => {
    const { provider } = build({
      stop_reason: 'max_tokens',
      content: [{ type: 'tool_use', id: 'a', name: 'a_read', input: {} }],
    });
    const chunks = await collect(
      provider.chatStream([], { agenticStream: true, tools }),
    );
    expect(chunks.map((c) => c.type)).toEqual(['error']);
  });

  it('disconnect aborts live SDK signal and does not await finalMessage or retry', async () => {
    const { provider, stream, finalMessage } = build({}, [
      {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'partial' },
      },
    ]);
    const source = provider.chatStream([], { agenticStream: true });
    await source.next();
    await source.return(undefined);
    expect(stream.mock.calls[0][1].signal.aborted).toBe(true);
    expect(finalMessage).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
  });
});

describe('Anthropic-compatible H buffered/stream parity', () => {
  it.each(['tool_use', 'end_turn'])(
    'preserves cache boundaries and normalized tool-only results with %s',
    async (stopReason) => {
      const provider = new AnthropicCompatibleProvider({
        provider: 'test',
        sdkType: 'anthropic_compatible',
        apiKey: 'not-real',
        modelId: 'unchanged',
      });
      const tools = ['z', 'a'].map((name) => ({
        type: 'function' as const,
        function: {
          name,
          description: name,
          parameters: {
            type: 'object',
            properties: { quantity: { type: 'integer' } },
            required: ['quantity'],
          },
        },
      }));
      const final = {
        model: 'unchanged',
        stop_reason: stopReason,
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          { type: 'tool_use', id: 'one', name: 'a', input: { quantity: '2' } },
          { type: 'tool_use', id: 'two', name: 'z', input: { quantity: 3 } },
        ],
      };
      const messages: any[] = [
        { role: 'system', content: 'base old' },
        { role: 'system', content: 'runtime and pending approval' },
        {
          role: 'assistant',
          content: '',
          tool_calls: final.content.map((block) => ({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: '{}' },
          })),
        },
        { role: 'tool', tool_call_id: 'one', content: '{}' },
        { role: 'tool', tool_call_id: 'two', content: '{}' },
      ];
      const create = jest.fn().mockResolvedValue(final);
      const stream = jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {},
        finalMessage: async () => final,
      });
      (provider as any).client.messages.create = create;
      (provider as any).client.messages.stream = stream;
      const options = {
        agenticStream: true,
        tools,
        systemPrompt: 'base new',
        tool_choice: 'auto' as const,
      };
      const buffered = await provider.chat(messages, options);
      const chunks: any[] = [];
      for await (const chunk of provider.chatStream(messages, options))
        chunks.push(chunk);
      expect(stream.mock.calls[0][0]).toEqual(create.mock.calls[0][0]);
      expect(chunks[0].tool_calls).toEqual(buffered.tool_calls);
      expect(chunks[0].usage).toEqual(buffered.usage);
      expect(chunks[0].usage).not.toHaveProperty('cacheReadTokens');
      expect(chunks[0].tool_calls[0].function.arguments).toBe('{"quantity":2}');
      expect(messages[0].content).toBe('base old');
    },
  );
});

describe('Anthropic-compatible H metering capability', () => {
  it('declares native metered streams and rejects empty tool_use terminals', async () => {
    const provider = new AnthropicCompatibleProvider({
      provider: 'test',
      sdkType: 'anthropic_compatible',
      apiKey: 'not-real',
      modelId: 'unchanged',
    });
    expect(provider.supportsMeteredAgentStream()).toBe(true);
    const final = {
      stop_reason: 'tool_use',
      content: [],
      usage: { input_tokens: 10, output_tokens: 1 },
    };
    (provider as any).client.messages.create = jest
      .fn()
      .mockResolvedValue(final);
    (provider as any).client.messages.stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
      finalMessage: async () => final,
    });
    expect(await provider.chat([], { agenticStream: true })).toMatchObject({
      success: false,
    });
    const chunks: any[] = [];
    for await (const chunk of provider.chatStream([], { agenticStream: true }))
      chunks.push(chunk);
    expect(chunks.map((c) => c.type)).toEqual(['error']);
  });
});

describe('AnthropicCompatibleProvider native tool search (F7)', () => {
  const buildProvider = (
    baseUrl?: string,
    extra: Partial<AIProviderConfig> = {},
  ): AnthropicCompatibleProvider =>
    new AnthropicCompatibleProvider({
      provider: 'Anthropic',
      sdkType: 'anthropic_compatible',
      apiKey: 'test-key',
      modelId: 'test-model',
      ...(baseUrl && { baseUrl }),
      ...extra,
    });

  const toolDef = (name: string) => ({
    type: 'function' as const,
    function: {
      name,
      description: `${name} desc`,
      parameters: { type: 'object' },
    },
  });

  const probeAccepted = {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_x',
        name: 'vendix_probe_echo',
        input: { text: 'ok' },
      },
    ],
    model: 'test-model',
    stop_reason: 'tool_use',
    usage: { input_tokens: 1, output_tokens: 1 },
  };
  // Negative check passes: without a reference only the search tool is callable.
  const probeNegativeOk = {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_y',
        name: 'vendix_probe_search',
        input: { query: 'echo' },
      },
    ],
    model: 'test-model',
    stop_reason: 'tool_use',
    usage: { input_tokens: 2, output_tokens: 3 },
  };
  const plainReply = {
    content: [{ type: 'text', text: 'hola' }],
    model: 'test-model',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  // search_tools fixture exactly as ToolRouterService.search serializes it.
  const searchResult = JSON.stringify({
    results: [
      { name: 'get_cash_status', description: 'Estado de caja' },
      { name: 'forbidden_tool', description: 'Fuera de la autoridad' },
      { name: 'get_cash_status', description: 'duplicado' },
    ],
    next_step: 'Llama la herramienta elegida.',
  });
  const history = [
    { role: 'system' as const, content: 'eres Vexi' },
    { role: 'user' as const, content: '¿cuánto hay en caja?' },
    {
      role: 'assistant' as const,
      content: '',
      tool_calls: [
        {
          id: 'call_search',
          type: 'function' as const,
          function: {
            name: 'search_tools',
            arguments: JSON.stringify({ query: 'caja' }),
          },
        },
      ],
    },
    {
      role: 'tool' as const,
      content: searchResult,
      tool_call_id: 'call_search',
    },
  ];
  const agentOptions = {
    agenticStream: true,
    tools: [toolDef('core_a'), toolDef('search_tools'), toolDef('loaded_x')],
    toolCachePrefix: 2,
    tool_choice: 'auto' as const,
    deferredTools: [
      toolDef('core_a'),
      toolDef('search_tools'),
      toolDef('loaded_x'),
      toolDef('z_deferred'),
      toolDef('get_cash_status'),
    ],
  };

  let warn: jest.SpyInstance;
  beforeEach(() => {
    resetNativeToolSearchCapabilityCache();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('probe: supported when 2xx and the referenced tool is callable; cached by (baseUrl, model)', async () => {
    const provider = buildProvider();
    const create = jest
      .fn()
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;

    await expect(provider.probeNativeToolSearch()).resolves.toEqual({
      native: true,
    });
    expect(create).toHaveBeenCalledTimes(2); // positive + negative check
    const [body, requestOptions] = create.mock.calls[0];
    expect(body.tools).toEqual([
      expect.objectContaining({
        name: 'vendix_probe_search',
        cache_control: { type: 'ephemeral' },
      }),
      expect.objectContaining({
        name: 'vendix_probe_echo',
        defer_loading: true,
      }),
    ]);
    expect(body.tools[1]).not.toHaveProperty('cache_control');
    expect(body.messages[2].content[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_vendix_probe_1',
      content: expect.arrayContaining([
        { type: 'tool_reference', tool_name: 'vendix_probe_echo' },
      ]),
    });
    expect(requestOptions).toMatchObject({ maxRetries: 0 });
    expect(requestOptions).not.toHaveProperty('headers');

    // Same (baseUrl, model) on another instance: served from the cache.
    const other = buildProvider();
    const otherCreate = jest.fn().mockResolvedValue(plainReply);
    (other as any).client.messages.create = otherCreate;
    await other.chat(history, agentOptions);
    expect(otherCreate).toHaveBeenCalledTimes(1); // the real request only
    expect(otherCreate.mock.calls[0][0].tools).toHaveLength(5);
  });

  it('probe: falls back to the beta header variant and records it', async () => {
    const provider = buildProvider();
    const create = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('unknown block tool_reference'), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;

    await expect(provider.probeNativeToolSearch()).resolves.toEqual({
      native: true,
      headers: { 'anthropic-beta': NATIVE_TOOL_SEARCH_BETA },
    });
    expect(create.mock.calls[1][1]).toMatchObject({
      headers: { 'anthropic-beta': NATIVE_TOOL_SEARCH_BETA },
    });
  });

  it('probe: 2xx without calling the referenced tool (proxy dropped the block) is unsupported', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue(plainReply);
    (provider as any).client.messages.create = create;
    await expect(provider.probeNativeToolSearch()).resolves.toEqual({
      native: false,
    });
    expect(create).toHaveBeenCalledTimes(2); // plain + beta variant
  });

  it('probe: errors are cached as unsupported and never break the request', async () => {
    const provider = buildProvider('https://proxy.example.com/');
    const isProbe = (body: any) =>
      body.tools?.some((t: any) => t.name === 'vendix_probe_echo');
    const create = jest.fn((body: any) =>
      isProbe(body)
        ? Promise.reject(new Error('400 invalid_request_error'))
        : Promise.resolve(plainReply),
    );
    (provider as any).client.messages.create = create;

    // First request: probe starts in the background, request takes own path.
    const first = await provider.chat(history, agentOptions);
    expect(first.success).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(create.mock.calls.filter(([b]) => isProbe(b))).toHaveLength(2);
    const calls = create.mock.calls.length;
    // Second request: cached false → no new probe, own path again.
    const second = await provider.chat(history, agentOptions);
    expect(second.success).toBe(true);
    expect(create.mock.calls.length).toBe(calls + 1);
    const ownPath = create.mock.calls[create.mock.calls.length - 1];
    expect(ownPath[0].tools.map((t: any) => t.name)).toEqual([
      'core_a',
      'search_tools',
      'loaded_x',
    ]);
    expect(ownPath[0].tools.some((t: any) => 'defer_loading' in t)).toBe(false);
    expect(ownPath[0].messages[2].content[0].content).toBe(searchResult);
  });

  it('native: sends the authorized catalog deferred, cache_control on the last core tool, search_tools → tool_reference', async () => {
    const provider = buildProvider();
    const create = jest
      .fn()
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;
    await provider.probeNativeToolSearch();
    create.mockReset().mockResolvedValue(plainReply);

    await provider.chat(history, agentOptions);
    const payload = create.mock.calls[0][0];
    expect(payload.tools.map((t: any) => [t.name, !!t.defer_loading])).toEqual([
      ['core_a', false],
      ['search_tools', false],
      ['loaded_x', false],
      ['get_cash_status', true],
      ['z_deferred', true],
    ]);
    expect(
      payload.tools
        .map((t: any, i: number) => (t.cache_control ? i : -1))
        .filter((i: number) => i >= 0),
    ).toEqual([1]);
    expect(payload).not.toHaveProperty('deferredTools');
    const result = payload.messages[2].content[0];
    expect(result).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_search',
      content: [
        { type: 'text', text: searchResult },
        // forbidden_tool is not in the sent catalog; the duplicate collapses.
        { type: 'tool_reference', tool_name: 'get_cash_status' },
      ],
    });
    expect(create.mock.calls[0]).toHaveLength(1); // no beta header needed

    // History preserved: the next round reproduces the same blocks.
    await provider.chat(
      [...history, { role: 'user', content: 'y ahora?' }],
      agentOptions,
    );
    expect(create.mock.calls[1][0].messages[2].content[0]).toEqual(result);
  });

  it('native: a referenced deferred tool call validates; unauthorized names still rejected', async () => {
    const provider = buildProvider();
    const create = jest
      .fn()
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;
    await provider.probeNativeToolSearch();
    create.mockReset().mockResolvedValueOnce({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'get_cash_status',
          input: {},
        },
      ],
      model: 'test-model',
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const ok = await provider.chat(history, agentOptions);
    expect(ok.success).toBe(true);
    expect(ok.tool_calls?.[0].function.name).toBe('get_cash_status');

    create.mockResolvedValueOnce({
      content: [
        { type: 'tool_use', id: 'toolu_2', name: 'forbidden_tool', input: {} },
      ],
      model: 'test-model',
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const rejected = await provider.chat(history, agentOptions);
    expect(rejected.success).toBe(false);
  });

  it('native: chatStream sends deferred tools and the recorded beta header', async () => {
    const provider = buildProvider();
    const create = jest
      .fn()
      .mockRejectedValueOnce(new Error('400'))
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;
    await provider.probeNativeToolSearch();
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
      finalMessage: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'hola' }],
        model: 'test-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    (provider as any).client.messages.stream = stream;

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(history, agentOptions))
      chunks.push(chunk);
    expect(chunks.at(-1)).toMatchObject({ type: 'done' });
    const [payload, requestOptions] = stream.mock.calls[0];
    expect(payload.tools.filter((t: any) => t.defer_loading)).toHaveLength(2);
    expect(payload.messages[2].content[0].content[1]).toEqual({
      type: 'tool_reference',
      tool_name: 'get_cash_status',
    });
    expect(requestOptions).toMatchObject({
      headers: { 'anthropic-beta': NATIVE_TOOL_SEARCH_BETA },
    });
  });

  const rejection = (status: number, message = 'invalid_request_error') =>
    Object.assign(new Error(`${status} ${message}`), { status });
  const nativeProvider = async (extra: Partial<AIProviderConfig> = {}) => {
    const provider = buildProvider(undefined, extra);
    const create = jest
      .fn()
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;
    await expect(provider.probeNativeToolSearch()).resolves.toEqual({
      native: true,
    });
    create.mockReset();
    return { provider, create };
  };
  const ownPathNames = ['core_a', 'search_tools', 'loaded_x'];

  it('N2 chat: a native 4xx retries once without deferring and the turn succeeds; cache turns negative', async () => {
    const { provider, create } = await nativeProvider();
    create
      .mockRejectedValueOnce(rejection(400, 'tools.4.input_schema invalid'))
      .mockResolvedValue(plainReply);

    const result = await provider.chat(history, agentOptions);
    expect(result).toMatchObject({ success: true, content: 'hola' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(
      create.mock.calls[0][0].tools.some((t: any) => t.defer_loading),
    ).toBe(true);
    const [retry, retryOptions] = create.mock.calls[1];
    expect(retry.tools.map((t: any) => t.name)).toEqual(ownPathNames);
    expect(retry.tools.some((t: any) => 'defer_loading' in t)).toBe(false);
    expect(retry.messages[2].content[0].content).toBe(searchResult);
    expect(retryOptions).toBeUndefined(); // no beta header, no signal
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Native tool search rejected in chat'),
    );
    expect(warn.mock.calls[0][0]).toContain('"status":400');

    // Negative cache: next turn goes straight to our own path, no new probe.
    await provider.chat(history, agentOptions);
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[2][0].tools.map((t: any) => t.name)).toEqual(
      ownPathNames,
    );
  });

  it('N2 chat: when the non-native retry also fails the error propagates (no loop)', async () => {
    const { provider, create } = await nativeProvider();
    create.mockRejectedValue(rejection(400));
    const result = await provider.chat(history, agentOptions);
    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('N2 chat: errors not attributable to the native payload are not retried', async () => {
    const { provider, create } = await nativeProvider();
    create.mockRejectedValueOnce(rejection(401, 'authentication_error'));
    expect((await provider.chat(history, agentOptions)).success).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    // Capability untouched: the next turn is still native.
    create.mockResolvedValueOnce(plainReply);
    await provider.chat(history, agentOptions);
    expect(
      create.mock.calls[1][0].tools.some((t: any) => t.defer_loading),
    ).toBe(true);

    // A 400 on a non-native request (no deferredTools) is never retried.
    create.mockReset().mockRejectedValueOnce(rejection(400));
    const { deferredTools: _omit, ...withoutCatalog } = agentOptions;
    expect((await provider.chat(history, withoutCatalog)).success).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  const finalText = {
    content: [{ type: 'text', text: 'hola' }],
    model: 'test-model',
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  it('N2 chatStream: a native 4xx before any chunk retries without deferring', async () => {
    const { provider } = await nativeProvider();
    const stream = jest
      .fn()
      .mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          throw rejection(413, 'request_too_large');
        },
        finalMessage: jest.fn(),
      })
      .mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'hola' },
          };
        },
        finalMessage: jest.fn().mockResolvedValue(finalText),
      });
    (provider as any).client.messages.stream = stream;

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(history, agentOptions))
      chunks.push(chunk);
    expect(chunks.map((c) => c.type)).toEqual(['text', 'done']);
    expect(stream).toHaveBeenCalledTimes(2);
    const [retry, retryOptions] = stream.mock.calls[1];
    expect(retry.tools.map((t: any) => t.name)).toEqual(ownPathNames);
    expect(retry.messages[2].content[0].content).toBe(searchResult);
    expect(retryOptions).not.toHaveProperty('headers');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('rejected in chatStream'),
    );
  });

  it('N2 chatStream: after a chunk reached the consumer the error propagates without retry', async () => {
    const { provider } = await nativeProvider();
    const stream = jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'ho' },
        };
        throw rejection(400);
      },
      finalMessage: jest.fn(),
    });
    (provider as any).client.messages.stream = stream;

    const chunks: any[] = [];
    for await (const chunk of provider.chatStream(history, agentOptions))
      chunks.push(chunk);
    expect(chunks.map((c) => c.type)).toEqual(['text', 'error']);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('N2 probe: an unreferenced deferred tool that is callable (defer_loading ignored) is unsupported', async () => {
    const provider = buildProvider();
    // Proxy that drops defer_loading: the echo tool is called in both checks.
    const create = jest.fn().mockResolvedValue(probeAccepted);
    (provider as any).client.messages.create = create;
    await expect(provider.probeNativeToolSearch()).resolves.toEqual({
      native: false,
    });
    expect(create).toHaveBeenCalledTimes(4); // (positive + negative) × 2 variants
    const negative = create.mock.calls[1][0];
    expect(negative.messages).toHaveLength(1);
    expect(JSON.stringify(negative.messages)).not.toContain('tool_reference');
    expect(negative.tools[1]).toMatchObject({
      name: 'vendix_probe_echo',
      defer_loading: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unreferenced deferred tool was callable'),
    );
  });

  it('N2 probe: an inconclusive negative check fails closed', async () => {
    const provider = buildProvider();
    const create = jest
      .fn()
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(plainReply)
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(plainReply);
    (provider as any).client.messages.create = create;
    await expect(provider.probeNativeToolSearch()).resolves.toEqual({
      native: false,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('negative check inconclusive'),
    );
  });

  it('N3 probe: records usage through recordBackgroundUsage (not observeUsage) and logs failures without secrets', async () => {
    const observeUsage = jest.fn();
    const recordBackgroundUsage = jest.fn();
    const provider = buildProvider(undefined, {
      apiKey: 'sk-ant-super-secret',
      observeUsage,
      recordBackgroundUsage,
    });
    const create = jest
      .fn()
      .mockRejectedValueOnce(rejection(400, 'unknown field defer_loading'))
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (provider as any).client.messages.create = create;
    await provider.probeNativeToolSearch();

    expect(recordBackgroundUsage.mock.calls).toEqual([
      [
        {
          purpose: 'tool_search_probe',
          model: 'test-model',
          usage: { promptTokens: 1, completionTokens: 1 },
          latencyMs: expect.any(Number),
        },
      ],
      [
        {
          purpose: 'tool_search_probe',
          model: 'test-model',
          usage: { promptTokens: 2, completionTokens: 3 },
          latencyMs: expect.any(Number),
        },
      ],
    ]);
    // The dispatch-scoped seam is never touched by the probe.
    expect(observeUsage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain('probe (plain, positive) failed');
    expect(line).toContain('"status":400');
    expect(line).not.toContain('sk-ant-super-secret');
  });

  it('N3 probe: a background probe runs detached from the triggering request context', async () => {
    const requestContext = new AsyncLocalStorage<string>();
    const seen: Array<[string | undefined, number | undefined]> = [];
    const provider = buildProvider(undefined, {
      observeUsage: (usage) =>
        seen.push([requestContext.getStore(), usage?.promptTokens]),
      recordBackgroundUsage: ({ usage }) =>
        seen.push([requestContext.getStore(), usage?.promptTokens]),
    });
    const isProbe = (body: any) =>
      body.tools?.some((t: any) => t.name === 'vendix_probe_echo');
    (provider as any).client.messages.create = jest.fn((body: any) =>
      Promise.resolve(
        isProbe(body)
          ? plainReply
          : { ...plainReply, usage: { input_tokens: 77, output_tokens: 1 } },
      ),
    );
    await requestContext.run('turn-1', () =>
      provider.chat(history, agentOptions),
    );
    await new Promise((r) => setImmediate(r));
    const turn = seen.filter(([, prompt]) => prompt === 77);
    const probe = seen.filter(([, prompt]) => prompt !== 77);
    expect(turn).toEqual([['turn-1', 77]]);
    expect(probe.length).toBeGreaterThan(0);
    expect(probe.every(([store]) => store === undefined)).toBe(true);
  });

  it('N3 cache key: includes a short credential fingerprint, never the key itself', async () => {
    const a = buildProvider(undefined, { apiKey: 'sk-ant-AAA' });
    const b = buildProvider(undefined, { apiKey: 'sk-ant-BBB' });
    const keyA = (a as any).capabilityKey('test-model') as string;
    const keyB = (b as any).capabilityKey('test-model') as string;
    expect(keyA).toMatch(
      /^https:\/\/api\.anthropic\.com\|test-model\|[0-9a-f]{12}$/,
    );
    expect(keyA).not.toContain('sk-ant-AAA');
    expect(keyA).not.toBe(keyB);

    // Editing the credential invalidates: A's verdict is not served to B.
    const createA = jest
      .fn()
      .mockResolvedValueOnce(probeAccepted)
      .mockResolvedValueOnce(probeNegativeOk);
    (a as any).client.messages.create = createA;
    await a.probeNativeToolSearch();
    const createB = jest.fn().mockResolvedValue(plainReply);
    (b as any).client.messages.create = createB;
    await b.chat(history, agentOptions);
    const isProbeBody = (body: any) =>
      body.tools?.some((t: any) => t.name === 'vendix_probe_echo');
    const turn = createB.mock.calls.filter(([body]) => !isProbeBody(body));
    expect(turn[0][0].tools.map((t: any) => t.name)).toEqual(ownPathNames);
    await new Promise((r) => setImmediate(r));
    expect(
      createB.mock.calls.filter(([body]) =>
        body.tools?.some((t: any) => t.name === 'vendix_probe_echo'),
      ).length,
    ).toBeGreaterThan(0); // B probes on its own
  });

  it('without deferredTools no probe runs and the request is unchanged', async () => {
    const provider = buildProvider();
    const create = jest.fn().mockResolvedValue(plainReply);
    (provider as any).client.messages.create = create;
    const { deferredTools: _omit, ...withoutCatalog } = agentOptions;
    await provider.chat(history, withoutCatalog);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].messages[2].content[0].content).toBe(
      searchResult,
    );
  });
});
