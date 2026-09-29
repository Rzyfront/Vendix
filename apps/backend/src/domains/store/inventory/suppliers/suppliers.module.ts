import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { createSupplierTools } from '../../../../ai-engine/tools/domains/suppliers.tools';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly suppliersService: SuppliersService,
  ) {}

  /**
   * O-38/O-41: proveedores read-first. Registro descentralizado en el módulo
   * dueño, no en `AIEngineModule` (ciclo DI). `AIToolRegistry` viene del
   * módulo global, así que no cuesta ningún import.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createSupplierTools({ suppliersService: this.suppliersService }),
    );
  }
}
