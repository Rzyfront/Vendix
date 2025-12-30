import { Module } from '@nestjs/common';
import { SuperAdminAuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [AuditController],
  providers: [SuperAdminAuditService],
  exports: [SuperAdminAuditService],
})
export class AuditModule { }
