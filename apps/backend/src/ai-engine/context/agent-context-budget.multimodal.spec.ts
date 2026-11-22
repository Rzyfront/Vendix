import {
  AGENT_IMAGE_PART_TOKENS,
  applyAgentContextBudget,
  estimateAgentInputTokens,
} from './agent-context-budget';
import type { AIMessage } from '../interfaces/ai-provider.interface';

const image = (url: string) => ({
  type: 'image_url' as const,
  image_url: { url },
});

describe('agent context budget - images', () => {
  const textOnly: AIMessage = {
    role: 'user',
    content: [{ type: 'text', text: 'Describe la vitrina' }],
  };

  it('charges text + 2 x the fixed image cost', () => {
    const withImages: AIMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'Describe la vitrina' },
        image('https://s3.example/a.jpg?sig=1'),
        image('data:image/png;base64,' + 'A'.repeat(50_000)),
      ],
    };
    expect(estimateAgentInputTokens([withImages], [])).toBe(
      estimateAgentInputTokens([textOnly], []) + 2 * AGENT_IMAGE_PART_TOKENS,
    );
  });

  it('keeps the previous cost for text-only messages', () => {
    const msg: AIMessage = { role: 'user', content: 'hola' };
    const expected =
      32 +
      24 +
      Buffer.byteLength(JSON.stringify({ role: 'user', content: 'hola' }));
    expect(estimateAgentInputTokens([msg], [])).toBe(expected);
  });

  it('never rejects a turn for carrying images', () => {
    const msg: AIMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'x' }, image('https://s3.example/a')],
    };
    const result = applyAgentContextBudget([msg], [], {
      contextWindowTokens: 32768,
      maxOutputTokens: 1024,
    });
    expect(result.messages).toHaveLength(1);
    expect(result.estimatedInputTokens).toBeGreaterThanOrEqual(
      AGENT_IMAGE_PART_TOKENS,
    );
  });

  it('still rejects audio parts', () => {
    const msg: AIMessage = {
      role: 'user',
      content: [{ type: 'input_audio', input_audio: { data: 'x', format: 'wav' } }],
    };
    expect(() => estimateAgentInputTokens([msg], [])).toThrow(
      'AI_AGENT_CONTEXT_UNCOUNTED_MULTIMODAL',
    );
  });
});
