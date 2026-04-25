import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ActiveSubscriptionsService } from '../services/active-subscriptions.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { SubscriptionQueryDto } from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Active')
@Controller('superadmin/subscriptions/active')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class ActiveSubscriptionsController {
  constructor(
    private readonly activeSubsService: ActiveSubscriptionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:read')
  @Get()
  @ApiOperation({ summary: 'List all active subscriptions (cross-tenant)' })
  async findAll(@Query() query: SubscriptionQueryDto) {
    const result = await this.activeSubsService.findAll(query);
    return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Subscriptions retrieved');
  }

  @Permissions('superadmin:subscriptions:read')
  @Get(':id')
  @ApiOperation({ summary: 'Get subscription details by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.activeSubsService.findOne(id);
    return this.responseService.success(result, 'Subscription retrieved');
  }
}
