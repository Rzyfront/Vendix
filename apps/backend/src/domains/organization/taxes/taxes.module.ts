import { Module } from '@nestjs/common';
import { OrgTaxesService } from './taxes.service';
import { OrgTaxesController } from './taxes.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { DefaultTaxesSeederService } from '@common/services/default-taxes-seeder.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [OrgTaxesController],
  providers: [OrgTaxesService, DefaultTaxesSeederService],
  exports: [OrgTaxesService, DefaultTaxesSeederService],
})
export class OrgTaxesModule {}
