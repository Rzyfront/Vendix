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

import { CloneInvoiceProfileDto } from './dto/clone-invoice-profile.dto';
import { CreateInvoiceProfileDto } from './dto/create-invoice-profile.dto';
import {
  QueryInvoiceProfilesDto,
  QueryProfileVersionsDto,
} from './dto/query-invoice-profiles.dto';
import { UpdateInvoiceProfileDto } from './dto/update-invoice-profile.dto';
import { DIAN_PROFILE_TEMPLATES } from './dian-profile-templates';
import { ProfileVersionsService } from './profile-versions.service';
import { ProfilesService } from './profiles.service';

/**
 * Perfiles de facturación.
 *
 * ## `@UseGuards(PermissionsGuard)` desde el primer commit (ADR-7)
 *
 * Sin el guard declarado en la clase, los `@Permissions` de abajo son
 * decoración inerte: Nest sólo los lee si hay un guard que los consulte. Es
 * exactamente lo que le pasaba a `ResolutionsController` y a
 * `PosFiscalController` antes de la Fase A —un `cashier` sin un solo permiso
 * `invoicing:*` obtenía 200— y no se puede repetir en un módulo que decide con
 * qué tarifas se calcula el IVA.
 *
 * ## Por qué `set-default`, `activate` y `deactivate` son rutas propias
 *
 * `PermissionsGuard` es una DISYUNCIÓN de dos ramas: una compara los permisos
 * del usuario contra `(route.path, method)` **ignorando el decorador**, y la
 * otra comprueba el nombre del decorador. Cualquiera de las dos concede. O sea:
 * el par `(path, method)` de una fila de `permissions` ES un otorgamiento, no
 * documentación. Consecuencia directa de diseño: **dos operaciones que deban
 * autorizarse distinto no pueden compartir ruta y verbo.** Por eso el
 * predeterminado no es un campo del `PATCH` —lo abriría a todo el que tenga
 * `invoicing:profiles:write`— sino su propia ruta con su propio permiso.
 */
@Controller('store/invoicing/profiles')
@UseGuards(PermissionsGuard)
export class ProfilesController {
  constructor(
    private readonly profiles_service: ProfilesService,
    private readonly versions_service: ProfileVersionsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('invoicing:profiles:read')
  async findAll(@Query() query: QueryInvoiceProfilesDto) {
    const { data, total, page, limit } =
      await this.profiles_service.findAll(query);
    return this.response_service.paginated(data, total, page, limit);
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * RUTAS ESTÁTICAS — TIENEN QUE IR ANTES DE `@Get(':id')`.
   *
   * No es estilo. Nest resuelve por orden de declaración, así que con `:id`
   * declarado antes, `GET /profiles/templates` entra por ese handler,
   * `ParseIntPipe` recibe la cadena «templates» y responde 400. Es el mismo
   * defecto que ya mordió en la Fase 2 con `GET /invoicing/invoices?limit=1`, y
   * el que rompería el estado vacío del frontend —el CTA «Usar plantilla DIAN»
   * es lo primero que ve un usuario sin perfiles—.
   * ─────────────────────────────────────────────────────────────────────────
   */

  /**
   * Plantillas DIAN. Constante versionada en código (ADR-10), no dato editable:
   * una tabla global de plantillas sería una superficie de escritura
   * cross-tenant sobre reglas fiscales.
   */
  @Get('templates')
  @Permissions('invoicing:profiles:read')
  templates() {
    return this.response_service.success(DIAN_PROFILE_TEMPLATES);
  }

  /** Catálogo de perfiles ACTIVOS para el selector del wizard de factura. */
  @Get('catalog')
  @Permissions('invoicing:profiles:read')
  async catalog() {
    const result = await this.profiles_service.catalog();
    return this.response_service.success(result);
  }

  // ─── Rutas con parámetro ────────────────────────────────────────────────

  /**
   * `ParseIntPipe` en todo `:id`, como en `ResolutionsController` y
   * `DianConfigController`: sin él, `+id` sobre un identificador no numérico
   * produce `NaN`, Prisma lo rechaza contra la columna `Int` y sale un 500 —
   * cuando lo correcto es un 400, porque la petición está mal formada y el
   * servidor no falló.
   */
  @Get(':id')
  @Permissions('invoicing:profiles:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.findOne(id);
    return this.response_service.success(result);
  }

  @Get(':id/versions')
  @Permissions('invoicing:profiles:read')
  async findVersions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryProfileVersionsDto,
  ) {
    const { data, total, page, limit } = await this.versions_service.findAll(
      id,
      query,
    );
    return this.response_service.paginated(data, total, page, limit);
  }

  /**
   * `version` también lleva `ParseIntPipe`: es tan `Int` en la base como el id,
   * y sin el pipe `/versions/abc` era el mismo 500.
   */
  @Get(':id/versions/:version')
  @Permissions('invoicing:profiles:read')
  async findVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const result = await this.versions_service.findOne(id, version);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('invoicing:profiles:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateInvoiceProfileDto) {
    const result = await this.profiles_service.create(create_dto);
    return this.response_service.success(
      result,
      'Perfil de facturación creado exitosamente',
    );
  }

  /**
   * `POST` y no `PUT`: clonar CREA un recurso nuevo con id propio y no es
   * idempotente —dos clonados producen dos perfiles—, así que `PUT` mentiría.
   */
  @Post(':id/clone')
  @Permissions('invoicing:profiles:write')
  @HttpCode(HttpStatus.CREATED)
  async clone(
    @Param('id', ParseIntPipe) id: number,
    @Body() clone_dto: CloneInvoiceProfileDto,
  ) {
    const result = await this.profiles_service.clone(id, clone_dto);
    return this.response_service.success(
      result,
      'Perfil clonado exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('invoicing:profiles:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() update_dto: UpdateInvoiceProfileDto,
  ) {
    const result = await this.profiles_service.update(id, update_dto);
    return this.response_service.success(
      result,
      'Perfil de facturación actualizado exitosamente',
    );
  }

  /**
   * `POST` y no `PATCH`: es el método con el que está sembrado el permiso
   * `invoicing:profiles:set_default`
   * (`POST /api/store/invoicing/profiles/:id/set-default`), y `PermissionsGuard`
   * casa las filas del usuario por `(path, method)` con igualdad exacta. Cambiar
   * el verbo acá dejaría el permiso sembrado sin ninguna ruta que lo use.
   *
   * Permiso propio, distinto de `write`: editar un perfil y decidir con cuál se
   * factura por omisión son decisiones de distinto peso, y esta segunda es la
   * que tiene consecuencia fiscal.
   */
  @Post(':id/set-default')
  @Permissions('invoicing:profiles:set_default')
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.setDefault(id);
    return this.response_service.success(
      result,
      'Perfil marcado como predeterminado',
    );
  }

  /**
   * Activar y desactivar son rutas separadas —no un único `toggle`— porque el
   * cliente debe declarar el estado al que quiere llegar. Un `toggle` depende de
   * lo que el servidor crea que es el estado actual, así que dos clics rápidos
   * pueden dejar el perfil en el estado contrario al que el usuario ve.
   */
  @Post(':id/activate')
  @Permissions('invoicing:profiles:write')
  async activate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.activate(id);
    return this.response_service.success(result, 'Perfil activado');
  }

  @Post(':id/deactivate')
  @Permissions('invoicing:profiles:write')
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.deactivate(id);
    return this.response_service.success(result, 'Perfil desactivado');
  }

  /**
   * Devuelve 200 con `{ deleted: true, id }`, no 204.
   *
   * El 204 de `ResolutionsController` obliga al frontend a recordar qué borró
   * para actualizar su lista, y el cuerpo cuesta 30 bytes. Además el camino de
   * fallo de este endpoint tiene contenido —el conteo de facturas timbradas del
   * 409— así que un 204 en el éxito y un cuerpo en el error harían al cliente
   * tratar dos formas distintas.
   *
   * **Ningún `try/catch` que devuelva 200 con `success:false`.** Los errores
   * salen como excepción y el filtro global los traduce; un envoltorio de éxito
   * con un fallo dentro es un fallo que el frontend renderiza como dato.
   */
  @Delete(':id')
  @Permissions('invoicing:profiles:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.remove(id);
    return this.response_service.success(
      result,
      'Perfil de facturación eliminado exitosamente',
    );
  }
}
