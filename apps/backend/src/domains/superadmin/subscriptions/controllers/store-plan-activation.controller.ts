import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { ActivateStorePlanDto, ActivateStorePlanPreviewDto } from '../dto';
import { StorePlanActivationService } from '../services/store-plan-activation.service';
import { StorePlanActivationCatalogService } from '../services/store-plan-activation-catalog.service';

/**
 * Activación manual de un plan SaaS a una tienda por el superadmin (pago por
 * consignación, fuera de la pasarela).
 */
@ApiTags('Superadmin Subscriptions - Store Plan Activation')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('superadmin/subscriptions/stores')
export class StorePlanActivationController {
  constructor(
    private readonly activationService: StorePlanActivationService,
    private readonly catalogService: StorePlanActivationCatalogService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':storeId/activate-plan')
  @Permissions('superadmin:subscriptions:update')
  @ApiOperation({
    summary:
      'Activa un plan a una tienda registrando un pago manual (consignación)',
  })
  async activatePlan(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Body() dto: ActivateStorePlanDto,
  ) {
    const user = RequestContextService.getContext();
    const result = await this.activationService.activatePlan(
      storeId,
      dto,
      user?.user_id ?? 0,
    );
    return this.responseService.success(result, 'Plan activado');
  }

  @Get(':storeId/activate-plan/options')
  @Permissions('superadmin:subscriptions:update')
  @ApiOperation({
    summary:
      'Catálogo de planes (todos los ciclos) y estado actual para activar un plan',
  })
  async getOptions(@Param('storeId', ParseIntPipe) storeId: number) {
    const result = await this.catalogService.getOptions(storeId);
    return this.responseService.success(result);
  }

  @Post(':storeId/activate-plan/preview')
  @Permissions('superadmin:subscriptions:update')
  @ApiOperation({
    summary: 'Cotiza una activación de plan sin efectos (preview)',
  })
  async previewActivation(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Body() dto: ActivateStorePlanPreviewDto,
  ) {
    const result = await this.catalogService.preview(storeId, dto);
    return this.responseService.success(result);
  }
}
