import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createWithholdingTools } from '../../../ai-engine/tools/domains/withholding.tools';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { WithholdingTaxController } from './withholding-tax.controller';
import { WithholdingTaxService } from './withholding-tax.service';
import { WithholdingCalculatorService } from './withholding-calculator.service';
import { WithholdingResolverService } from './withholding-resolver.service';
import { WithholdingFlowService } from './withholding-flow.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [WithholdingTaxController],
  providers: [
    WithholdingTaxService,
    WithholdingCalculatorService,
    WithholdingResolverService,
    WithholdingFlowService,
  ],
  exports: [
    WithholdingTaxService,
    WithholdingCalculatorService,
    WithholdingResolverService,
    WithholdingFlowService,
  ],
})
export class WithholdingTaxModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly withholdingTaxService: WithholdingTaxService,
    private readonly withholdingFlowService: WithholdingFlowService,
  ) {}

  /**
   * Registra la familia withholding (F-39, F-41) para el agente. Vive aquí y
   * no en `AIEngineModule` porque ese módulo es `@Global()`: importar un
   * dominio por familia genera ciclos de dependencia. `AIToolRegistry` se
   * exporta global, así que la dependencia apunta del dominio al motor y
   * este módulo no importa nada extra.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createWithholdingTools({
        withholdingTaxService: this.withholdingTaxService,
        withholdingFlowService: this.withholdingFlowService,
      }),
    );
  }
}
