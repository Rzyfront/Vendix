import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import {
  BulkInvoiceExecuteDto,
  BulkInvoicePreviewDto,
} from '../dto/bulk-invoice-orders.dto';
import { OrdersBulkInvoicingService } from './orders-bulk-invoicing.service';

/**
 * Facturación electrónica masiva de órdenes (`store/orders/bulk/invoice`).
 *
 * Vive en el módulo de facturación, no en `OrdersBulkController`: así evita un
 * import directo Orders → OneShotEmissionService sobre el ciclo
 * Invoicing ↔ Orders. El prefijo es más específico que `store/orders` y no
 * choca con `GET store/orders/:id` (otro verbo).
 *
 * Exige `invoicing:write` POR NOMBRE además del `PermissionsGuard`: éste
 * resuelve con OR contra el match por ruta (`startsWith`), y
 * `store:orders:create` (`POST /api/store/orders`) cubriría cualquier POST
 * anidado — quien sólo puede crear órdenes no debe poder emitir facturas.
 */
@Controller('store/orders/bulk/invoice')
@UseGuards(PermissionsGuard)
export class OrdersBulkInvoicingController {
  private readonly logger = new Logger(OrdersBulkInvoicingController.name);

  constructor(
    private readonly service: OrdersBulkInvoicingService,
    private readonly response_service: ResponseService,
  ) {}

  private assertNamedPermission(request: any, required: string): void {
    const roles: string[] = request?.user?.roles ?? [];
    if (roles.includes(UserRole.SUPER_ADMIN)) return;
    const granted: Array<{ name?: string; status?: string }> =
      request?.user?.permissions ?? [];
    const has_it = granted.some(
      (perm) => perm?.name === required && perm?.status === 'active',
    );
    if (!has_it) {
      this.logger.warn(
        `Bloqueado por refuerzo de permiso: falta '${required}' (user=${request?.user?.id ?? 'desconocido'})`,
      );
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }
  }

  /** Vista previa de sólo lectura: nada se emite ni consume consecutivo. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Permissions('invoicing:write')
  async preview(@Body() dto: BulkInvoicePreviewDto, @Req() request: any) {
    this.assertNamedPermission(request, 'invoicing:write');
    const result = await this.service.preview(dto);
    return this.response_service.success(
      result,
      'Vista previa de la facturación masiva',
    );
  }

  /** Emite hasta 5 órdenes en secuencia; un fallo no detiene a las demás (HTTP 200). */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Permissions('invoicing:write')
  async execute(@Body() dto: BulkInvoiceExecuteDto, @Req() request: any) {
    this.assertNamedPermission(request, 'invoicing:write');
    const result = await this.service.execute(dto);
    return this.response_service.success(
      result,
      result.failed > 0
        ? 'Facturación masiva completada con algunos errores'
        : 'Facturación masiva completada',
    );
  }
}
