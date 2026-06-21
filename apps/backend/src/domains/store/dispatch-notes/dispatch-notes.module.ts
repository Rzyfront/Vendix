import { Module } from '@nestjs/common';
import { DispatchNotesService } from './dispatch-notes.service';
import { DispatchNotesController } from './dispatch-notes.controller';
import { DispatchNoteFlowService } from './dispatch-note-flow/dispatch-note-flow.service';
import { DispatchNotePdfService } from './pdf/dispatch-note-pdf.service';
import { DispatchNumberGenerator } from './utils/dispatch-number-generator';
import { RouteNumberGenerator } from '../dispatch-routes/utils/route-number-generator';
import { DispatchNoteEventsListener } from './listeners/dispatch-note-events.listener';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { S3Module } from '../../../common/services/s3.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [ResponseModule, PrismaModule, S3Module, InventoryModule],
  controllers: [DispatchNotesController],
  providers: [
    DispatchNotesService,
    DispatchNoteFlowService,
    DispatchNotePdfService,
    DispatchNumberGenerator,
    RouteNumberGenerator,
    DispatchNoteEventsListener,
  ],
  exports: [DispatchNotesService],
})
export class DispatchNotesModule {}
