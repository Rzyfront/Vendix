import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { AIChatController } from './ai-chat.controller';
import { AIChatService } from './ai-chat.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AIChatController],
  providers: [AIChatService],
  exports: [AIChatService],
})
export class AIChatModule {}
