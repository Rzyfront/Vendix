import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SettingsSyncService } from './settings-sync.service';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@ApiTags('Super Admin - Settings Sync')
@Controller('superadmin/settings')
@UseGuards(PermissionsGuard)
export class SettingsSyncController {
  constructor(
    private readonly settingsSyncService: SettingsSyncService,
    private readonly responseService: ResponseService,
  ) {}

  @Post('sync-all-stores')
  @Permissions('super_admin.settings.sync_all')
  @ApiOperation({
    summary: 'Run schema migrations against all store_settings rows',
    description:
      'Iterates all stores in batches and persists migrated settings JSON when migrations apply. Per-row errors are returned in the response without aborting the job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sync completed (errors accumulated per row, not thrown)',
  })
  async syncAllStores() {
    const result = await this.settingsSyncService.syncAllStores();
    return this.responseService.success(
      result,
      'Store settings sync completed',
    );
  }
}
