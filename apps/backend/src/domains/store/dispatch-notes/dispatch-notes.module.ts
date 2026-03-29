import { Module } from '@nestjs/common';
import { DispatchNotesService } from './dispatch-notes.service';
import { DispatchNotesController } from './dispatch-notes.controller';
import { DispatchNoteFlowService } from './dispatch-note-flow/dispatch-note-flow.service';
import { DispatchNumberGenerator } from './utils/dispatch-number-generator';
import { DispatchNoteEventsListener } from './listeners/dispatch-note-events.listener';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [ResponseModule, PrismaModule, InventoryModule],
  controllers: [DispatchNotesController],
  providers: [
    DispatchNotesService,
    DispatchNoteFlowService,
    DispatchNumberGenerator,
    DispatchNoteEventsListener,
  ],
  exports: [DispatchNotesService],
})
export class DispatchNotesModule {}
