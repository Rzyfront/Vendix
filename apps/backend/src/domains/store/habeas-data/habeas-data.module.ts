import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { S3Module } from '@common/services/s3.module';
import { EmailModule } from '../../../email/email.module';
import { HabeasDataController } from './habeas-data.controller';
import { HabeasDataService } from './habeas-data.service';
import { HabeasDataEventsListener } from './habeas-data-events.listener';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, EmailModule],
  controllers: [HabeasDataController],
  providers: [HabeasDataService, HabeasDataEventsListener],
  exports: [HabeasDataService],
})
export class HabeasDataModule {}
