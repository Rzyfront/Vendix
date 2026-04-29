import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { BlocklistService } from './blocklist.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [BlocklistService],
  exports: [BlocklistService],
})
export class BlocklistModule {}
