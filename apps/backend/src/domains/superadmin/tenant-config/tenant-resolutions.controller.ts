import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { RequestContextService } from '@common/context/request-context.service';
import {
  TenantContextRunner,
  type RunAsTenantOptions,
} from '@common/context/tenant-context-runner.service';
import { ResponseService } from '@common/responses/response.service';

import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { UserRole } from '../../auth/enums/user-role.enum';

import { CreateResolutionDto } from '../../store/invoicing/resolutions/dto/create-resolution.dto';
import { UpdateResolutionDto } from '../../store/invoicing/resolutions/dto/update-resolution.dto';
import { ResolutionsService } from '../../store/invoicing/resolutions/resolutions.service';

import { toTenantTarget, type TenantScopeSegment } from './dto/tenant-scope-param.dto';

/**
 * Permisos del tenant que se forjan dentro del contexto delegado.
 *
 * No autorizan nada por sí solos —el guard de permisos ya corrió arriba con el
 * rol de super admin— pero dejan el contexto honesto: cualquier lectura de
 * `RequestContextService` aguas abajo ve exactamente la capacidad que esta
 * operación estaba ejerciendo sobre el tenant, no un contexto omnipotente.
 */
const PERMISOS_LECTURA = ['invoicing:read'];
const PERMISOS_ESCRITURA = ['invoicing:read', 'invoicing:write'];
const PERMISOS_BORRADO = ['invoicing:read', 'invoicing:delete'];

/**
 * Resoluciones y rangos de numeración DIAN de un tenant, desde la consola de
 * super admin.
 *
 * Cada handler delega en el `ResolutionsService` de tienda dentro de un
 * contexto forjado por `TenantContextRunner`, de modo que la resolución de la
 * entidad contable, el pre-chequeo de prefijo duplicado y las protecciones de
 * borrado son EXACTAMENTE las mismas que ve el comerciante desde su panel. No
 * hay una segunda implementación que pueda divergir.
 *
 * El escaneo por IA (`POST /store/invoicing/resolutions/scan`) se deja fuera a
 * propósito: consume cuota de IA con atribución ambigua —¿del tenant o de la
 * plataforma?— y no hace falta para destrabar a un cliente, que es el motivo
 * por el que existe este rail.
 *
 * Los segmentos de alcance van en PLURAL (`stores` / `organizations`):
 * `DomainScopeGuard` responde 403 a cualquier ruta que contenga el literal
 * `/store/` cuando el token no es de super administrador.
 */
@ApiTags('Super Admin - Consola de tenants')
@Controller('superadmin/tenants/:scope/:tenantId/invoicing/resolutions')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TenantResolutionsController {
  constructor(
    private readonly runner: TenantContextRunner,
    private readonly resolutions: ResolutionsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('superadmin:tenants:resolutions:read')
  @ApiOperation({
    summary: 'Listar las resoluciones de numeración del tenant',
    description:
      'La clave técnica nunca viaja en la respuesta: se reporta como technical_key_set.',
  })
  async list(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const rows = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_LECTURA),
      () => this.resolutions.findAll(),
    );

    return this.response.success(
      (rows as Record<string, any>[]).map((row) => this.sinClaveTecnica(row)),
      'Resoluciones del tenant obtenidas',
    );
  }

  @Get(':resolutionId')
  @Permissions('superadmin:tenants:resolutions:read')
  @ApiOperation({ summary: 'Detalle de una resolución del tenant' })
  async findOne(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('resolutionId', ParseIntPipe) resolutionId: number,
  ) {
    const row = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_LECTURA),
      () => this.resolutions.findOne(resolutionId),
    );

    return this.response.success(
      this.sinClaveTecnica(row as Record<string, any>),
      'Resolución obtenida',
    );
  }

  @Post()
  @Permissions('superadmin:tenants:resolutions:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registrar una resolución de numeración para el tenant',
    description:
      'Delega en el servicio de tienda, así que el prefijo duplicado se rechaza con el mismo error de dominio (INVOICING_RESOLUTION_007) y no con un P2002 crudo.',
  })
  async create(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateResolutionDto,
  ) {
    const row = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_ESCRITURA),
      () => this.resolutions.create(dto),
    );

    return this.response.created(
      this.sinClaveTecnica(row as Record<string, any>),
      'Resolución creada',
    );
  }

  @Patch(':resolutionId')
  @Permissions('superadmin:tenants:resolutions:write')
  @ApiOperation({ summary: 'Actualizar una resolución del tenant' })
  async update(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('resolutionId', ParseIntPipe) resolutionId: number,
    @Body() dto: UpdateResolutionDto,
  ) {
    const row = await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_ESCRITURA),
      () => this.resolutions.update(resolutionId, dto),
    );

    return this.response.updated(
      this.sinClaveTecnica(row as Record<string, any>),
      'Resolución actualizada',
    );
  }

  @Delete(':resolutionId')
  @Permissions('superadmin:tenants:resolutions:write')
  @ApiOperation({
    summary: 'Eliminar una resolución del tenant',
    description:
      'Rechazada si la resolución ya emitió documentos o ya consumió numeración ante la DIAN; en ese caso hay que desactivarla, no borrarla.',
  })
  async remove(
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('resolutionId', ParseIntPipe) resolutionId: number,
  ) {
    await this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      this.opciones(PERMISOS_BORRADO),
      () => this.resolutions.remove(resolutionId),
    );

    return this.response.deleted('Resolución eliminada');
  }

  // --------------------------------------------------------------------
  // Auxiliares
  // --------------------------------------------------------------------

  /**
   * El actor es SIEMPRE el super admin real del request ambiente, nunca un
   * usuario del tenant: es lo que permite que la auditoría del comerciante
   * distinga un cambio hecho por soporte de uno hecho por él mismo.
   */
  private opciones(permissions: string[]): RunAsTenantOptions {
    const ambient = RequestContextService.getContext();
    return {
      actor: { user_id: ambient?.user_id, email: ambient?.email },
      permissions,
    };
  }

  /**
   * `technical_key` alimenta el CUFE de cada documento electrónico: quien la
   * tiene puede reconstruir la huella fiscal del comerciante. El servicio
   * delegado devuelve la fila completa de Prisma, así que la clave se ELIMINA
   * aquí —no se enmascara ni se recorta— y se reporta únicamente su presencia.
   * Misma decisión que `TenantDirectoryService.readResolutions`.
   */
  private sinClaveTecnica(row: Record<string, any>) {
    const { technical_key, ...resto } = row ?? {};
    return { ...resto, technical_key_set: Boolean(technical_key) };
  }
}
