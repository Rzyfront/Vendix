import { Module, OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createCategoryTools } from '../../../ai-engine/tools/domains/catalog-taxonomy.tools';

@Module({
  imports: [ResponseModule, PrismaModule, MulterModule.register()],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly categoriesService: CategoriesService,
  ) {}

  /** Tools de categorías para el agente. `AIToolRegistry` es global: sin imports extra ni ciclos. */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createCategoryTools({ categoriesService: this.categoriesService }),
    );
  }
}
