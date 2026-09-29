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
import { ExogenousModule } from '../exogenous/exogenous.module';
import { ExogenousService } from '../exogenous/exogenous.service';
import { TaxesModule } from '../taxes/taxes.module';
import { TaxesService } from '../taxes/taxes.service';

@Module({
  // ExogenousModule y TaxesModule solo importan Prisma/Response(/S3): ninguno
  // importa withholding-tax, así que no hay ciclo (verificado paso 11).
  imports: [PrismaModule, ResponseModule, ExogenousModule, TaxesModule],
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
    private readonly exogenousService: ExogenousService,
    private readonly taxesService: TaxesService,
  ) {}

  /**
   * Registra la familia withholding (F-39..F-49: retenciones, exógena,
   * categorías) para el agente. Vive aquí y no en `AIEngineModule` porque
   * ese módulo es `@Global()`: importar un dominio por familia genera ciclos
   * de dependencia. `AIToolRegistry` se exporta global, así que la
   * dependencia apunta del dominio al motor.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createWithholdingTools({
        withholdingTaxService: this.withholdingTaxService,
        withholdingFlowService: this.withholdingFlowService,
        exogenousService: this.exogenousService,
        taxesService: this.taxesService,
      }),
    );
  }
}
