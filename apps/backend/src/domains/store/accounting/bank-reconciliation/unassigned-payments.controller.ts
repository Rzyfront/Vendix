import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  ModuleFlowGuard,
  RequireModuleFlow,
} from '../../../../common/guards/module-flow.guard';
import { UseGuards } from '@nestjs/common';
import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { UnassignedPaymentsService } from './unassigned-payments.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { QueryUnassignedPaymentsDto } from './dto/query-unassigned-payments.dto';
import { AssignPaymentAccountDto } from './dto/assign-payment-account.dto';

/**
 * E.2 (CP-POLLO-ARABE-727 / cross-ref QUI-728) — pagos sin asignar.
 *
 * Pantalla propia dentro del módulo de accounting: lista `payments WHERE
 * bank_account_id IS NULL` y permite asignar la cuenta de destino. NO toca el
 * matching existente (bank_transaction_id ↔ accounting_entry_id), que opera
 * sobre otro modelo de datos.
 *
 * Rutas bajo `store/accounting/bank-reconciliation/payments`:
 *  - GET   /unassigned           → lista paginada de pagos sin asignar
 *  - GET   /assignable-accounts  → cuentas activas para el selector
 *  - PATCH /:payment_id/assign-account → asigna `bank_account_id`
 */
@Controller('store/accounting/bank-reconciliation/payments')
@UseGuards(ModuleFlowGuard, PermissionsGuard)
@RequireModuleFlow('accounting')
export class UnassignedPaymentsController {
  constructor(
    private readonly unassigned_payments_service: UnassignedPaymentsService,
    private readonly response_service: ResponseService,
  ) {}

  @Get('unassigned')
  @Permissions('store:accounting:bank_reconciliation:read')
  async findUnassigned(@Query() query: QueryUnassignedPaymentsDto) {
    const { data, total, page, limit, total_amount } =
      await this.unassigned_payments_service.findUnassigned(query);
    const response = this.response_service.paginated(data, total, page, limit);
    // `createPaginationMeta` es compartido por toda la plataforma: el total en
    // dinero se agrega aquí, sobre la respuesta ya armada, en vez de tocar el
    // helper que arma la meta de cada listado del backend.
    return { ...response, meta: { ...response.meta, total_amount } };
  }

  @Get('assignable-accounts')
  @Permissions('store:accounting:bank_reconciliation:read')
  async findAssignableAccounts() {
    const result =
      await this.unassigned_payments_service.findAssignableAccounts();
    return this.response_service.success(result);
  }

  @Patch(':payment_id/assign-account')
  @Permissions('store:accounting:bank_reconciliation:update')
  async assignAccount(
    @Param('payment_id') payment_id: string,
    @Body() dto: AssignPaymentAccountDto,
  ) {
    const { payment, total_amount } =
      await this.unassigned_payments_service.assignAccount(
        +payment_id,
        dto.bank_account_id,
      );
    // `data` mantiene la forma del pago (el frontend ya la consume); el monto
    // total restante va en `meta` para que la tarjeta "Monto Total" se refresque
    // sin un round-trip extra a `findUnassigned`.
    return this.response_service.success(
      payment,
      'Bank account assigned successfully',
      { total_amount },
    );
  }
}
