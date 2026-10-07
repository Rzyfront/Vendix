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
