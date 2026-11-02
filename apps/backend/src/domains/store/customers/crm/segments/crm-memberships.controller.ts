import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { CrmSegmentMembersService } from './crm-segment-members.service';
import { CrmMembershipsQueryDto } from './dto/crm-segments.dto';

/**
 * Segments and tags of several customers at once (the customer list).
 *
 *   GET /store/customers/crm/memberships?customer_ids=1,2,3
 */
@Controller('store/customers/crm/memberships')
@UseGuards(PermissionsGuard)
export class CrmMembershipsController {
  constructor(
    private readonly members: CrmSegmentMembersService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:customers:read')
  async list(@Query() query: CrmMembershipsQueryDto) {
    return this.response.success(
      await this.members.membershipsOf(query.customer_ids),
    );
  }
}
