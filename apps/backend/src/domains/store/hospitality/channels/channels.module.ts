import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingIcalExportController } from './ical/ical-export.controller';
import { PublicLodgingIcalController } from './ical/public-ical.controller';
import { LodgingIcalExportService } from './ical/ical-export.service';

/** Hospitality Suite (H6.1) — sales channels of the hotel (iCal export). */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [LodgingIcalExportController, PublicLodgingIcalController],
  providers: [LodgingIcalExportService],
})
export class LodgingChannelsModule {}
