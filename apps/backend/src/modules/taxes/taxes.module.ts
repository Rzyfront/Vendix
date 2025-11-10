import { Module } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';
import { AccessValidationService } from '../../common/services/access-validation.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [TaxesController],
  providers: [TaxesService, AccessValidationService],
  exports: [TaxesService],
})
export class TaxesModule {}
