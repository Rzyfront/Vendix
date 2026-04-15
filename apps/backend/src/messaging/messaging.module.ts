import { Module, Global } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
