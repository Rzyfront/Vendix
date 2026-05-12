import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PlansService } from '../services/plans.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { CreatePlanDto, UpdatePlanDto, PlanQueryDto } from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Plans')
@Controller('superadmin/subscriptions/plans')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:plans:create')
  @Post()
  @ApiOperation({ summary: 'Create a subscription plan' })
  async create(@Body() dto: CreatePlanDto) {
    const result = await this.plansService.create(dto);
    return this.responseService.created(result, 'Plan created');
  }

  @Permissions('superadmin:subscriptions:plans:read')
  @Get()
  @ApiOperation({ summary: 'List all subscription plans' })
  async findAll(@Query() query: PlanQueryDto) {
    const result = await this.plansService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Plans retrieved',
    );
  }

  @Permissions('superadmin:subscriptions:plans:read')
  @Get(':id')
  @ApiOperation({ summary: 'Get plan by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.plansService.findOne(id);
    return this.responseService.success(result, 'Plan retrieved');
  }

  @Permissions('superadmin:subscriptions:plans:update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a subscription plan' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlanDto,
  ) {
    const result = await this.plansService.update(id, dto);
    return this.responseService.updated(result, 'Plan updated');
  }

  @Permissions('superadmin:subscriptions:plans:update')
  @Patch(':id/archive')
  @ApiOperation({ summary: 'Archive a subscription plan' })
  async archive(@Param('id', ParseIntPipe) id: number) {
    const result = await this.plansService.archive(id);
    return this.responseService.updated(result, 'Plan archived');
  }

  @Permissions('superadmin:subscriptions:plans:delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a subscription plan' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.plansService.remove(id);
    return this.responseService.deleted('Plan deleted');
  }

  /**
   * RNC-04 — Atomically promote a plan to be the unique default.
   * Clears the previous default within the same Serializable transaction,
   * preserving the partial unique index invariant.
   */
  @Permissions('superadmin:subscriptions:plans:update')
  @Post(':id/set-default')
  @ApiOperation({ summary: 'Set a subscription plan as the unique default' })
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.plansService.setDefault(id);
    return this.responseService.updated(result, 'Default plan updated');
  }
}
