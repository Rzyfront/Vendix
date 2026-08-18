import {
  Controller,
  Post,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionManualPaymentService } from '../../../store/subscriptions/services/subscription-manual-payment.service';
import { SubscriptionPaymentService } from '../../../store/subscriptions/services/subscription-payment.service';
import { ManualPaymentDto } from '../dto';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';

/**
 * Herramientas MANUALES de recuperación sobre una factura de plataforma, desde
 * el panel de superadmin. Es el único controlador montado en
 * `superadmin/subscriptions/invoices`, así que las operaciones sobre facturas
 * viven acá y no en `active-subscriptions.controller.ts`, cuyo prefijo
 * (`superadmin/subscriptions/active`) produciría rutas incorrectas.
 *
 * Las dos herramientas son complementarias y responden a la misma pregunta —
 * "el dinero entró pero el sistema no se enteró, ¿cómo lo cierro?":
 *
 *   - `manual-payment`     → el dinero llegó FUERA de la pasarela
 *                            (transferencia, consignación): se registra a mano.
 *   - `sync-from-gateway`  → el dinero llegó POR la pasarela pero el webhook se
 *                            perdió: se le vuelve a preguntar a Wompi.
 */
@ApiTags('Superadmin Subscriptions - Invoice Recovery')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
@Controller('superadmin/subscriptions/invoices')
export class ManualPaymentController {
  constructor(
    private readonly manualPaymentService: SubscriptionManualPaymentService,
    private readonly paymentService: SubscriptionPaymentService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':id/manual-payment')
  @Permissions('superadmin:subscriptions')
  async recordManualPayment(
    @Param('id') id: string,
    @Body() dto: ManualPaymentDto,
  ) {
    const invoiceId = parseInt(id, 10);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_VALIDATION);
    }

    const user = RequestContextService.getContext();
    await this.manualPaymentService.recordManualPayment(invoiceId, {
      bankReference: dto.bank_reference,
      paidAt: new Date(dto.paid_at),
      amount: new Prisma.Decimal(dto.amount),
      recordedByUserId: user?.user_id ?? 0,
    });

    return this.responseService.success(null, 'Manual payment recorded');
  }

  /**
   * Conciliación manual contra la pasarela — la herramienta que FALTÓ el
   * 17/08/2026.
   *
   * Ese día un pago Wompi quedó APPROVED, el webhook no se procesó, el
   * reconciliador no alcanzó a recuperarlo antes de que el cron anulara la
   * factura, y desde el panel de superadmin no existía ninguna forma de forzar
   * la conciliación: hubo que reparar la base de datos a mano. El carril de
   * tenant sí tenía este endpoint
   * (`store/subscriptions/invoices/:invoiceId/sync-from-gateway`), pero un
   * pago de plataforma perdido lo atiende soporte, no el comerciante.
   *
   * Espejo exacto del de tenant salvo por el contexto: acá NO hay `store_id`
   * y por lo tanto tampoco la comprobación de pertenencia de la factura a la
   * tienda del llamante. Eso es correcto y deliberado — el superadmin opera
   * cross-tenant por definición, y el aislamiento lo dan `RolesGuard` +
   * `@Roles(SUPER_ADMIN)`, no un filtro por tienda.
   *
   * Delega íntegramente en `syncInvoiceFromGateway`, que reconsulta Wompi por
   * la referencia del pago y reutiliza los handlers del webhook
   * (`markPaymentSucceededFromWebhook`), con dedup en `webhook_event_dedup`
   * bajo `processor='wompi_sync'`. Es idempotente: repetir la llamada no
   * duplica cobros ni comisiones.
   *
   * Devuelve el resultado del servicio tal cual (`status` discriminado) para
   * que el operador vea qué dijo la pasarela, no una interpretación nuestra.
   */
  @Post(':id/sync-from-gateway')
  // El seed no declara la fila `superadmin:subscriptions` a secas (ver
  // `permissions-roles.seed.ts`), así que se usa el permiso de escritura que sí
  // existe. En la práctica `PermissionsGuard` hace bypass para SUPER_ADMIN y
  // `RolesGuard` ya cierra la puerta a todo lo demás; el decorador documenta la
  // intención y deja el endpoint listo por si un rol de soporte lo hereda.
  @Permissions('superadmin:subscriptions:update')
  @ApiOperation({
    summary:
      'Fuerza la conciliación de una factura de plataforma contra Wompi (recuperación manual de pago perdido)',
  })
  async syncInvoiceFromGateway(@Param('id', ParseIntPipe) id: number) {
    const result = await this.paymentService.syncInvoiceFromGateway(id);

    if (result.status === 'pending') {
      return this.responseService.success(result, 'Pago aún pendiente');
    }
    if (result.status === 'no_transaction') {
      return this.responseService.success(result, 'Sin transacción asociada');
    }
    if (result.status === 'failed') {
      return this.responseService.success(result, 'Pago rechazado');
    }
    return this.responseService.success(result, 'Pago confirmado');
  }
}
