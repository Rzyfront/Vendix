import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { HousekeepingController } from './housekeeping.controller';
import { HousekeepingService } from './housekeeping.service';
import { HousekeepingTasksService } from './housekeeping-tasks.service';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService, HousekeepingTasksService],
})
export class HousekeepingModule {}
