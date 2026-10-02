import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { RequestContextService } from '../../common/context/request-context.service';
import { ResponseService } from '../../common/responses/response.service';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ReceivedBuyerEventReviewDto, ReceivedBuyerEventSuspensionDto } from './dto/received-buyer-event-review.dto';
import { ReceivedBuyerEventEnablementService } from './services/received-buyer-event-enablement.service';

@Controller('super-admin/fiscal/invoicing/received-documents/buyer-event-enablement')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminReceivedBuyerEventsController {
  constructor(
    private readonly enablement: ReceivedBuyerEventEnablementService,
    private readonly responses: ResponseService,
  ) {}

  @Post(':organizationId/:accountingEntityId/verify')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:invoicing:received:events:verify')
  async verify(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('accountingEntityId', ParseIntPipe) accountingEntityId: number,
    @Body() dto: ReceivedBuyerEventReviewDto,
  ) {
    const reviewerUserId = RequestContextService.getUserId();
    if (!reviewerUserId) throw new UnauthorizedException();
    return this.responses.updated(
      await this.enablement.verifyAsPlatformReviewer(organizationId, accountingEntityId, reviewerUserId, dto),
      'Activación de eventos de comprador verificada',
    );
  }

  @Post(':organizationId/:accountingEntityId/suspend')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:invoicing:received:events:suspend')
  async suspend(
    @Param('organizationId', ParseIntPipe) organizationId: number,
    @Param('accountingEntityId', ParseIntPipe) accountingEntityId: number,
    @Body() dto: ReceivedBuyerEventSuspensionDto,
  ) {
    const reviewerUserId = RequestContextService.getUserId();
    if (!reviewerUserId) throw new UnauthorizedException();
    return this.responses.updated(
      await this.enablement.suspendAsPlatformReviewer(organizationId, accountingEntityId, reviewerUserId, dto),
      'Activación de eventos de comprador suspendida',
    );
  }
}
