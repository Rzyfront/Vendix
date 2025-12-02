import { Module } from '@nestjs/common';
import { AdminDomainsController } from './domains.controller';
import { DomainsService } from './domains.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AdminDomainsController],
  providers: [DomainsService],
  exports: [DomainsService],
})
export class DomainsModule {}
