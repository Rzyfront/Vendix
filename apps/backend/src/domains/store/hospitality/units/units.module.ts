import { Module } from '@nestjs/common';
import { LodgingIndustryGuard } from '@common/guards/lodging-industry.guard';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [UnitsController],
  providers: [UnitsService, LodgingIndustryGuard],
  exports: [UnitsService],
})
export class UnitsModule {}
