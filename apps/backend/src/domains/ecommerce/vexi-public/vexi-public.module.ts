import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createStorefrontTools } from '../../../ai-engine/tools/domains/storefront.tools';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogService } from '../catalog/catalog.service';
import { VexiPublicController } from './vexi-public.controller';
import { VexiPublicService } from './vexi-public.service';

/**
 * Vexi público F2. Registers the `storefront` tools (public catalog reads and
 * proposal cards) here, next to the catalog they read, the same way the
 * checkout module registers its own tools. `AIEngineModule`, Prisma, Redis and
 * subscriptions are global.
 */
@Module({
  imports: [CatalogModule],
  controllers: [VexiPublicController],
  providers: [VexiPublicService],
})
export class VexiPublicModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly catalog: CatalogService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createStorefrontTools({ catalog: this.catalog }),
    );
  }
}
