import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { S3Module } from '../../../common/services/s3.module';
import { FiscalOperationsModule } from '../../fiscal-operations/fiscal-operations.module';
import { PlatformOrgService } from '../../../common/services/platform-org.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

import { SuperadminFiscalOperationsController } from './superadmin-fiscal-operations.controller';
import { RutScannerService } from '../../store/settings/rut-scanner.service';

@Module({
  imports: [PrismaModule, ResponseModule, S3Module, FiscalOperationsModule],
  controllers: [SuperadminFiscalOperationsController],
  // RutScannerService only needs AIEngineService, which comes from the @Global()
  // AI module — providing it here avoids importing the whole store settings
  // module (and its cash-registers/email dependencies) for one endpoint.
  providers: [PlatformOrgService, GlobalPrismaService, RutScannerService],
})
export class SuperadminFiscalOperationsModule {}
