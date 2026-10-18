import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { RequestContextService } from '../../common/context/request-context.service';
import { ProceduralMemoryService } from './procedural-memory.service';
import { RecipeRepository } from './recipe.repository';
import { RecipeMiningJob } from './recipe.interface';
import { ToolCatalogIndexerService } from '../tools/tool-catalog-indexer.service';

@Processor('ai-recipe-miner', { concurrency: 1 })
export class RecipeMinerProcessor extends WorkerHost {
  constructor(
    private readonly memory: ProceduralMemoryService,
    private readonly recipes: RecipeRepository,
    private readonly indexer: ToolCatalogIndexerService,
  ) {
    super();
  }
  async process(
    job: Job<
      | RecipeMiningJob
      | {
          id: number;
          hash: string;
          store_id?: number;
          organization_id?: number;
          user_id?: number;
        }
    >,
  ): Promise<{ candidate_ids?: number[]; indexed?: boolean }> {
    const data = job.data;
    if (
      job.name === 'index-recipe' &&
      'id' in data &&
      data.store_id == null &&
      data.organization_id == null &&
      data.user_id == null
    ) {
      const recipe = await this.recipes.approvedGlobal(data.id);
      if (!recipe || recipe.content_hash !== data.hash)
        return { indexed: false };
      // Platform global API filters approved/global only. No forged tenant=0 or superadmin context.
      return RequestContextService.runIsolated(
        { is_owner: false, is_super_admin: false },
        async () => ({ indexed: await this.indexer.indexRecipe(recipe) }),
      );
    }
    if (
      ![data.store_id, data.organization_id, data.user_id].every(
        (n) => Number.isSafeInteger(n) && Number(n) > 0,
      )
    )
      throw new Error('RECIPE_JOB_SCOPE');
    return RequestContextService.runIsolated(
      {
        store_id: data.store_id,
        organization_id: data.organization_id,
        user_id: data.user_id,
        is_owner: false,
        is_super_admin: false,
        permissions: [],
      },
      async () => {
        if (job.name === 'mine-recipe' && 'objective_id' in data)
          return {
            candidate_ids: await this.memory.capture(data.objective_id),
          };
        if (job.name === 'index-recipe' && 'id' in data) {
          const recipe = await this.recipes.privateGet(data.id);
          if (recipe.content_hash !== data.hash) return { indexed: false };
          const current = await this.recipes.currentOwnerPermissions(
            recipe.template.required_permissions,
          );
          if (
            !recipe.template.required_permissions.every((permission) =>
              current.permissions.includes(permission),
            )
          )
            return { indexed: false };
          return { indexed: await this.indexer.indexRecipe(recipe) };
        }
        throw new Error('RECIPE_JOB_INVALID');
      },
    );
  }
}
