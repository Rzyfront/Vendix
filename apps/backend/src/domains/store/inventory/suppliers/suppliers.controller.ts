import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { supplier_state_enum } from '@prisma/client';
import { SuppliersService } from './suppliers.service';
import { CreateInventorySupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { UpdateSupplierStateDto } from './dto/update-supplier-state.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/inventory/suppliers')
@UseGuards(PermissionsGuard)
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:inventory:suppliers:create')
  async create(@Body() createSupplierDto: CreateInventorySupplierDto) {
    // Sin try/catch: `responseService.error()` consumía la excepción y Nest
    // respondía 201 con `success:false` y el statusCode real enterrado en el
    // body, además de filtrar al cliente el texto crudo de Prisma con rutas
    // internas del servidor. Dejando que la excepción salga del handler,
    // `AllExceptionsFilter` emite el status correcto y un `error_code`.
    const result = await this.suppliersService.create(createSupplierDto);
    return this.responseService.created(result, 'Proveedor creado exitosamente');
  }

  @Get()
  @Permissions('store:inventory:suppliers:read')
  async findAll(@Query() query: SupplierQueryDto) {
    try {
      const result = await this.suppliersService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Proveedores obtenidos exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Proveedores obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los proveedores',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('active')
  @Permissions('store:inventory:suppliers:read')
  async findActive(@Query() query: SupplierQueryDto) {
    try {
      const result = await this.suppliersService.findActive(query);
      return this.responseService.success(
        result,
        'Proveedores activos obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los proveedores activos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // Sin try/catch: el servicio lanza VendixHttpException / HttpException en
  // todos sus caminos, y AllExceptionsFilter solo emite el status real cuando la
  // excepción SALE del handler. Capturarla haría responder HTTP 200 con el 404
  // enterrado en el body (ver vendix-error-handling).
  @Get(':id')
  @Permissions('store:inventory:suppliers:read')
  async findOne(@Param('id') id: string) {
    const result = await this.suppliersService.findOne(+id);
    return this.responseService.success(
      result,
      'Proveedor obtenido exitosamente',
    );
  }

  @Get(':id/products')
  @Permissions('store:inventory:suppliers:read')
  async findSupplierProducts(@Param('id') id: string) {
    try {
      const result = await this.suppliersService.findSupplierProducts(+id);
      return this.responseService.success(
        result,
        'Productos del proveedor obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los productos del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /**
   * QUI-656 — resumen del perfil del proveedor.
   *
   * Permiso de LECTURA de proveedores, el mismo que ya gobierna `GET /:id`: el
   * perfil no expone nada que el listado y el detalle no expusieran ya, solo lo
   * reúne. Pedir un permiso nuevo dejaría el perfil invisible para roles que hoy
   * sí pueden ver al proveedor.
   */
  @Get(':id/summary')
  @Permissions('store:inventory:suppliers:read')
  async getSupplierSummary(@Param('id') id: string) {
    try {
      const result = await this.suppliersService.getSupplierSummary(+id);
      return this.responseService.success(
        result,
        'Resumen del proveedor obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el resumen del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /** QUI-656 — historial paginado de órdenes de compra del proveedor. */
  @Get(':id/purchase-orders')
  @Permissions('store:inventory:suppliers:read')
  async getSupplierPurchaseOrders(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const result = await this.suppliersService.getSupplierPurchaseOrders(
        +id,
        page ? +page : 1,
        limit ? +limit : 20,
      );
      return this.responseService.paginated(
        result.data,
        result.total,
        result.page,
        result.limit,
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  /** QUI-656 — documentos de cuentas por pagar del proveedor. */
  @Get(':id/payables')
  @Permissions('store:inventory:suppliers:read')
  async getSupplierPayables(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const result = await this.suppliersService.getSupplierPayables(
        +id,
        page ? +page : 1,
        limit ? +limit : 20,
      );
      return this.responseService.paginated(
        result.data,
        result.total,
        result.page,
        result.limit,
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las cuentas por pagar del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:inventory:suppliers:update')
  async update(
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
  ) {
    const result = await this.suppliersService.update(+id, updateSupplierDto);
    return this.responseService.updated(
      result,
      'Proveedor actualizado exitosamente',
    );
  }

  /**
   * Transición activo ↔ inactivo. Un proveedor inactivo sigue visible en el
   * listado pero deja de ofrecerse en selectores de OC, remisiones y rutas.
   */
  @Patch(':id/state')
  @Permissions('store:inventory:suppliers:update')
  async setState(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierStateDto,
  ) {
    const result = await this.suppliersService.setState(+id, dto.state);
    return this.responseService.updated(
      result,
      dto.state === supplier_state_enum.active
        ? 'Proveedor activado exitosamente'
        : 'Proveedor inactivado exitosamente',
    );
  }

  /**
   * Archiva el proveedor. No borra la fila — su historia contable queda
   * intacta — pero lo saca de listados y selectores. Se rechaza con 409 si
   * tiene documentos abiertos.
   */
  @Delete(':id')
  @Permissions('store:inventory:suppliers:delete')
  async remove(@Param('id') id: string) {
    await this.suppliersService.remove(+id);
    return this.responseService.deleted('Proveedor archivado exitosamente');
  }
}
