import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIEngineModule } from '../../../ai-engine/ai-engine.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { VexiRealtimeController } from './vexi-realtime.controller';
import { VexiRealtimeService } from './vexi-realtime.service';

/**
 * Vexi realtime voice. Text chat still lives in `AIChatModule` under
 * `store/ai-chat` — that contract is unchanged; Vexi is the product name for
 * the assistant, not a rename of the persistence layer.
 */
@Module({
  imports: [PrismaModule, ResponseModule, AIEngineModule, SubscriptionsModule],
  controllers: [VexiRealtimeController],
  providers: [VexiRealtimeService],
  exports: [VexiRealtimeService],
})
export class VexiModule {}
