import { Module } from '@nestjs/common';
import { SettingsSyncController } from './settings-sync.controller';
import { SettingsSyncService } from './settings-sync.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { SettingsModule } from '../../store/settings/settings.module';

@Module({
  imports: [PrismaModule, ResponseModule, SettingsModule],
  controllers: [SettingsSyncController],
  providers: [SettingsSyncService],
  exports: [SettingsSyncService],
})
export class SuperadminSettingsSyncModule {}
