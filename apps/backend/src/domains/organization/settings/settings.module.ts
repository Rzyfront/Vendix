import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { ResponseModule } from '@common/responses/response.module';
import { AuditModule } from '@common/audit/audit.module';

@Module({
  imports: [ResponseModule, AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService, OrganizationPrismaService],
  exports: [SettingsService],
})
export class SettingsModule {}
