import { Module, OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createBrandTools } from '../../../ai-engine/tools/domains/catalog-taxonomy.tools';

@Module({
  imports: [ResponseModule, PrismaModule, MulterModule.register()],
  controllers: [BrandsController],
  providers: [BrandsService, PermissionsGuard],
  exports: [BrandsService],
})
export class BrandsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly brandsService: BrandsService,
  ) {}

  /** Tools de marcas para el agente. `AIToolRegistry` es global: sin imports extra ni ciclos. */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createBrandTools({ brandsService: this.brandsService }),
    );
  }
}
