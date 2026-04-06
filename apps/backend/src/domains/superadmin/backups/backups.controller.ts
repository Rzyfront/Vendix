import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { ResponseService } from '../../../common/responses/response.service';
import { RdsBackupService } from './services/rds-backup.service';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';

@ApiTags('Backups')
@Controller('superadmin/backups')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class BackupController {
  constructor(
    private readonly rdsBackupService: RdsBackupService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('snapshots')
  @ApiOperation({ summary: 'List all RDS snapshots (automated + manual)' })
  @ApiResponse({ status: 200, description: 'Snapshots retrieved successfully' })
  async listSnapshots() {
    const data = await this.rdsBackupService.listSnapshots();
    return this.responseService.success(data, 'Snapshots retrieved');
  }

  @Get('status')
  @ApiOperation({
    summary: 'Get overall backup status (last backup, PITR, retention)',
  })
  @ApiResponse({ status: 200, description: 'Backup status retrieved successfully' })
  async getStatus() {
    const data = await this.rdsBackupService.getStatus();
    return this.responseService.success(data, 'Backup status retrieved');
  }

  @Post('snapshots')
  @ApiOperation({ summary: 'Create a manual RDS snapshot' })
  @ApiResponse({ status: 201, description: 'Snapshot creation initiated' })
  async createSnapshot(@Body() dto: CreateSnapshotDto) {
    const data = await this.rdsBackupService.createSnapshot(dto.name);
    return this.responseService.success(data, 'Snapshot creation initiated');
  }

  @Delete('snapshots/:id')
  @ApiOperation({ summary: 'Delete a manual RDS snapshot' })
  @ApiResponse({ status: 200, description: 'Snapshot deleted successfully' })
  async deleteSnapshot(@Param('id') id: string) {
    await this.rdsBackupService.deleteSnapshot(id);
    return this.responseService.success(null, 'Snapshot deleted successfully');
  }
}
