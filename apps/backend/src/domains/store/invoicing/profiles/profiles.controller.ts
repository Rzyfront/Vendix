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
import { PreviewProfileDto } from './dto/preview-profile.dto';
import { UpdateInvoiceProfileDto } from './dto/update-invoice-profile.dto';
import { DIAN_PROFILE_TEMPLATES } from './dian-profile-templates';
import { ProfileVersionsService } from './profile-versions.service';
import { ProfilePreviewService } from './profile-preview.service';
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
    private readonly preview_service: ProfilePreviewService,
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
  /**
   * Transición de estado sobre un perfil que YA existe, así que 200, no 201.
   *
   * El default de Nest para `POST` es 201 Created y acá no nace ningún recurso:
   * se mueve un campo del que ya estaba. La distinción no es cosmética — el 201
   * es la señal con la que un cliente decide «se creó algo, agrégalo a la
   * lista», y un frontend que la crea duplica la fila en pantalla. Mismo
   * criterio ya documentado en `preview` más abajo.
   */
  @Post(':id/set-default')
  @Permissions('invoicing:profiles:set_default')
  @HttpCode(HttpStatus.OK)
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
  @HttpCode(HttpStatus.OK)
  async activate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.activate(id);
    return this.response_service.success(result, 'Perfil activado');
  }

  @Post(':id/deactivate')
  @Permissions('invoicing:profiles:write')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.deactivate(id);
    return this.response_service.success(result, 'Perfil desactivado');
  }

  /**
   * PREVISUALIZACIÓN DEL XML QUE EMITIRÍA ESTE PERFIL.
   *
   * ## Es un POST y es una LECTURA. Las dos cosas a la vez
   *
   * `POST` porque la muestra es un objeto anidado —líneas, importes, cliente— y
   * no cabe en una query string sin codificarla a mano, que es exactamente la
   * clase de serialización artesanal donde se pierde un decimal.
   *
   * Lectura porque no escribe **nada**: ni numeración, ni firma, ni transmisión,
   * ni persistencia (ADR-5). De ahí las dos consecuencias visibles acá:
   *
   * · `@Permissions('invoicing:profiles:read')`. Exigir `write` para ver qué
   *   emitiría un perfil dejaría a quien audita sin la única herramienta que
   *   permite auditar sin emitir — y quien audita, por diseño, no debe poder
   *   escribir.
   * · `@HttpCode(HttpStatus.OK)`. El default de Nest para `POST` es **201
   *   Created**, y acá no se creó nada. Un 201 sobre una respuesta que no creó
   *   recurso es una mentira que el cliente puede creer: es la clase de señal con
   *   la que un frontend decide refrescar una lista o mostrar «guardado».
   *
   * El cinturón que sostiene «no numera» no es esta documentación: es el
   * proveedor `InvoiceNumberGenerator → PreviewNumberingGuard` de
   * `ProfilesModule`, y la respuesta lo declara en `not_performed` para que se
   * pueda afirmar por `curl` sin leer el código.
   *
   * ## Sobre el ensanchamiento del guard
   *
   * `PermissionsGuard` franquicia por prefijo de ruta, así que quien tenga la
   * fila `(store/invoicing/profiles, POST)` de la creación alcanza también este
   * handler. Se acepta a conciencia: ensancha de `read` hacia quien ya tiene
   * `write`, que es la dirección inocua. La inversa —que `read` alcanzara una
   * escritura— sería un hallazgo.
   */
  @Post(':id/preview')
  @Permissions('invoicing:profiles:read')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @Body() preview_dto: PreviewProfileDto,
  ) {
    const result = await this.preview_service.preview(id, preview_dto);
    return this.response_service.success(
      result,
      'Previsualización generada (no se reservó numeración ni se transmitió)',
    );
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
