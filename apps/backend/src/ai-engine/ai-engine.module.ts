import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AIEngineService } from './ai-engine.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [AIEngineService],
  exports: [AIEngineService],
})
export class AIEngineModule {}
