import { Module } from '@nestjs/common';
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
export class RecipesModule {}
