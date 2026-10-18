import { RecipeMinerProcessor } from './recipe-miner.processor';
import {
  context,
  objectiveId,
  fixture,
} from '../../../test/agentic/f-recipe.fixtures';
import { RequestContextService } from '../../common/context/request-context.service';
import { AIQueueService } from '../queue/ai-queue.service';

describe('F miner queue boundary', () => {
  it('queue serializes identity only, never source/goal/args/bearer; retry/job IDs are stable', async () => {
    const queue = { add: jest.fn() };
    const service = new AIQueueService(
      {} as never,
      {} as never,
      {} as never,
      queue as never,
    );
    const params = {
      objective_id: objectiveId,
      ...context,
      goal: 'PRIVATE',
      access_token: 'SECRET',
    };
    await service.enqueueRecipeMining(params);
    await service.enqueueRecipeMining(params);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('mine-recipe');
    expect(Object.keys(data).sort()).toEqual([
      'objective_id',
      'organization_id',
      'store_id',
      'user_id',
    ]);
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE|SECRET/);
    expect(opts.attempts).toBe(2);
    expect(queue.add.mock.calls[1][2].jobId).toBe(opts.jobId);
  });
  it('restores exact owner in isolated ALS without bearer or inherited permissions; ignores raw job text', async () => {
    const memory = {
      capture: jest.fn(async () => {
        const c = RequestContextService.asyncLocalStorage.getStore();
        expect(c?.user_id).toBe(11);
        expect(c?.access_token).toBeUndefined();
        expect(c?.permissions).toEqual([]);
        return [41];
      }),
    };
    const miner = new RecipeMinerProcessor(
      memory as never,
      {} as never,
      {} as never,
    );
    const result = await miner.process({
      name: 'mine-recipe',
      data: {
        ...context,
        objective_id: objectiveId,
        access_token: 'UNTRUSTED',
      },
    } as never);
    expect(result).toEqual({ candidate_ids: [41] });
    expect(RequestContextService.asyncLocalStorage.getStore()).toBeUndefined();
  });
  it.each([
    { user_id: 12, store_id: undefined },
    { store_id: 0 },
    { organization_id: -1 },
  ])('rejects invalid/absent scope %j before any read', async (change) => {
    const memory = { capture: jest.fn() };
    const miner = new RecipeMinerProcessor(
      memory as never,
      {} as never,
      {} as never,
    );
    await expect(
      miner.process({
        name: 'mine-recipe',
        data: { ...context, ...change, objective_id: objectiveId },
      } as never),
    ).rejects.toThrow('RECIPE_JOB_SCOPE');
    expect(memory.capture).not.toHaveBeenCalled();
  });
  it('global indexing reconstructs only approved row from system repo, never grants platform identity', async () => {
    const { recipe } = fixture();
    recipe.knowledge_scope = 'global';
    const indexer = {
      indexRecipe: jest.fn(async () => {
        expect(
          RequestContextService.asyncLocalStorage.getStore()?.is_super_admin,
        ).toBe(false);
        return true;
      }),
    };
    const repo = { approvedGlobal: jest.fn().mockResolvedValue(recipe) };
    const miner = new RecipeMinerProcessor(
      {} as never,
      repo as never,
      indexer as never,
    );
    expect(
      await miner.process({
        name: 'index-recipe',
        data: { id: 41, hash: recipe.content_hash },
      } as never),
    ).toEqual({ indexed: true });
    repo.approvedGlobal.mockResolvedValue(null);
    expect(
      await miner.process({
        name: 'index-recipe',
        data: { id: 41, hash: recipe.content_hash },
      } as never),
    ).toEqual({ indexed: false });
  });
});
