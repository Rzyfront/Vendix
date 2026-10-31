import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CrmCampaignsService } from './crm-campaigns.service';
import {
  CreateCrmCampaignDto,
  CrmCampaignContentDto,
  CrmCampaignRecipientsQueryDto,
  CrmCampaignsQueryDto,
  SendCrmCampaignDto,
} from './dto/crm-campaigns.dto';

/**
 * Marketing campaigns (PLAN-CRM §4.7). Every route needs
 * `store:crm_campaigns:send`: campaigns spend money and reach customers.
 */
@Controller('store/customers/crm/campaigns')
@UseGuards(PermissionsGuard)
@Permissions('store:crm_campaigns:send')
export class CrmCampaignsController {
  constructor(
    private readonly service: CrmCampaignsService,
    private readonly response: ResponseService,
  ) {}

  @Post('estimate')
  async estimate(@Body() dto: CrmCampaignContentDto) {
    return this.response.success(await this.service.estimate(dto));
  }

  @Get()
  async list(@Query() query: CrmCampaignsQueryDto) {
    const { data, total, page, limit } = await this.service.list(query);
    return this.response.paginated(data, total, page, limit);
  }

  @Post()
  async create(@Body() dto: CreateCrmCampaignDto) {
    return this.response.success(
      await this.service.create(dto),
      'Campaña creada',
    );
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.get(id));
  }

  @Post(':id/estimate')
  async estimateSaved(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.estimateSaved(id));
  }

  @Post(':id/send')
  async send(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendCrmCampaignDto,
  ) {
    return this.response.success(
      await this.service.send(id, dto.confirm_estimated_cost),
      'Campaña confirmada',
    );
  }

  @Post(':id/cancel')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(
      await this.service.cancel(id),
      'Campaña cancelada',
    );
  }

  @Get(':id/recipients')
  async recipients(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CrmCampaignRecipientsQueryDto,
  ) {
    const { data, total, page, limit } = await this.service.recipients(id, query);
    return this.response.paginated(data, total, page, limit);
  }
}
