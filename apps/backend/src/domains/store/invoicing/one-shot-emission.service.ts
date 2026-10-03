import { Injectable } from '@nestjs/common';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PosFiscalEmissionService } from './pos/pos-fiscal-emission.service';
import { PosFiscalStatus } from './pos/pos-fiscal-status.interface';
import { assertNoActiveFinancialSplit } from '../orders/shared/financial-split-policy';

export type OneShotEmissionState = 'issued' | 'pending' | 'failed';

/** Respuesta de los endpoints de facturación en un solo paso. */
export interface OneShotEmissionResult {
  state: OneShotEmissionState;
  invoice_id: number | null;
  invoice_number: string | null;
  /** Estado del documento (`accepted`, `rejected`, `validated`, `draft`…). */
  dian_status: string | null;
  message: string | null;
}

/**
 * Facturación en UN solo paso desde el detalle de la orden: crear + prevalidar
 * + transmitir. Reusa el motor idempotente del carril POS
 * (`PosFiscalEmissionService`), que NO depende del canal de la orden.
 *
 * Reintento: volver a llamar reusa el documento existente (rejected/failed →
 * se revalida/retransmite) sin crear otra fila ni consumir otro consecutivo.
 */
@Injectable()
export class OneShotEmissionService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly emission: PosFiscalEmissionService,
  ) {}

  async emitOrder(order_id: number): Promise<OneShotEmissionResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { id: true, active_financial_split_id: true },
    });
    if (!order) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_FIND_003,
        `No se encontró el pedido #${order_id} en esta tienda.`,
        { order_id },
      );
    }
    // Orden dividida: se factura por cuenta, nunca la orden completa.
    assertNoActiveFinancialSplit(order);
    return this.toResult(await this.emission.emitForOrder(order_id));
  }

  async emitFinancialAccount(account_id: number): Promise<OneShotEmissionResult> {
    return this.toResult(await this.emission.emitForFinancialAccount(account_id));
  }

  toResult(status: PosFiscalStatus): OneShotEmissionResult {
    const state: OneShotEmissionState =
      status.state === 'issued' || status.state === 'contingency'
        ? 'issued'
        : status.state === 'pending'
          ? 'pending'
          : 'failed'; // failed | not_applicable
    return {
      state,
      invoice_id: status.invoice_id,
      invoice_number: status.invoice_number,
      dian_status: status.invoice_status,
      message: status.message || null,
    };
  }
}
