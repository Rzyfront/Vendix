import { AIAgentProcessor } from './ai-agent.processor';

describe('D0 worker result propagation', () => {
  it('propagates semantic execution instead of treating BullMQ completion as verified business completion', async () => {
    const execution = {
      schema_version: '1',
      outcome: 'unknown_effect',
      next_action: 'Verifica el registro.',
      evidence_refs: [],
      resource_ids: {},
    };
    const result = {
      success: true,
      content: 'Sin efecto confirmado.',
      tools_used: [],
      execution,
    };
    const runAgent = jest.fn().mockResolvedValue(result);
    const emit = jest.fn();
    const processor = new AIAgentProcessor(
      { runAgent } as any,
      { emit } as any,
    );
    await expect(
      processor.process({
        id: 'qa',
        data: {
          goal: 'consulta',
          task_id: 1,
          store_id: 1,
          organization_id: 1,
          user_id: 9,
          permissions: [],
          roles: [],
        },
      } as any),
    ).resolves.toBe(result);
    expect(emit).toHaveBeenCalledWith(
      'vexi.task.finished',
      expect.objectContaining({ success: true, execution }),
    );
  });
});
