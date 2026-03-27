import { Global, Module, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIEngineService } from './ai-engine.service';
import { AILoggingService } from './ai-logging.service';
import { AIQueueModule } from './queue/ai-queue.module';
import { AIStreamController } from './ai-stream.controller';
import { AIAgentService } from './ai-agent.service';
import { AIToolRegistry } from './tools/ai-tool-registry';
import { salesTools } from './tools/domains/sales.tools';
import { inventoryTools } from './tools/domains/inventory.tools';
import { accountingTools } from './tools/domains/accounting.tools';
import { customerTools } from './tools/domains/customers.tools';
import { searchTools } from './tools/domains/search.tools';
import { EmbeddingModule } from './embeddings/embedding.module';

@Global()
@Module({
  imports: [PrismaModule, AIQueueModule, EmbeddingModule],
  controllers: [AIStreamController],
  providers: [AIEngineService, AILoggingService, AIAgentService, AIToolRegistry],
  exports: [AIEngineService, AILoggingService, AIAgentService, AIToolRegistry, AIQueueModule, EmbeddingModule],
})
export class AIEngineModule implements OnModuleInit {
  constructor(private readonly toolRegistry: AIToolRegistry) {}

  onModuleInit() {
    const allTools = [
      ...salesTools,
      ...inventoryTools,
      ...accountingTools,
      ...customerTools,
      ...searchTools,
    ];
    for (const tool of allTools) {
      this.toolRegistry.register(tool);
    }
  }
}
