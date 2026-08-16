import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
  Request,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { DianMunicipalitiesService } from './dian-municipalities.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  AddressQueryDto,
  DianMunicipalityQueryDto,
  DianMunicipalityResolveQueryDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/addresses')
@UseGuards(PermissionsGuard)
export class AddressesController {
  constructor(
    private readonly addressesService: AddressesService,
    private readonly dianMunicipalitiesService: DianMunicipalitiesService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Catálogo Divipola buscable (1122 municipios) para el selector de municipio
   * del cliente.
   *
   * Vive en este controlador, y no en `invoicing`, por permisos: el selector
   * aparece en TODA captura de dirección (clientes, pedidos, POS, membresías,
   * despacho), y quien captura una dirección no necesariamente tiene permisos
   * de facturación. `store:addresses:read` es exactamente el conjunto correcto.
   *
   * Declarado ANTES de `@Get(':id')` para no depender del orden de resolución
   * de rutas de Nest.
   */
  @Get('dian/municipalities')
  @Permissions('store:addresses:read')
  async searchDianMunicipalities(@Query() query: DianMunicipalityQueryDto) {
    const result = this.dianMunicipalitiesService.search(
      query.search,
      query.limit,
    );
    return this.responseService.paginated(
      result.items,
      result.total,
      1,
      query.limit ?? 20,
      'Municipios DANE obtenidos exitosamente',
    );
  }

  /**
   * Traduce los NOMBRES que devuelve un geocodificador a un código DANE.
   *
   * Nominatim nunca entrega Divipola (`geocoding.service.ts:440` devuelve
   * `municipality_code: null` explícitamente), así que sin esto una dirección
   * ubicada en el mapa seguiría sin código y volvería a bloquear la emisión.
   *
   * Devuelve `data: null` cuando no resuelve. Ese `null` es la respuesta útil:
   * significa «que lo elija el operador», nunca «pon Bogotá».
   */
  @Get('dian/municipalities/resolve')
  @Permissions('store:addresses:read')
  async resolveDianMunicipality(
    @Query() query: DianMunicipalityResolveQueryDto,
  ) {
    const match = this.dianMunicipalitiesService.resolveByName(
      query.city,
      query.department,
    );
    return this.responseService.success(
      match,
      match
        ? 'Municipio DANE resuelto exitosamente'
        : 'No se pudo resolver el municipio DANE',
    );
  }

  /** Los 33 departamentos DANE. Lectura de referencia. */
  @Get('dian/departments')
  @Permissions('store:addresses:read')
  async listDianDepartments() {
    return this.responseService.success(
      this.dianMunicipalitiesService.listDepartments(),
      'Departamentos DANE obtenidos exitosamente',
    );
  }

  @Post()
  @Permissions('store:addresses:create')
  async create(
    @Body() createAddressDto: CreateAddressDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.addressesService.create(
      createAddressDto,
      req.user,
    );
    return this.responseService.created(result, 'Dirección creada exitosamente');
  }

  @Get()
  @Permissions('store:addresses:read')
  async findAll(
    @Query() query: AddressQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.addressesService.findAll(query, req.user);

    if (result.data && result.meta) {
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Direcciones obtenidas exitosamente',
      );
    }
    return this.responseService.success(
      result,
      'Direcciones obtenidas exitosamente',
    );
  }

  @Get('store/:storeId')
  @Permissions('store:addresses:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.addressesService.findByStore(storeId, req.user);

    return this.responseService.success(
      result,
      'Direcciones de la tienda obtenidas exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:addresses:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.addressesService.findOne(id, req.user);
    return this.responseService.success(
      result,
      'Dirección obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:addresses:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAddressDto: UpdateAddressDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.addressesService.update(
      id,
      updateAddressDto,
      req.user,
    );
    return this.responseService.updated(
      result,
      'Dirección actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:addresses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.addressesService.remove(id, req.user);
    return this.responseService.deleted('Dirección eliminada exitosamente');
  }
}
