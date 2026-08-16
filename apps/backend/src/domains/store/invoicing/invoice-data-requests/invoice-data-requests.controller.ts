import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { QueryInvoiceDataRequestsDto } from './dto/query-invoice-data-requests.dto';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

@Controller('store/invoice-data-requests')
@UseGuards(RolesGuard, PermissionsGuard)
export class InvoiceDataRequestsController {
  constructor(
    private readonly service: InvoiceDataRequestsService,
    private readonly responseService: ResponseService,
  ) {}

  /**
   * Contexto de tienda ausente.
   *
   * Los dos manejadores lanzaban `new Error('Store context required')`, que el
   * `HttpExceptionFilter` no reconoce y degrada a `SYS_INTERNAL_001` con 500: un
   * usuario de organización sin tienda seleccionada veía «Error interno del
   * servidor» sobre una condición perfectamente describible. `STORE_CONTEXT_001`
   * ya existía en el catálogo con su 400 y su mensaje.
   */
  private requireStoreId(req: AuthenticatedRequest): number {
    const store_id = req.user?.store_id;
    if (!store_id) {
      throw new VendixHttpException(
        ErrorCodes.STORE_CONTEXT_001,
        'Selecciona una tienda para ver las solicitudes de factura.',
      );
    }
    return store_id;
  }

  @Get()
  async findAll(
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryInvoiceDataRequestsDto,
  ) {
    const store_id = this.requireStoreId(req);
    const { data, total, page, limit } = await this.service.findByStore(
      store_id,
      query,
    );
    return this.responseService.paginated(data, total, page, limit);
  }

  /**
   * Conteo por estado para las tarjetas del listado.
   *
   * Va antes que cualquier ruta con parámetro y no colisiona con ninguna: la
   * familia sólo expone `POST :id/process`. Se separa del listado porque el
   * conteo NO debe seguir el filtro de estado — ver `summaryByStore`.
   */
  @Get('summary')
  async summary(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
  ) {
    const store_id = this.requireStoreId(req);
    const result = await this.service.summaryByStore(store_id, search);
    return this.responseService.success(result);
  }

  @Post(':id/process')
  async process(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const store_id = this.requireStoreId(req);
    const result = await this.service.processRequest(id, store_id);
    return this.responseService.success(
      result,
      'Solicitud procesada correctamente',
    );
  }
}
