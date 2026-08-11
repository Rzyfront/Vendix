import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResponseService } from '@common/responses/response.service';

import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';

import { TenantActivityQueryDto } from './dto/tenant-activity-query.dto';
import { toTenantTarget, type TenantScopeSegment } from './dto/tenant-scope-param.dto';
import { TenantActivityService } from './tenant-activity.service';

/**
 * Actividad de uso del tenant en la consola de super admin.
 *
 * Responde a "¿esta tienda se está usando?" sin entrar a su panel: último
 * acceso, usuarios activos, sesiones vivas y qué partes del producto se tocan.
 * Todo lo que devuelve es TELEMETRÍA DE USO; ninguna cifra es un importe, un
 * pedido ni un cliente del comerciante.
 *
 * Los segmentos de alcance van en PLURAL (`stores` / `organizations`) a
 * propósito: `DomainScopeGuard` responde 403 a cualquier ruta que contenga el
 * literal `/store/` cuando el token es `VENDIX_ADMIN`.
 */
@ApiTags('Super Admin - Consola de tenants')
@Controller('superadmin/tenants')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TenantActivityController {
  constructor(
    private readonly activity: TenantActivityService,
    private readonly response: ResponseService,
  ) {}

  @Get(':scope/:tenantId/activity')
  @Permissions('superadmin:tenants:read')
  @ApiOperation({
    summary: 'Actividad de uso de una tienda u organización',
    description:
      'Lectura pura: no genera el reporte semanal ni materializa ninguna fila. Las series se agrupan por día natural del tenant, no en UTC.',
  })
  async getActivity(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query() query: TenantActivityQueryDto,
  ) {
    const activity = await this.activity.getActivity(
      toTenantTarget(scope, tenantId),
      query,
    );
    return this.response.success(activity, 'Actividad del tenant obtenida');
  }
}
