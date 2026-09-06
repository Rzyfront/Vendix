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

import { ResponseService } from '@common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';

import { CloneQuotationProfileDto } from './dto/clone-quotation-profile.dto';
import { CreateQuotationProfileDto } from './dto/create-quotation-profile.dto';
import {
  QueryQuotationProfilesDto,
  QueryQuotationProfileVersionsDto,
} from './dto/query-quotation-profiles.dto';
import { UpdateQuotationProfileDto } from './dto/update-quotation-profile.dto';
import { QuotationProfilesService } from './quotation-profiles.service';

/**
 * B.1 — Perfiles de cotización (FB-03, FB-04).
 *
 * Los permisos reusan los nombres `store:quotations:*` ya sembrados: el
 * `PermissionsGuard` autoriza por NOMBRE además de por `(path, method)`
 * exacta, así que quien ya opera cotizaciones opera sus perfiles sin
 * sembrar filas nuevas (el seed de permisos es alcance de otro paso y no se
 * toca). `set-default` usa `store:quotations:update`: decidir el perfil por
 * omisión y editar perfiles son la misma decisión de peso acá —ninguna
 * timbra nada, a diferencia del default fiscal de factura—.
 */
@Controller('store/quotation-profiles')
@UseGuards(PermissionsGuard)
export class QuotationProfilesController {
  constructor(
    private readonly profiles_service: QuotationProfilesService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('store:quotations:read')
  async findAll(@Query() query: QueryQuotationProfilesDto) {
    const { data, total, page, limit } =
      await this.profiles_service.findAll(query);
    return this.response_service.paginated(data, total, page, limit);
  }

  /*
   * RUTAS ESTÁTICAS — TIENEN QUE IR ANTES DE `@Get(':id')`. Nest resuelve
   * por orden de declaración: con `:id` antes, `GET /catalog` entra por ese
   * handler y `ParseIntPipe` responde 400 sobre la cadena «catalog».
   */

  /** Catálogo de perfiles ACTIVOS para el selector (FB-03). Sin paginar. */
  @Get('catalog')
  @Permissions('store:quotations:read')
  async catalog() {
    const result = await this.profiles_service.catalog();
    return this.response_service.success(result);
  }

  /**
   * `ParseIntPipe` en todo `:id`: sin él, `+id` sobre un identificador no
   * numérico produce `NaN`, Prisma lo rechaza contra la columna `Int` y sale
   * un 500 — cuando lo correcto es un 400.
   */
  @Get(':id')
  @Permissions('store:quotations:read:one')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.findOne(id);
    return this.response_service.success(result);
  }

  @Get(':id/versions')
  @Permissions('store:quotations:read:one')
  async findVersions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryQuotationProfileVersionsDto,
  ) {
    const { data, total, page, limit } =
      await this.profiles_service.findVersions(
        id,
        query.page ?? 1,
        query.limit ?? 20,
      );
    return this.response_service.paginated(data, total, page, limit);
  }

  @Get(':id/versions/:version')
  @Permissions('store:quotations:read:one')
  async findVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ) {
    const result = await this.profiles_service.findVersion(id, version);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('store:quotations:create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateQuotationProfileDto) {
    const result = await this.profiles_service.create(create_dto);
    return this.response_service.created(
      result,
      'Perfil de cotización creado exitosamente',
    );
  }

  /**
   * `POST` y no `PUT`: clonar CREA un recurso nuevo con id propio y no es
   * idempotente —dos clonados producen dos perfiles—, así que `PUT` mentiría.
   */
  @Post(':id/clone')
  @Permissions('store:quotations:create')
  @HttpCode(HttpStatus.CREATED)
  async clone(
    @Param('id', ParseIntPipe) id: number,
    @Body() clone_dto: CloneQuotationProfileDto,
  ) {
    const result = await this.profiles_service.clone(id, clone_dto);
    return this.response_service.created(result, 'Perfil clonado exitosamente');
  }

  @Patch(':id')
  @Permissions('store:quotations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() update_dto: UpdateQuotationProfileDto,
  ) {
    const result = await this.profiles_service.update(id, update_dto);
    return this.response_service.updated(
      result,
      'Perfil de cotización actualizado exitosamente',
    );
  }

  /**
   * Transición sobre un perfil que YA existe: 200, no 201. El default de
   * Nest para `POST` es 201 Created y acá no nace ningún recurso.
   */
  @Post(':id/set-default')
  @Permissions('store:quotations:update')
  @HttpCode(HttpStatus.OK)
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.setDefault(id);
    return this.response_service.success(
      result,
      'Perfil marcado como predeterminado',
    );
  }

  /**
   * Activar y desactivar son rutas separadas —no un único `toggle`— porque
   * el cliente debe declarar el estado al que quiere llegar: un `toggle`
   * depende de lo que el servidor cree que es el estado actual, y dos clics
   * rápidos pueden dejar el estado contrario al que el usuario ve.
   */
  @Post(':id/activate')
  @Permissions('store:quotations:update')
  @HttpCode(HttpStatus.OK)
  async activate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.activate(id);
    return this.response_service.success(result, 'Perfil activado');
  }

  @Post(':id/deactivate')
  @Permissions('store:quotations:update')
  @HttpCode(HttpStatus.OK)
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.deactivate(id);
    return this.response_service.success(result, 'Perfil desactivado');
  }

  /**
   * Devuelve 200 con `{ deleted: true, id }`, no 204: el camino de fallo
   * tiene contenido (el conteo de cotizaciones del 409) y el cliente no
   * debería tratar dos formas distintas.
   *
   * Sin `try/catch` que devuelva 200 con `success:false`: los errores salen
   * como excepción y el filtro global los traduce.
   */
  @Delete(':id')
  @Permissions('store:quotations:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.profiles_service.remove(id);
    return this.response_service.success(
      result,
      'Perfil de cotización eliminado exitosamente',
    );
  }
}
