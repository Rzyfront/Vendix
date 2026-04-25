import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PayoutsService } from '../services/payouts.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { PayoutQueryDto, ApprovePayoutDto } from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Payouts')
@Controller('superadmin/subscriptions/payouts')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PayoutsController {
  constructor(
    private readonly payoutsService: PayoutsService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:payouts:read')
  @Get()
  @ApiOperation({ summary: 'List all payout batches' })
  async findAll(@Query() query: PayoutQueryDto) {
    const result = await this.payoutsService.findAll(query);
    return this.responseService.paginated(result.data, result.meta.total, result.meta.page, result.meta.limit, 'Payout batches retrieved');
  }

  @Permissions('superadmin:subscriptions:payouts:read')
  @Get(':id')
  @ApiOperation({ summary: 'Get payout batch details' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.payoutsService.findOne(id);
    return this.responseService.success(result, 'Payout batch retrieved');
  }

  @Permissions('superadmin:subscriptions:payouts:update')
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a payout batch' })
  async approve(@Param('id', ParseIntPipe) id: number, @Body() dto: ApprovePayoutDto) {
    const result = await this.payoutsService.approve(id, dto);
    return this.responseService.updated(result, 'Payout batch approved');
  }

  @Permissions('superadmin:subscriptions:payouts:update')
  @Patch(':id/pay')
  @ApiOperation({ summary: 'Mark a payout batch as paid' })
  async markPaid(@Param('id', ParseIntPipe) id: number) {
    const result = await this.payoutsService.markPaid(id);
    return this.responseService.updated(result, 'Payout batch marked as paid');
  }
}
