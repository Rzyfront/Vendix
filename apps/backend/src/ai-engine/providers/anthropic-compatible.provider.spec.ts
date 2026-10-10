import { AnthropicCompatibleProvider } from './anthropic-compatible.provider';
import { AIProviderConfig } from '../interfaces/ai-provider.interface';

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
    function: { name, description: `${name} desc`, parameters: { type: 'object' } },
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
  const providerFor = () => new AnthropicCompatibleProvider({
    provider: 'Anthropic', sdkType: 'anthropic_compatible',
    apiKey: 'test-key', modelId: 'test-model',
  });
  const final = () => ({
    content: [{ type: 'text', text: 'Listo' }], model: 'test-model',
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
  });

  it('runs two rounds, preserving assistant tool_use and grouped results with IDs', async () => {
    const provider = providerFor();
    const create = jest.fn()
      .mockResolvedValueOnce({
        ...final(), stop_reason: 'tool_use', content: [
          { type: 'text', text: 'Consulto ambos' },
          { type: 'tool_use', id: 'a', name: 'list_orders', input: { limit: 2 } },
          { type: 'tool_use', id: 'b', name: 'list_customers', input: {} },
        ],
      })
      .mockResolvedValueOnce(final());
    (provider as any).client.messages.create = create;
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] = [
      { role: 'system', content: 'Base estable' },
      { role: 'user', content: 'Consulta' },
    ];
    const first = await provider.chat(messages);
    expect(first.success).toBe(true);
    messages.push({ role: 'assistant', content: first.content!, tool_calls: first.tool_calls });
    messages.push({ role: 'system', content: 'No aplicar sin aprobación' });
    messages.push({ role: 'tool', tool_call_id: 'a', content: '{"data":[{"id":42}]}' });
    messages.push({ role: 'tool', tool_call_id: 'b', content: '{"error":"Permiso revocado"}' });
    const second = await provider.chat(messages);
    expect(second.content).toBe('Listo');
    expect(create.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Consulta' }] },
      { role: 'assistant', content: [
        { type: 'text', text: 'Consulto ambos' },
        { type: 'tool_use', id: 'a', name: 'list_orders', input: { limit: 2 } },
        { type: 'tool_use', id: 'b', name: 'list_customers', input: {} },
      ] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'a', content: '{"data":[{"id":42}]}' },
        { type: 'tool_result', tool_use_id: 'b', content: '{"error":"Permiso revocado"}', is_error: true },
      ] },
    ]);
    expect(create.mock.calls[1][0].system.map((s: any) => s.text)).toEqual([
      'Base estable', 'No aplicar sin aprobación',
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
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] = [
      { role: 'system', content: 'Base antigua' },
      { role: 'system', content: [{ type: 'text', text: 'Plan activo' }] },
      { role: 'system', content: 'Confirmación pendiente' },
      { role: 'user', content: [
        { type: 'text', text: 'Mira' },
        { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      ] },
      { role: 'assistant', content: '', tool_calls: [{
        id: 'a', type: 'function', function: { name: 'probe', arguments: '{}' },
      }] },
      { role: 'tool', tool_call_id: 'a', content: '{"pending_confirmation":true}' },
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
      'Base nueva', 'Plan activo', 'Confirmación pendiente',
    ]);
    expect(payload.system.filter((s: any) => s.cache_control)).toHaveLength(1);
    expect(payload.messages[0].content[1]).toEqual({
      type: 'image', source: { type: 'url', url: 'https://example.com/a.png' },
    });
    expect(payload.messages[1].content).toEqual([
      { type: 'tool_use', id: 'a', name: 'probe', input: {} },
    ]);
    expect(payload.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: '{"pending_confirmation":true}' },
      { type: 'text', text: 'Continúa' },
    ]);
    expect(messages[0].content).toBe('Base antigua');
  });

  it.each(['{', '[]', 'null', '42', '"wrong"'])(
    'rejects invalid tool arguments %s locally, never replacing them with {}', async (args) => {
      const provider = providerFor();
      const create = jest.fn();
      const stream = jest.fn();
      (provider as any).client.messages.create = create;
      (provider as any).client.messages.stream = stream;
      const messages: import('../interfaces/ai-provider.interface').AIMessage[] = [{
        role: 'assistant', content: '', tool_calls: [{
          id: 'a', type: 'function', function: { name: 'write_endpoint', arguments: args },
        }],
      }];
      expect((await provider.chat(messages)).success).toBe(false);
      const chunks = [];
      for await (const chunk of provider.chatStream(messages)) chunks.push(chunk);
      expect(chunks.map((c) => c.type)).toEqual(['error']);
      expect(create).not.toHaveBeenCalled();
      expect(stream).not.toHaveBeenCalled();
    },
  );

  it('rejects a tool result without its correlation ID', async () => {
    const provider = providerFor();
    const create = jest.fn();
    (provider as any).client.messages.create = create;
    const response = await provider.chat([{ role: 'tool', content: 'missing id' }]);
    expect(response).toMatchObject({ success: false, error: 'Tool result is missing tool_call_id' });
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps 50 tool-only calls/results together without reordering or mutating input', async () => {
    const provider = providerFor();
    const create = jest.fn().mockResolvedValue(final());
    (provider as any).client.messages.create = create;
    const calls = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`, type: 'function' as const,
      function: { name: `read_${i}`, arguments: JSON.stringify({ id: i }) },
    }));
    const messages: import('../interfaces/ai-provider.interface').AIMessage[] = [
      { role: 'user', content: 'Lee' },
      { role: 'assistant', content: '', tool_calls: calls },
      ...calls.map((c) => ({ role: 'tool' as const, tool_call_id: c.id, content: c.id })),
    ];
    const before = JSON.stringify(messages);
    await provider.chat(messages);
    const payload = create.mock.calls[0][0];
    expect(payload.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(payload.messages[2].content.map((c: any) => c.tool_use_id)).toEqual(calls.map((c) => c.id));
    expect(payload.messages[1].content).toHaveLength(50);
    expect(JSON.stringify(messages)).toBe(before);
  });
});
