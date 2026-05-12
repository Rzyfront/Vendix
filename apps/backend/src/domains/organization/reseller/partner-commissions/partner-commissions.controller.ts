import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PartnerCommissionsService } from './partner-commissions.service';
import { CommissionQueryDto, PayoutQueryDto } from './dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { PartnerOrgGuard } from '../guards/partner-org.guard';

@Controller('organization/reseller/commissions')
@UseGuards(PartnerOrgGuard, PermissionsGuard)
export class PartnerCommissionsController {
  constructor(
    private readonly partnerCommissionsService: PartnerCommissionsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('reseller:commissions:read')
  async findCommissions(@Query() query: CommissionQueryDto) {
    const result = await this.partnerCommissionsService.findCommissions(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  @Get('summary')
  @Permissions('reseller:commissions:read')
  async getSummary() {
    const result = await this.partnerCommissionsService.getSummary();
    return this.responseService.success(result);
  }

  @Get('payouts')
  @Permissions('reseller:commissions:read')
  async findPayouts(@Query() query: PayoutQueryDto) {
    const result = await this.partnerCommissionsService.findPayouts(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }
}
