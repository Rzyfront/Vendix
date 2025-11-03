import { Module } from '@nestjs/common';
import { AdminDomainsController } from './admin-domains.controller';
import { AdminDomainsService } from './admin-domains.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseModule } from '../../common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AdminDomainsController],
  providers: [AdminDomainsService],
  exports: [AdminDomainsService],
})
export class AdminDomainsModule {}
