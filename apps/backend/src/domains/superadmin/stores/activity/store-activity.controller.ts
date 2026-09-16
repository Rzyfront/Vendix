import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { ResponseService } from '@common/responses/response.service';
import { StoreActivityService } from './store-activity.service';
import { StoreActivityQueryDto } from './dto/store-activity-query.dto';
import { StoreActivityDetailQueryDto } from './dto/store-activity-detail-query.dto';

@ApiTags('Admin Store Activity')
@Controller('superadmin/stores/activity')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class StoreActivityController {
  constructor(
    private readonly storeActivityService: StoreActivityService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:stores:read')
  @Get('ranking')
  @ApiOperation({ summary: 'Rank stores by activity in a UTC window' })
  @ApiResponse({ status: 200, description: 'Ranking retrieved successfully' })
  async getRanking(@Query() query: StoreActivityQueryDto) {
    const result = await this.storeActivityService.getRanking(query);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Store activity ranking retrieved successfully',
    );
  }

  @Permissions('superadmin:stores:read')
  @Get('stats')
  @ApiOperation({ summary: 'Activity stat cards for the selected window' })
  @ApiResponse({ status: 200, description: 'Stats retrieved successfully' })
  async getStats(@Query() query: StoreActivityQueryDto) {
    const stats = await this.storeActivityService.getStats(query);
    return this.responseService.success(
      stats,
      'Store activity stats retrieved successfully',
    );
  }

  @Permissions('superadmin:stores:read')
  @Get(':storeId')
  @ApiOperation({ summary: 'Activity summary and timeline for one store' })
  @ApiResponse({ status: 200, description: 'Store activity retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getDetail(
    @Param('storeId') storeId: string,
    @Query() query: StoreActivityDetailQueryDto,
  ) {
    const result = await this.storeActivityService.getDetail(
      Number(storeId),
      query,
    );
    return this.responseService.success(
      { summary: result.summary, timeline: result.timeline },
      'Store activity detail retrieved successfully',
      { total: result.total, page: result.page, limit: result.limit },
    );
  }

  @Permissions('superadmin:stores:read')
  @Get(':storeId/series')
  @ApiOperation({ summary: 'Daily activity series for one store (UTC buckets)' })
  @ApiResponse({ status: 200, description: 'Store activity series retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getSeries(
    @Param('storeId') storeId: string,
    @Query() query: StoreActivityDetailQueryDto,
  ) {
    const result = await this.storeActivityService.getSeries(
      Number(storeId),
      query,
    );
    return this.responseService.success(
      result,
      'Store activity series retrieved successfully',
    );
  }
}
