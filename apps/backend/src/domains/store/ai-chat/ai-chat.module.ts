import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { VexiModule } from '../vexi/vexi.module';
import { VexModule } from '../vex/vex.module';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';

// One-way dependency: chat consumes Vexi's business snapshot, Vexi never
// consumes chat. Keep it that way — VexiModule importing this back would
// close a cycle through the @Global() AIEngineModule. Same for `VexModule`
// (block selections as turn context): Vex must never import this back.
@Module({
  imports: [PrismaModule, ResponseModule, VexiModule, VexModule],
  controllers: [AIChatController],
  providers: [AIChatService],
  exports: [AIChatService],
})
export class AIChatModule {}
