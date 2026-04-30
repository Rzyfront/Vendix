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
import { PromotionalService } from '../services/promotional.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import {
  CreatePromotionalDto,
  UpdatePromotionalDto,
  PromotionalQueryDto,
  AssignPromoPlanDto,
} from '../dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';

@ApiTags('Superadmin Subscriptions - Promotional')
@Controller('superadmin/subscriptions/promotional')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class PromotionalController {
  constructor(
    private readonly promotionalService: PromotionalService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:promotional:create')
  @Post()
  @ApiOperation({ summary: 'Create a promotional plan' })
  async create(@Body() dto: CreatePromotionalDto) {
    const result = await this.promotionalService.create(dto);
    return this.responseService.created(result, 'Promotional plan created');
  }

  @Permissions('superadmin:subscriptions:promotional:read')
  @Get()
  @ApiOperation({ summary: 'List all promotional plans' })
  async findAll(@Query() query: PromotionalQueryDto) {
    const result = await this.promotionalService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Promotional plans retrieved',
    );
  }

  @Permissions('superadmin:subscriptions:promotional:read')
  @Get(':id')
  @ApiOperation({ summary: 'Get promotional plan by ID' })
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.promotionalService.findOne(id);
    return this.responseService.success(result, 'Promotional plan retrieved');
  }

  @Permissions('superadmin:subscriptions:promotional:update')
  @Patch(':id')
  @ApiOperation({ summary: 'Update a promotional plan' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePromotionalDto,
  ) {
    const result = await this.promotionalService.update(id, dto);
    return this.responseService.updated(result, 'Promotional plan updated');
  }

  @Permissions('superadmin:subscriptions:promotional:delete')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a promotional plan' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.promotionalService.remove(id);
    return this.responseService.deleted('Promotional plan deleted');
  }
}

/**
 * RNC-05 — Org-scoped controller for super-admin to grant a promotional plan
 * to an organization (one or all stores). This replaces the legacy
 * `extend-trial` endpoint which is intentionally NOT implemented per RNC-05
 * (no trial extensions).
 */
@ApiTags('Superadmin Subscriptions - Org Promo Assignment')
@Controller('superadmin/orgs')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class OrgPromoAssignController {
  constructor(
    private readonly promotionalService: PromotionalService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('superadmin:subscriptions:promotional:update')
  @Post(':id/assign-promo-plan')
  @ApiOperation({
    summary:
      'Assign a promotional plan to one or all stores of the organization',
  })
  async assignPromoPlan(
    @Param('id', ParseIntPipe) orgId: number,
    @Body() dto: AssignPromoPlanDto,
  ) {
    const ctx = RequestContextService.getContext();
    const result = await this.promotionalService.assignPromoPlan(
      orgId,
      dto,
      ctx?.user_id ?? null,
    );
    return this.responseService.success(
      result,
      'Promotional plan assigned to organization',
    );
  }
}
