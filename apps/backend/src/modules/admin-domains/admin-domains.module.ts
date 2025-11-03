import { Module } from '@nestjs/common';
import { AdminDomainsController } from './admin-domains.controller';
import { AdminDomainsService } from './admin-domains.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ResponseService } from '../../common/responses/response.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdminDomainsController],
  providers: [AdminDomainsService, ResponseService],
  exports: [AdminDomainsService],
})
export class AdminDomainsModule {}
