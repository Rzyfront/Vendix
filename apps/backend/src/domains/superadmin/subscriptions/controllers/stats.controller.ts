import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { SubscriptionsStatsService } from '../services/stats.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Stats')
@Controller('superadmin/subscriptions/stats')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SubscriptionsStatsController {
  constructor(
    private readonly statsService: SubscriptionsStatsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:read')
  @Get()
  @ApiOperation({ summary: 'Get global subscription stats for dashboard' })
  async getStats() {
    const result = await this.statsService.getGlobalStats();
    return this.responseService.success(result, 'Subscription stats retrieved');
  }
}
