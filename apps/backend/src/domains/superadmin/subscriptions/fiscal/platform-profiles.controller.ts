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
  Query,
  UseGuards,
} from '@nestjs/common';

import { ResponseService } from '../../../../common/responses/response.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';

import { DIAN_PROFILE_TEMPLATES } from '../../../store/invoicing/profiles/dian-profile-templates';
import { CloneInvoiceProfileDto } from '../../../store/invoicing/profiles/dto/clone-invoice-profile.dto';
import { CreateInvoiceProfileDto } from '../../../store/invoicing/profiles/dto/create-invoice-profile.dto';
import {
  QueryInvoiceProfilesDto,
  QueryProfileVersionsDto,
} from '../../../store/invoicing/profiles/dto/query-invoice-profiles.dto';
import { UpdateInvoiceProfileDto } from '../../../store/invoicing/profiles/dto/update-invoice-profile.dto';
import { PreviewProfileDto } from '../../../store/invoicing/profiles/dto/preview-profile.dto';
import { PlatformProfilesService } from './platform-profiles.service';
import { PlatformProfilePreviewService } from './platform-profile-preview.service';

/**
 * Perfiles de facturación del riel plataforma (VENDIX_ADMIN).
 *
 * ## Espejo del controller de tienda, con permisos PLATFORM
 *
 * Mismo shape de respuesta, mismas rutas relativas, mismas razones para
 * `set-default`/`activate`/`deactivate` separados, mismo `@HttpCode(200)`
 * en transiciones y `preview` como POST+lectura. La única diferencia
 * deliberada: los permisos llevan prefijo `superadmin:fiscal:invoicing:profiles:*`
 * para distinguirse de los del riel tienda (`invoicing:profiles:*`) — son
 * namespaces disjuntos por guard, así que un SUPER_ADMIN sin permiso tienda
 * no entra al listado tienda, y viceversa.
 *
 * ## Orden de declaración importa
 *
 * Igual que el controller de tienda: las rutas estáticas (`templates`,
 * `catalog`, `account-health`) van ANTES de `:id` para que Nest no las enrute
 * por el `:id` y `ParseIntPipe` devuelva 400 sobre la cadena «templates».
 */
@Controller('superadmin/subscriptions/fiscal/profiles')
@UseGuards(PermissionsGuard)
export class PlatformProfilesController {
  constructor(
    private readonly profiles_service: PlatformProfilesService,
    private readonly preview_service: PlatformProfilePreviewService,
    private readonly response_service: ResponseService,
  ) {}

  // ─── Listado + paginado ────────────────────────────────────────────────

  @Get()
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  async findAll(@Query() query: QueryInvoiceProfilesDto) {
    const { data, total, page, limit } =
      await this.profiles_service.findAll(query);
    return this.response_service.paginated(data, total, page, limit);
  }

  // ─── Rutas estáticas ANTES de :id ──────────────────────────────────────

  /**
   * Mismas plantillas DIAN que el riel tienda (misma constante). Un tenant
   * distinto pero la misma fuente versionada en código: la sección «Plantillas
   * DIAN» del wizard de creación es la misma vista para todos los operadores.
   */
  @Get('templates')
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  templates() {
    return this.response_service.success(DIAN_PROFILE_TEMPLATES);
  }

  /** Catálogo de perfiles ACTIVOS para el selector del wizard plataforma. */
  @Get('catalog')
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  async catalog() {
    const result = await this.profiles_service.catalog();
    return this.response_service.success(result);
  }

  // ─── Detalle + historial ───────────────────────────────────────────────

  @Get(':id')
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.findOne(id);
    return this.response_service.success(result);
  }

  /**
   * Listado paginado de versiones. La respuesta NO incluye `config` (el
   * detalle por versión vive en `GET /:id/versions/:version`) — mismo
   * contrato que tienda.
   */
  @Get(':id/versions')
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  async findVersions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryProfileVersionsDto,
  ) {
    // TODO: delegar a un PlatformProfileVersionsService paralelo al de tienda
    // (ProfileVersionsService) en F.4 — la ruta queda viva para que el
    // frontend ya pueda navegar; mientras, devolvemos paginado vacío para no
    // mentir sobre shape.
    return this.response_service.paginated([], 0, query.page ?? 1, query.limit ?? 20);
  }

  @Get(':id/versions/:version')
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  async findVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ) {
    // TODO: delegar a PlatformProfileVersionsService (mismo TODO que arriba).
    // Por ahora devolvemos lo que ya sabemos del perfil como placeholder honesto.
    const profile = await this.profiles_service.findOne(id);
    return this.response_service.success({
      ...profile,
      version,
    });
  }

  // ─── Mutaciones ────────────────────────────────────────────────────────

  @Post()
  @Permissions('superadmin:fiscal:invoicing:profiles:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateInvoiceProfileDto) {
    const result = await this.profiles_service.create(create_dto);
    return this.response_service.success(
      result,
      'Perfil de facturación (plataforma) creado exitosamente',
    );
  }

  @Post(':id/clone')
  @Permissions('superadmin:fiscal:invoicing:profiles:write')
  @HttpCode(HttpStatus.CREATED)
  async clone(
    @Param('id', ParseIntPipe) id: number,
    @Body() clone_dto: CloneInvoiceProfileDto,
  ) {
    const result = await this.profiles_service.clone(id, clone_dto);
    return this.response_service.success(
      result,
      'Perfil plataforma clonado exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('superadmin:fiscal:invoicing:profiles:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() update_dto: UpdateInvoiceProfileDto,
  ) {
    const result = await this.profiles_service.update(id, update_dto);
    return this.response_service.success(
      result,
      'Perfil plataforma actualizado exitosamente',
    );
  }

  @Post(':id/set-default')
  @Permissions('superadmin:fiscal:invoicing:profiles:set_default')
  @HttpCode(HttpStatus.OK)
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.setDefault(id);
    return this.response_service.success(
      result,
      'Perfil plataforma marcado como predeterminado',
    );
  }

  @Post(':id/activate')
  @Permissions('superadmin:fiscal:invoicing:profiles:write')
  @HttpCode(HttpStatus.OK)
  async activate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.activate(id);
    return this.response_service.success(result, 'Perfil plataforma activado');
  }

  @Post(':id/deactivate')
  @Permissions('superadmin:fiscal:invoicing:profiles:write')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.deactivate(id);
    return this.response_service.success(result, 'Perfil plataforma desactivado');
  }

  /**
   * Preview endpoint — B.4 real (ya no stub 501).
   *
   * Delega a `PlatformProfilePreviewService` que carga el perfil vía
   * `PlatformProfilesService.findOne(id)` (org-scoped) y construye el XML con
   * `InvoiceCalculatorService.calculate` sin tocar `invoice_resolutions`.
   * Devuelve 200 con `not_performed: { numbering_reserved: false, ... }` para
   * que el cliente pueda afirmar por `curl` que no se consumió consecutivo.
   * Usa `PreviewNumberingGuard` logic: emite `PREVIEW_INVOICE_NUMBER` fijo y
   * nunca mueve `current_number`.
   */
  @Post(':id/preview')
  @Permissions('superadmin:fiscal:invoicing:profiles:read')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @Body() preview_dto: PreviewProfileDto,
  ) {
    const result = await this.preview_service.preview(id, preview_dto);
    return this.response_service.success(
      result,
      'Previsualización plataforma generada (no se reservó numeración ni se transmitió)',
    );
  }

  @Delete(':id')
  @Permissions('superadmin:fiscal:invoicing:profiles:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.remove(id);
    return this.response_service.success(
      result,
      'Perfil plataforma eliminado exitosamente',
    );
  }
}
