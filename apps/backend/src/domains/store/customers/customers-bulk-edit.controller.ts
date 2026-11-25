import { Body, Controller, Get, Logger, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CustomersBulkEditService } from './customers-bulk-edit.service';
import { CustomersService } from './customers.service';
import {
  CrmSegmentQueryService,
  MANUAL_SEGMENT_FILTER,
} from './crm/segments/crm-segment-query.service';
import {
  BulkCustomerFilterDto,
  BulkCustomerFilters,
  BulkCustomerListQueryDto,
  BulkEditCustomersDto,
} from './dto/bulk-edit-customers.dto';

/**
 * Edición masiva de clientes.
 *
 * Superficie HTTP hermana de `CustomersBulkController` (carga masiva desde
 * Excel/JSON) y de `CustomersController` (CRUD individual). Prefijo anidado
 * propio para no ensuciar el controller de clientes ni chocar con su
 * `@Get(':id')`: las rutas de aquí tienen cuatro segmentos
 * (`store/customers/bulk-edit/…`), así que nunca caen en `:id`.
 *
 * ## Permisos
 *
 * Editar en lote exige EXACTAMENTE lo mismo que editar un cliente:
 * `store:customers:update` en el POST. Las lecturas del panel (listado e ids)
 * exigen `store:customers:read`, igual que el listado individual. No hay
 * permiso nuevo: no se está concediendo ninguna capacidad que el CRUD no
 * concediera ya, solo aplicándola a N filas.
 *
 * `PermissionsGuard` resuelve por NOMBRE además de por ruta, y estas rutas no
 * están sembradas con `path`/`method`, así que el nombre es la vía efectiva.
 *
 * ## Tope de lote
 *
 * Lo impone `BulkEditCustomersDto` (`@ArrayMaxSize(MAX_BULK_EDIT_CUSTOMER_IDS)`
 * = 100) a través del `ValidationPipe` global. El controller no re-valida: 101
 * ids devuelven 400 `SYS_VALIDATION_001` antes de entrar aquí, y el frontend
 * trocea en lotes de 100.
 */
@Controller('store/customers/bulk-edit')
@UseGuards(PermissionsGuard)
export class CustomersBulkEditController {
  private readonly logger = new Logger(CustomersBulkEditController.name);

  constructor(
    private readonly customersBulkEditService: CustomersBulkEditService,
    private readonly customersService: CustomersService,
    private readonly segmentQuery: CrmSegmentQueryService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Dry-run: cuenta qué cambiaría por cliente sin escribir nada.
   *
   * Es POST y no GET porque el cuerpo lleva la selección de ids y el objeto de
   * cambios propuestos.
   */
  @ApiOperation({
    summary:
      'Mostrar qué cambiaría en cada cliente de la selección antes de aplicar una edición masiva',
  })
  @Post('preview')
  @Permissions('store:customers:update')
  async preview(
    @Req() request: AuthenticatedRequest,
    @Body() dto: BulkEditCustomersDto,
  ) {
    const storeId = this.requireStoreId(request);
    const result = await this.customersBulkEditService.preview(storeId, dto);
    return this.responseService.success(
      result,
      'Previsualización de edición masiva de clientes generada exitosamente',
    );
  }

  /**
   * Aplica los cambios. Devuelve el resultado por cliente: un `failed > 0`
   * sigue siendo una respuesta HTTP exitosa porque la operación es
   * parcialmente tolerante a fallos (la fila que falla no aborta el lote).
   */
  @ApiOperation({
    summary:
      'Aplicar una edición masiva sobre varios clientes a la vez: datos de la persona, datos fiscales, tarifa y etiquetas CRM',
  })
  @Post()
  @Permissions('store:customers:update')
  async apply(
    @Req() request: AuthenticatedRequest,
    @Body() dto: BulkEditCustomersDto,
  ) {
    const storeId = this.requireStoreId(request);
    const result = await this.customersBulkEditService.apply(storeId, dto);

    if (result.failed > 0) {
      this.logger.warn(
        `Edición masiva de clientes con ${result.failed} fallo(s) de ${result.total} (store=${storeId})`,
      );
      return this.responseService.updated(
        result,
        'Edición masiva completada con algunos errores',
      );
    }

    return this.responseService.updated(
      result,
      'Edición masiva completada exitosamente',
    );
  }

  /**
   * Ids que satisfacen un filtro, para "seleccionar todos los que cumplen" sin
   * traer las filas completas.
   */
  @ApiOperation({
    summary: 'Listar los ids de clientes que cumplen un filtro del panel masivo',
  })
  @Get('ids')
  @Permissions('store:customers:read')
  async ids(
    @Req() request: AuthenticatedRequest,
    @Query() filters: BulkCustomerFilterDto,
  ) {
    const storeId = this.requireStoreId(request);
    const result = await this.customersBulkEditService.listIds(
      storeId,
      await this.resolveFilters(storeId, filters),
    );
    return this.responseService.success(result);
  }

  /** Página del panel de selección, con el mismo filtro que el endpoint de ids. */
  @ApiOperation({
    summary: 'Listar clientes filtrados para el panel de edición masiva',
  })
  @Get('list')
  @Permissions('store:customers:read')
  async list(
    @Req() request: AuthenticatedRequest,
    @Query() query: BulkCustomerListQueryDto,
  ) {
    const storeId = this.requireStoreId(request);
    const result = await this.customersBulkEditService.listPage(
      storeId,
      { ...(await this.resolveFilters(storeId, query)), page: query.page, limit: query.limit },
    );
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Clientes obtenidos exitosamente',
    );
  }

  /**
   * Compila los segmentos pedidos a ids de cliente con el MISMO motor de reglas
   * que el listado de clientes (`CrmSegmentQueryService`), y descarta cualquier
   * segmento de otra tienda sin evaluarlo.
   *
   * Esto es lo que hace que «seleccionar todos los que cumplen el filtro»
   * signifique lo mismo que el listado muestra: si el segmento es dinámico se
   * resuelven sus reglas, no una tabla de miembros que puede estar vacía.
   */
  private async resolveFilters(
    storeId: number,
    filters: BulkCustomerFilterDto,
  ): Promise<BulkCustomerFilters> {
    const segmentIds = filters.segment_ids ?? [];
    if (segmentIds.length === 0) {
      return filters;
    }

    const saved = await this.customersService.segmentsOfStore(storeId, segmentIds);
    const ids = new Set<number>();
    const now = new Date();
    for (const segment of saved) {
      const resolved = await this.segmentQuery.resolveSaved(
        {
          id: segment.id,
          filter: segment.filter ?? MANUAL_SEGMENT_FILTER,
          is_dynamic: segment.is_dynamic,
        },
        now,
      );
      for (const id of await this.segmentQuery.memberIds(resolved)) {
        ids.add(id);
      }
    }
    return { ...filters, customer_ids: [...ids] };
  }

  /**
   * Sin `store_id` no hay scope de tienda, y sin scope no hay operación: un lote
   * sin tienda no puede filtrarse. Se rechaza antes de tocar la base.
   */
  private requireStoreId(request: AuthenticatedRequest): number {
    const storeId = request?.user?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }
    return storeId;
  }
}
