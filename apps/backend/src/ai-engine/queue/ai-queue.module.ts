import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AIQueueService } from './ai-queue.service';
import { AIGenerationProcessor } from './processors/ai-generation.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'ai-generation' },
      { name: 'ai-embedding' },
      { name: 'ai-agent' },
    ),
  ],
  providers: [AIQueueService, AIGenerationProcessor],
  exports: [AIQueueService, BullModule],
})
export class AIQueueModule {}
