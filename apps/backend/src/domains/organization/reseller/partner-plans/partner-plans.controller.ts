import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { PartnerPlansService } from './partner-plans.service';
import {
  CreatePartnerPlanOverrideDto,
  UpdatePartnerPlanOverrideDto,
  PartnerPlanQueryDto,
} from './dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { PartnerOrgGuard } from '../guards/partner-org.guard';

@Controller('organization/reseller/plans')
@UseGuards(PartnerOrgGuard, PermissionsGuard)
export class PartnerPlansController {
  constructor(
    private readonly partnerPlansService: PartnerPlansService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('reseller:plans:read')
  async findAll(@Query() query: PartnerPlanQueryDto) {
    const result = await this.partnerPlansService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Post()
  @Permissions('reseller:plans:write')
  async create(@Body() dto: CreatePartnerPlanOverrideDto) {
    const result = await this.partnerPlansService.create(dto);
    return this.responseService.created(result);
  }

  @Patch(':id')
  @Permissions('reseller:plans:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePartnerPlanOverrideDto,
  ) {
    const result = await this.partnerPlansService.update(id, dto);
    return this.responseService.updated(result);
  }

  @Delete(':id')
  @Permissions('reseller:plans:write')
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.partnerPlansService.deactivate(id);
    return this.responseService.updated(result);
  }
}
