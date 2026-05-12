import { Module } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
import { BookingDataCollectionListener } from './listeners/booking-data-collection.listener';
import { BookingSnapshotListener } from './listeners/booking-snapshot.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { MetadataModule } from '../metadata/metadata.module';

@Module({
  imports: [ResponseModule, PrismaModule, MetadataModule],
  controllers: [TemplatesController, SubmissionsController],
  providers: [
    TemplatesService,
    SubmissionsService,
    BookingDataCollectionListener,
    BookingSnapshotListener,
  ],
  exports: [TemplatesService, SubmissionsService],
})
export class DataCollectionModule {}
