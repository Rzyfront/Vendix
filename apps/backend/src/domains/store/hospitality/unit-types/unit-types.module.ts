import { Module } from '@nestjs/common';
import { LodgingIndustryGuard } from '@common/guards/lodging-industry.guard';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ProductsModule } from '../../products/products.module';
import { UnitTypesController } from './unit-types.controller';
import { UnitTypesService } from './unit-types.service';

@Module({
  imports: [ResponseModule, PrismaModule, ProductsModule],
  controllers: [UnitTypesController],
  providers: [UnitTypesService, LodgingIndustryGuard],
  exports: [UnitTypesService],
})
export class UnitTypesModule {}
