import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequestContextService } from '@common/context/request-context.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { DunningService } from '../services/dunning.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { DunningQueryDto, PreviewTransitionDto } from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Dunning')
@Controller('superadmin/subscriptions/dunning')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class DunningController {
  constructor(
    private readonly dunningService: DunningService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:read')
  @Get()
  @ApiOperation({
    summary: 'List subscriptions in dunning (grace/suspended/blocked)',
  })
  async findAll(@Query() query: DunningQueryDto) {
    const result = await this.dunningService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Dunning subscriptions retrieved',
    );
  }

  @Permissions('superadmin:subscriptions:read')
  @Get('stats')
  @ApiOperation({ summary: 'Get dunning statistics' })
  async getStats() {
    const result = await this.dunningService.getStats();
    return this.responseService.success(result, 'Dunning stats retrieved');
  }

  @Permissions('superadmin:subscriptions:update')
  @Post(':id/remind')
  @ApiOperation({ summary: 'Send manual payment reminder to store in dunning' })
  async sendReminder(@Param('id', ParseIntPipe) id: number) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const result = await this.dunningService.sendReminder(id, userId);
    return this.responseService.success(result, 'Reminder sent');
  }

  @Permissions('superadmin:subscriptions:update')
  @Post(':id/cancel')
  @ApiOperation({ summary: 'Force-cancel a subscription from dunning' })
  async forceCancel(@Param('id', ParseIntPipe) id: number) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const result = await this.dunningService.forceCancel(id, userId);
    return this.responseService.success(result, 'Subscription cancelled');
  }

  @Permissions('superadmin:subscriptions:update')
  @Post(':id/preview-transition')
  @ApiOperation({
    summary:
      'Preview the side-effects (emails, feature deltas, invoices, commissions) of forcing a state transition. Does NOT mutate.',
  })
  async previewTransition(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PreviewTransitionDto,
  ) {
    const result = await this.dunningService.previewTransition(
      id,
      body.target_state,
    );
    return this.responseService.success(result, 'Transition preview computed');
  }

  @Permissions('superadmin:subscriptions:update')
  @Post(':id/retry-payment')
  @ApiOperation({
    summary: 'Manually enqueue a payment retry for a subscription in dunning',
  })
  async retryPayment(@Param('id', ParseIntPipe) id: number) {
    const userId = RequestContextService.getContext()?.user_id ?? null;
    const result = await this.dunningService.enqueueRetryPayment(id, userId);
    return this.responseService.success(result, 'Payment retry enqueued');
  }
}
