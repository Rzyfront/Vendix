import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PayoutsService } from '../services/payouts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { SubscriptionPaymentQueryDto } from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Payments')
@Controller('superadmin/subscriptions/payments')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SubscriptionPaymentsController {
  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:read')
  @Get()
  @ApiOperation({ summary: 'List all subscription payments (cross-tenant)' })
  async findPayments(@Query() query: SubscriptionPaymentQueryDto) {
    const result = await this.payoutsService.findPayments(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Subscription payments retrieved',
    );
  }
}
