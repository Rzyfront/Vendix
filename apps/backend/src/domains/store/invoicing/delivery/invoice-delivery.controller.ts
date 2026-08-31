import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '../../../../common/responses/response.service';
import { InvoiceDeliveryService } from './invoice-delivery.service';
import { DeliverInvoiceDto } from './dto/deliver-invoice.dto';

/**
 * No colisiona con el `@Get(':id')`/`@Patch(':id')` de `InvoicingController`
 * (mismo prefijo `store/invoicing`): esos son rutas de 3 segmentos
 * (`store/invoicing/:id`), ésta es de 4 (`store/invoicing/:id/deliver`), así
 * que Express no las confunde por conteo de segmentos — a diferencia del caso
 * real que `profiles.module.ts` documenta (`store/invoicing/profiles`, 3
 * segmentos, mismo conteo que `:id`). Por eso este controller SÍ puede vivir
 * dentro de su propio módulo (patrón Nest estándar), sin el desdoblamiento de
 * `ProfilesModule`/`ProfilesController`.
 *
 * Mantiene `@RequireModuleFlow('invoicing')`: reenviar una factura es
 * operación normal del área fiscal, no una consulta de estado — el propio
 * guard advierte no eximir de esta compuerta a operaciones día a día.
 */
@Controller('store/invoicing')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('invoicing')
export class InvoiceDeliveryController {
  constructor(
    private readonly invoice_delivery_service: InvoiceDeliveryService,
    private readonly response_service: ResponseService,
  ) {}

  @Post(':id/deliver')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async deliver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverInvoiceDto,
  ) {
    const result = await this.invoice_delivery_service.deliver(id, dto);
    return this.response_service.success(
      result,
      `Factura reenviada a ${result.recipient}`,
    );
  }
}
