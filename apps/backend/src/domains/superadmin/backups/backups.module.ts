import { Module } from '@nestjs/common';
import { BackupController } from './backups.controller';
import { RdsBackupService } from './services/rds-backup.service';
import { ResponseService } from '../../../common/responses/response.service';

@Module({
  controllers: [BackupController],
  providers: [RdsBackupService, ResponseService],
})
export class BackupModule {}
