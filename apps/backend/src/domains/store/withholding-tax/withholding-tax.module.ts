import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { WithholdingTaxController } from './withholding-tax.controller';
import { WithholdingTaxService } from './withholding-tax.service';
import { WithholdingCalculatorService } from './withholding-calculator.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [WithholdingTaxController],
  providers: [WithholdingTaxService, WithholdingCalculatorService],
  exports: [WithholdingTaxService, WithholdingCalculatorService],
})
export class WithholdingTaxModule {}
