import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';

import { TenantDirectoryQueryDto } from './dto/tenant-directory-query.dto';
import { toTenantTarget, type TenantScopeSegment } from './dto/tenant-scope-param.dto';
import {
  buildTenantCapabilities,
  type CapabilityActor,
} from './tenant-capabilities.util';
import { TenantDirectoryService } from './tenant-directory.service';

interface RequestWithActor {
  user?: CapabilityActor;
}

/**
 * Consola de tenants del super admin: directorio y perfil de configuración.
 *
 * Devuelve exclusivamente CONFIGURACIÓN — identidad fiscal, estado de
 * habilitación DIAN, rangos de numeración y estado de suscripción. Ningún
 * endpoint de este controlador expone datos transaccionales del comerciante
 * (facturas, pedidos, clientes, importes) ni secretos.
 *
 * Los segmentos de alcance van en PLURAL (`stores` / `organizations`) a
 * propósito: `DomainScopeGuard` responde 403 a cualquier ruta que contenga el
 * literal `/store/` cuando el token es `VENDIX_ADMIN`.
 */
@ApiTags('Super Admin - Consola de tenants')
@Controller('superadmin/tenants')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TenantDirectoryController {
  constructor(
    private readonly directory: TenantDirectoryService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:tenants:read')
  @ApiOperation({
    summary: 'Listar tenants con su estado de habilitación DIAN',
    description:
      'Excluye la organización plataforma. Marca scope_drift cuando una organización de NIT único arrastra configuraciones DIAN ancladas a tienda, que su propio panel no puede ver.',
  })
  async list(@Query() query: TenantDirectoryQueryDto) {
    const result = await this.directory.list(query);
    return this.response.success(result.data, 'Tenants obtenidos', result.meta);
  }

  @Get(':scope/:tenantId/profile')
  @Permissions('superadmin:tenants:read')
  @ApiOperation({
    summary: 'Perfil de configuración de una tienda u organización',
    description:
      'Lectura pura: no materializa entidades contables ni ninguna otra fila. Los secretos se reportan como presentes/ausentes, nunca por valor.',
  })
  async profile(
    @Req() req: RequestWithActor,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const profile = await this.directory.getProfile(
      toTenantTarget(scope, tenantId),
    );

    // Las capacidades describen al OPERADOR, no al tenant: son la respuesta a
    // "¿puede este super admin pulsar este botón?". Se resuelven aquí y no en
    // el servicio porque sólo el controlador ve la petición autenticada.
    // Sin ellas la consola arranca entera en solo lectura, porque el gating de
    // la UI falla al lado seguro.
    return this.response.success(
      { ...profile, capabilities: buildTenantCapabilities(req.user) },
      'Perfil del tenant obtenido',
    );
  }
}
