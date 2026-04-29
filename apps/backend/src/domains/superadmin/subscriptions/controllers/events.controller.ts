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
import { EventsService } from '../services/events.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { EventsQueryDto } from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Events')
@Controller('superadmin/subscriptions/events')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:events:read')
  @Get()
  @ApiOperation({ summary: 'List all subscription events' })
  async findAll(@Query() query: EventsQueryDto) {
    const result = await this.eventsService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Events retrieved',
    );
  }

  @Permissions('superadmin:subscriptions:events:read')
  @Get(':subscriptionId')
  @ApiOperation({ summary: 'Get events for a specific subscription' })
  async findBySubscription(
    @Param('subscriptionId', ParseIntPipe) subscriptionId: number,
    @Query() query: EventsQueryDto,
  ) {
    const result = await this.eventsService.findBySubscription(
      subscriptionId,
      query,
    );
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Subscription events retrieved',
    );
  }
}
