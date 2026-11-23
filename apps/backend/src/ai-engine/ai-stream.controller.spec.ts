import { firstValueFrom, toArray } from 'rxjs';
import { AIStreamController } from './ai-stream.controller';

/**
 * P2-6 (release 1122): «el cliente no debe ver costos». The generic
 * `store/ai/stream/:appKey` SSE forwards engine frames to the store browser;
 * the engine keeps `cost_usd` on `done` for internal callers, so the
 * controller must drop it at the boundary.
 */
function controllerFor(executionType: string, chunks: any[]) {
  async function* gen() {
    for (const chunk of chunks) yield chunk;
  }
  const aiEngine: any = {
    getApplicationExecutionType: jest.fn().mockResolvedValue(executionType),
    runStream: jest.fn(() => gen()),
    runImageStream: jest.fn(() => gen()),
  };
  return { controller: new AIStreamController(aiEngine), aiEngine };
}

async function frames(controller: AIStreamController) {
  const events = await firstValueFrom(
    controller.streamRun('app_x', { token: 't' }).pipe(toArray()),
  );
  return events.map((event) => JSON.parse(event.data as string));
}

describe('AIStreamController (P2-6): no cost reaches the store', () => {
  it('text stream: done keeps usage and model but never cost_usd', async () => {
    const { controller, aiEngine } = controllerFor('text', [
      { type: 'text', content: 'hola' },
      {
        type: 'done',
        model: 'm',
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
        cost_usd: 0.0042,
      },
    ]);
    const out = await frames(controller);
    expect(aiEngine.runStream).toHaveBeenCalledWith('app_x', undefined);
    expect(out).toEqual([
      { type: 'text', content: 'hola' },
      {
        type: 'done',
        model: 'm',
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      },
    ]);
  });

  it('image stream: provider usage.cost is dropped from completed and done', async () => {
    const usage = {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      cost: 0.08,
    };
    const { controller } = controllerFor('image', [
      { type: 'completed', imageBase64: 'AAA', usage, model: 'img' },
      { type: 'done', usage, model: 'img' },
    ]);
    const out = await frames(controller);
    expect(out).toHaveLength(2);
    for (const frame of out) {
      expect(JSON.stringify(frame)).not.toMatch(/cost/);
      expect(frame.usage.totalTokens).toBe(2);
    }
  });
});
