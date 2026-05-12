import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PartnerBrandingService } from './partner-branding.service';
import { UpdatePartnerBrandingDto } from './partner-branding.dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PartnerOrgGuard } from '../guards/partner-org.guard';

@Controller('organization/reseller/branding')
@UseGuards(PartnerOrgGuard, PermissionsGuard)
export class PartnerBrandingController {
  constructor(
    private readonly service: PartnerBrandingService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('reseller:branding:read')
  async getBranding() {
    const orgId = RequestContextService.getContext()?.organization_id;
    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    const result = await this.service.getBranding(orgId);
    return this.responseService.success(result, 'Branding retrieved');
  }

  @Put()
  @Permissions('reseller:branding:write')
  async updateBranding(@Body() dto: UpdatePartnerBrandingDto) {
    const orgId = RequestContextService.getContext()?.organization_id;
    if (!orgId) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }
    const result = await this.service.updateBranding(orgId, dto);
    return this.responseService.updated(result, 'Branding updated');
  }
}
