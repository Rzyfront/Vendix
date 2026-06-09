import { Module } from '@nestjs/common';
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
export class WithholdingTaxModule {}
