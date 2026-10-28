import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { LodgingIcalExportController } from './ical/ical-export.controller';
import { PublicLodgingIcalController } from './ical/public-ical.controller';
import { LodgingIcalExportService } from './ical/ical-export.service';
import { LodgingIcalImportController } from './ical/ical-import.controller';
import { LodgingIcalImportService } from './ical/ical-import.service';
import { LodgingIcalImportJob } from './ical/ical-import.job';

/** Hospitality Suite (H6.1–H6.2) — sales channels of the hotel (iCal export and import). */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [
    LodgingIcalExportController,
    LodgingIcalImportController,
    PublicLodgingIcalController,
  ],
  providers: [LodgingIcalExportService, LodgingIcalImportService, LodgingIcalImportJob],
})
export class LodgingChannelsModule {}
