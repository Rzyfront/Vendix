import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { FiscalOperationsModule } from '../../fiscal-operations/fiscal-operations.module';
import { PlatformOrgService } from '../../../common/services/platform-org.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

import { SuperadminFiscalOperationsController } from './superadmin-fiscal-operations.controller';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, FiscalOperationsModule],
  controllers: [SuperadminFiscalOperationsController],
  providers: [PlatformOrgService, GlobalPrismaService],
})
export class SuperadminFiscalOperationsModule {}
