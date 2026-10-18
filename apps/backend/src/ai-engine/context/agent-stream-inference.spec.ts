import { streamAgentInference } from './agent-stream-inference';
import type {
  AIResponse,
  AIStreamChunk,
} from '../interfaces/ai-provider.interface';

describe('H inference transport and semantic fence', () => {
  const direct = (consume: () => Promise<AIResponse>) => consume();

  it('consumes tokens before provider done without painting unverified effect claims', async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const iterator = streamAgentInference(
      async function* () {
        yield { type: 'text', content: 'Ya cambié el precio' };
        await hold;
        yield {
          type: 'done',
          content: 'Ya cambié el precio',
          tool_calls: [
            {
              id: 'x',
              type: 'function',
              function: { name: 'update_price', arguments: '{"quantity":4}' },
            },
          ],
        };
      },
      direct,
      jest.fn(),
    );
    const first = await iterator.next();
    expect(first).toMatchObject({ done: false, value: { type: 'progress' } });
    expect(first.value).not.toHaveProperty('tool_calls');
    expect(JSON.stringify(first.value)).not.toContain('Ya cambié');
    release();
    const end = await iterator.next();
    expect(end.done).toBe(true);
    expect(end.value).toMatchObject({
      success: true,
      tool_calls: [{ id: 'x' }],
    });
  });
  it('wraps exactly one durable provider intent and does not leak partial JSON as a call', async () => {
    const run = jest.fn(direct);
    const iterator = streamAgentInference(
      async function* () {
        yield { type: 'text', content: '{"quantity":' };
        yield {
          type: 'error',
          error: 'Corte',
          error_code: 'AI_STREAM_INCOMPLETE',
        };
      },
      run,
      jest.fn(),
    );
    const frames: AIStreamChunk[] = [];
    let item = await iterator.next();
    while (!item.done) {
      frames.push(item.value);
      item = await iterator.next();
    }
    expect(item.value).toMatchObject({
      success: false,
      error_code: 'AI_STREAM_INCOMPLETE',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(frames.every((frame) => frame.type === 'progress')).toBe(true);
  });
  it('fails closed without final usage/tool boundary and preserves final cache usage', async () => {
    const missing = streamAgentInference(
      async function* () {
        yield { type: 'text', content: 'x' };
      },
      direct,
      jest.fn(),
    );
    await missing.next();
    expect((await missing.next()).value).toMatchObject({
      success: false,
      error_code: 'AI_STREAM_INCOMPLETE',
    });
    const usage = {
      promptTokens: 1,
      completionTokens: 2,
      totalTokens: 8,
      cacheReadTokens: 5,
    };
    const complete = streamAgentInference(
      async function* () {
        yield { type: 'done', usage, content: 'listo' };
      },
      direct,
      jest.fn(),
    );
    expect((await complete.next()).value).toMatchObject({
      success: true,
      usage,
    });
  });
  it('cancelled consumer aborts producer cooperatively and closes engine finally', async () => {
    const abort = new AbortController();
    let closed = false;
    const iterator = streamAgentInference(
      async function* () {
        try {
          yield { type: 'text', content: 'no confiable' };
          await new Promise<void>((resolve) =>
            abort.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
        } finally {
          closed = true;
        }
      },
      direct,
      () => abort.abort(),
    );
    await iterator.next();
    await iterator.return(undefined as never);
    await new Promise((resolve) => setImmediate(resolve));
    expect(abort.signal.aborted).toBe(true);
    expect(closed).toBe(true);
  });
});
