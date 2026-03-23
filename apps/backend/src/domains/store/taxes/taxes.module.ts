import { Module } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';
import { IcaService } from './ica.service';
import { IcaController } from './ica.controller';
import { ResponseModule } from '@common/responses/response.module';
import { AccessValidationService } from '@common/services/access-validation.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [TaxesController, IcaController],
  providers: [TaxesService, IcaService, AccessValidationService],
  exports: [TaxesService, IcaService],
})
export class TaxesModule {}
