import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createRecipeTools } from '../../../ai-engine/tools/domains/menus.tools';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

/**
 * Store-scoped Recipes / BOM module (Restaurant Suite — Phase B).
 *
 * Registers the recipes controller, the recipes service (CRUD + cycle
 * detection + BOM explosion), and the shared prisma + response helpers.
 * The service is exported so future phases (D, F) can inject it without
 * duplicating the provider.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [RecipesController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly recipesService: RecipesService,
  ) {}

  /**
   * K-12: registro descentralizado en el módulo dueño, no en
   * `AIEngineModule` (ciclo DI). `AIToolRegistry` viene del módulo global.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createRecipeTools({ recipesService: this.recipesService }),
    );
  }
}
