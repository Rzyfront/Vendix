import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { FinancialAnalyticsService } from '../services/financial-analytics.service';

/**
 * Bug 5 / Bug 11 — listener cross-domain que invalida el cache del dashboard
 * financiero cuando cambian las fuentes que alimentan el P&L.
 *
 * Eventos escuchados (todos NO se solapan con los que ya usa
 * `AccountingEventsListener` para asientos — patrón consistente con
 * `SubscriptionStateListener` que también invalida cache de analytics
 * ante eventos de suscripción sin tocar el dominio contable):
 *
 *  - `expense.state_changed`  (emitido por ExpenseFlowService approve/pay/cancel/refund)
 *  - `payment.received`       (emitido por payments.service.ts:1267, 3860; NO OrderFlowService)
 *  - `refund.completed`       (emitido por refund-flow.service.ts:379)
 *
 * Cada handler resuelve el `store_id` del payload (o del RequestContext como
 * fallback) y llama `invalidateCache(storeId)`. Si el listener falla, el catch
 * interno de `invalidateCache` previene que el error afecte el flujo principal.
 */
@Injectable()
export class FinancialAnalyticsCacheInvalidationListener {
  private readonly logger = new Logger(FinancialAnalyticsCacheInvalidationListener.name);

  constructor(
    private readonly financialAnalytics: FinancialAnalyticsService,
  ) {}

  @OnEvent('expense.state_changed')
  async handleExpenseStateChanged(payload: {
    store_id?: number;
    organization_id?: number;
  }): Promise<void> {
    const storeId = this.resolveStoreId(payload);
    if (!storeId) return;
    await this.financialAnalytics.invalidateCache(storeId);
    this.logger.log(`Cache invalidated after expense.state_changed (store=${storeId})`);
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(payload: {
    store_id?: number;
    organization_id?: number;
  }): Promise<void> {
    const storeId = this.resolveStoreId(payload);
    if (!storeId) return;
    await this.financialAnalytics.invalidateCache(storeId);
    this.logger.log(`Cache invalidated after payment.received (store=${storeId})`);
  }

  @OnEvent('refund.completed')
  async handleRefundCompleted(payload: {
    store_id?: number;
    organization_id?: number;
  }): Promise<void> {
    const storeId = this.resolveStoreId(payload);
    if (!storeId) return;
    await this.financialAnalytics.invalidateCache(storeId);
    this.logger.log(`Cache invalidated after refund.completed (store=${storeId})`);
  }

  private resolveStoreId(payload: { store_id?: number }): number | null {
    if (payload?.store_id) return payload.store_id;
    return null;
  }
}
