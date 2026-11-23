import { Module, OnModuleInit } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createMemoryTools } from '../../../ai-engine/tools/domains/memory.tools';
import { AgentMemoryService } from '../../../ai-engine/memory/agent-memory.service';
import { AiAgentMemoryController } from './ai-agent-memory.controller';

/**
 * F4 T31 — Vex store memory: REST for Ajustes, the `remember`/`forget` tools
 * and `AgentMemoryService` (exported for the Vex snapshot and the purge).
 * The Prisma services and the `AIToolRegistry` come from global modules.
 */
@Module({
  imports: [ResponseModule],
  controllers: [AiAgentMemoryController],
  providers: [AgentMemoryService],
  exports: [AgentMemoryService],
})
export class AiAgentMemoryModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly memoryService: AgentMemoryService,
  ) {}

  /** Decentralized registration in the owning module (vendix-ai-agent-tools). */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createMemoryTools({ memoryService: this.memoryService }),
    );
  }
}
