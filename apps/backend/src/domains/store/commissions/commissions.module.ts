import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { CommissionCalculatorService } from './services/commission-calculator.service';
import { CommissionEventsListener } from './services/commission-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [CommissionsController],
  providers: [
    CommissionsService,
    CommissionCalculatorService,
    CommissionEventsListener,
  ],
  exports: [CommissionsService, CommissionCalculatorService],
})
export class CommissionsModule {}
