import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestContextService } from '@common/context/request-context.service';
import {
  buildTaxBreakdown,
  scaleBreakdownToTotal,
} from 'src/common/interfaces/tax-breakdown.interface';
import {
  RefundCalculationService,
  RefundCalculationResult,
} from './refund-calculation.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';
import { CreateRefundDto } from '../dto/create-refund.dto';
import { SettingsService } from '../../../settings/settings.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SerialNumberEnforcementService } from '../../../inventory/serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../../inventory/serial-numbers/inventory-serial-numbers.service';
import { WalletService } from '../../../wallet/wallet.service';
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';

const REFUNDABLE_STATES = ['delivered', 'finished'];

@Injectable()
export class RefundFlowService {
  private readonly logger = new Logger(RefundFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly calculationService: RefundCalculationService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly settingsService: SettingsService,
    private readonly sessionsService: SessionsService,
    private readonly movementsService: MovementsService,
    // QUI-431 — serial pool + enforcement (no-op for non-serialized products).
    private readonly serialEnforcement: SerialNumberEnforcementService,
    private readonly serialNumbers: InventorySerialNumbersService,
    // FIX/Wallet refund: acreditar el saldo del cliente dentro del mismo
    // $transaction del refund para garantizar atomicidad.
    private readonly walletService: WalletService,
    private readonly walletBalanceService: WalletBalanceService,
  ) {}

  async previewRefund(
    orderId: number,
    dto: CreateRefundDto,
  ): Promise<RefundCalculationResult> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true, state: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    if (!REFUNDABLE_STATES.includes(order.state)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
      );
    }

    return this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
    });
  }

  async createRefund(orderId: number, dto: CreateRefundDto) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      include: {
        stores: { select: { id: true, organization_id: true } },
        order_items: {
          include: {
            products: { select: { id: true, track_inventory: true } },
            product_variants: { select: { id: true } },
          },
        },
        payments: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    if (!REFUNDABLE_STATES.includes(order.state)) {
      throw new BadRequestException(
        `Cannot refund order in state '${order.state}'. Refunds are only allowed from: [${REFUNDABLE_STATES.join(', ')}]`,
      );
    }

    // Calculate the refund breakdown
    const calculation = await this.calculationService.calculate({
      order_id: orderId,
      items: dto.items,
      include_shipping: dto.include_shipping,
    });

    const userId = RequestContextService.getUserId();

    // Execute everything in a transaction
    return this.prisma
      .$transaction(async (tx) => {
        // 1. Create refund record
        const refund = await tx.refunds.create({
          data: {
            order_id: orderId,
            amount: calculation.total_refund,
            subtotal_refund: calculation.subtotal_refund,
            tax_refund: calculation.tax_refund,
            shipping_refund: calculation.shipping_refund,
            reason: dto.reason,
            notes: dto.notes,
            refund_method: dto.refund_method,
            state: 'processing',
            processed_by_user_id: userId,
            requested_at: new Date(),
          },
        });

        // 2. Create refund_items. Capture the created id per order_item so the
        // serial-return step (QUI-431) can link serials to the refund line.
        const refundItemIdByOrderItem = new Map<number, number>();
        for (const item of calculation.items) {
          const refundItem = await tx.refund_items.create({
            data: {
              refund_id: refund.id,
              order_item_id: item.order_item_id,
              quantity: item.quantity,
              refund_amount: item.refund_amount,
              tax_amount: item.tax_amount,
              discount_amount: item.discount_amount,
              inventory_action: item.inventory_action,
              location_id: item.location_id,
              reason: item.reason,
            },
          });
          refundItemIdByOrderItem.set(item.order_item_id, refundItem.id);
        }

        // 3. Process inventory per item
        for (const item of calculation.items) {
          if (item.inventory_action === 'no_return') continue;

          const orderItem = order.order_items.find(
            (oi) => oi.id === item.order_item_id,
          );
          if (!orderItem?.products) continue;

          if (item.inventory_action === 'restock' && item.location_id) {
            await this.stockLevelManager.updateStock(
              {
                product_id: orderItem.products.id,
                variant_id: orderItem.product_variants?.id,
                location_id: item.location_id,
                quantity_change: item.quantity,
                movement_type: 'return',
                reason: `Refund #${refund.id}: ${dto.reason}`,
                user_id: userId,
                order_item_id: orderItem.id,
                create_movement: true,
              },
              tx,
            );

            // QUI-431 — serialized product returning to sellable stock: move
            // the serials that were sold on the original order_item back to
            // `returned` then `in_stock` (reenterStock=true), snapshot them on
            // the refund line, and link them to the refund_item document.
            await this.returnSerialsForRefund(
              tx,
              orderItem.products.id,
              orderItem.id,
              refundItemIdByOrderItem.get(item.order_item_id),
              item.quantity,
              true,
            );
          } else if (
            item.inventory_action === 'write_off' &&
            item.location_id
          ) {
            await this.stockLevelManager.updateStock(
              {
                product_id: orderItem.products.id,
                variant_id: orderItem.product_variants?.id,
                location_id: item.location_id,
                quantity_change: -item.quantity,
                movement_type: 'damage',
                reason: `Refund write-off #${refund.id}: ${dto.reason}`,
                user_id: userId,
                order_item_id: orderItem.id,
                create_movement: true,
              },
              tx,
            );

            // QUI-431 — write-off of a serialized unit: the customer returned
            // it but it does NOT re-enter sellable stock (it was written off as
            // damaged). Move the serials sold on the original line to
            // `returned` (reenterStock=false), snapshot + link to refund_item.
            await this.returnSerialsForRefund(
              tx,
              orderItem.products.id,
              orderItem.id,
              refundItemIdByOrderItem.get(item.order_item_id),
              item.quantity,
              false,
            );
          }
        }

        // 4. Update payment state
        const activePayment = order.payments.find(
          (p) => p.state === 'succeeded' || p.state === 'pending',
        );
        if (activePayment) {
          await tx.payments.update({
            where: { id: activePayment.id },
            data: {
              state: calculation.is_full_refund
                ? 'refunded'
                : 'partially_refunded',
              updated_at: new Date(),
            },
          });
        }

        // 5. Update order state only if full refund
        if (calculation.is_full_refund) {
          await tx.orders.update({
            where: { id: orderId },
            data: {
              state: 'refunded',
              updated_at: new Date(),
            },
          });
        }

        // 6. Mark refund as completed
        const completedRefund = await tx.refunds.update({
          where: { id: refund.id },
          data: {
            state: 'completed',
            processed_at: new Date(),
            updated_at: new Date(),
          },
          include: {
            refund_items: {
              include: {
                order_items: true,
              },
            },
          },
        });

        // 6.5 Credit wallet if refund_method === 'wallet' — atomic con el refund.
        // Antes del fix, refund_method='wallet' no estaba ni en el DTO y el flujo
        // nunca tocaba el subsistema de wallet, así que el cliente veía "éxito"
        // pero el saldo quedaba en $0.
        if (dto.refund_method === 'wallet') {
          if (!order.customer_id) {
            throw new BadRequestException(
              'No se puede reembolsar a wallet: la orden no tiene un cliente asociado.',
            );
          }

          const wallet = await this.walletService.getOrCreateWallet(
            order.customer_id,
          );

          // Prisma en este contexto es el StorePrismaService; para operar
          // dentro de la tx externa usamos tx.wallets (mismo modelo del cliente
          // base) en lugar de delegar a WalletBalanceService.credit que abre
          // su propia transacción — eso preserva atomicidad.
          const w = await tx.wallets.findUnique({ where: { id: wallet.id } });
          if (!w || !w.is_active) {
            throw new BadRequestException(
              'Wallet del cliente no encontrada o inactiva.',
            );
          }
          const balance_before = Number(w.balance);
          const balance_after = balance_before + Number(refund.amount);

          await tx.wallets.update({
            where: { id: wallet.id },
            data: { balance: balance_after, updated_at: new Date() },
          });

          await tx.wallet_transactions.create({
            data: {
              wallet_id: wallet.id,
              type: 'credit',
              state: 'completed',
              amount: Number(refund.amount),
              balance_before,
              balance_after,
              reference_type: 'refund',
              reference_id: refund.id,
              description: `Reembolso de orden #${order.order_number}`,
              created_by: userId,
            },
          });
        }

        return completedRefund;
      })
      .then(async (completedRefund) => {
        // 7. Emit events after transaction completes
        try {
          // Preserve the original fiscal-type mix so the tax reversal posts
          // proportionally against each tax's PUC account (IVA→2408, INC→2436).
          const items = await this.prisma.order_items.findMany({
            where: { order_id: orderId },
            select: {
              order_item_taxes: {
                select: { tax_type: true, tax_amount: true },
              },
            },
          });
          const tax_breakdown = scaleBreakdownToTotal(
            buildTaxBreakdown(items.flatMap((i) => i.order_item_taxes || [])),
            Number(calculation.tax_refund || 0),
          );

          this.eventEmitter.emit('refund.completed', {
            refund_id: completedRefund.id,
            order_id: orderId,
            organization_id: order.stores?.organization_id,
            store_id: order.store_id,
            amount: calculation.total_refund,
            subtotal: calculation.subtotal_refund,
            tax: calculation.tax_refund,
            tax_amount: calculation.tax_refund,
            tax_breakdown,
            shipping: calculation.shipping_refund,
            is_full_refund: calculation.is_full_refund,
            user_id: userId,
          });

          if (calculation.is_full_refund) {
            this.eventEmitter.emit('order.status_changed', {
              store_id: order.store_id,
              order_id: orderId,
              order_number: order.order_number,
              old_state: order.state,
              new_state: 'refunded',
            });
          }
        } catch (error) {
          this.logger.error(
            `Failed to emit refund events for order #${orderId}: ${error.message}`,
          );
        }

        this.logger.log(
          `Refund #${completedRefund.id} processed for order #${orderId}: ` +
            `${calculation.total_refund.toFixed(2)} (${calculation.is_full_refund ? 'full' : 'partial'})`,
        );

        // Record cash register refund movement (non-blocking)
        if (userId) {
          this.recordRefundCashRegisterMovement(
            order.store_id,
            userId,
            calculation.total_refund,
            orderId,
          ).catch(() => {});
        }

        return completedRefund;
      });
  }

  /**
   * QUI-431 — Return the serials of a refunded line of a serialized product,
   * inside the refund transaction (`tx`).
   *
   * No-op for non-serialized products (the enforcement service short-circuits).
   *
   * Steps:
   *  1. Find the serials that were `sold` on the ORIGINAL order_item via the
   *     polymorphic junction (`sales_document_serials`, type='order_item'),
   *     limited to `qty` (the refunded quantity for partial returns).
   *  2. For each: `returnSerial(reenterStock)` — `sold → returned` and, when
   *     `reenterStock` is true, `returned → in_stock` so it rejoins the
   *     sellable pool (it retains its location_id from the sale).
   *  3. Persist the CSV snapshot on the refund_item and link each serial to the
   *     refund_item document via the junction (type='refund_item').
   */
  private async returnSerialsForRefund(
    tx: any,
    product_id: number,
    order_item_id: number,
    refund_item_id: number | undefined,
    qty: number,
    reenterStock: boolean,
  ): Promise<void> {
    if (!(await this.serialEnforcement.isSerialized(product_id, tx))) {
      return;
    }

    // Serials sold on the original order_item (FIFO so partial returns are
    // deterministic). The junction is the strong link captured at sale time.
    const links = await tx.sales_document_serials.findMany({
      where: {
        document_item_type: 'order_item',
        document_item_id: order_item_id,
      },
      orderBy: { id: 'asc' },
      take: qty,
    });
    if (links.length === 0) return;

    const returnedSerialNumbers: string[] = [];
    for (const link of links) {
      const serial = await this.serialNumbers.returnSerial(
        link.serial_number_id,
        reenterStock,
        tx,
      );
      if (serial?.serial_number) {
        returnedSerialNumbers.push(serial.serial_number);
      }

      // Strong link to the refund document line (skip if @@unique already has
      // this serial against a refund_item — re-throws SERIAL_DUP_001 otherwise).
      if (refund_item_id != null) {
        await this.serialNumbers.linkToDocument(
          link.serial_number_id,
          'refund_item',
          refund_item_id,
          tx,
        );
      }
    }

    // Immutable snapshot on the refund line (CSV of serial_number strings).
    if (refund_item_id != null && returnedSerialNumbers.length > 0) {
      await tx.refund_items.updateMany({
        where: { id: refund_item_id },
        data: { serial_numbers_snapshot: returnedSerialNumbers.join(', ') },
      });
    }
  }

  /**
   * Record a refund movement in the cash register if the feature is enabled
   * and the user has an active session. Non-blocking.
   */
  private async recordRefundCashRegisterMovement(
    storeId: number,
    userId: number,
    amount: number,
    orderId: number,
  ): Promise<void> {
    try {
      const settings = await this.settingsService.getSettings();
      const cr_settings = (settings as any)?.pos?.cash_register;
      if (!cr_settings?.enabled) return;

      const session = await this.sessionsService.getActiveSession(userId);
      if (!session) return;

      await this.movementsService.recordRefundMovement(session.id, {
        store_id: storeId,
        user_id: userId,
        amount,
        payment_method: 'cash',
        order_id: orderId,
        reference: `Refund for order #${orderId}`,
      });
    } catch {
      // Non-critical: don't fail the refund if movement recording fails
    }
  }

  async getOrderRefunds(orderId: number) {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: { id: true },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    return this.prisma.refunds.findMany({
      where: { order_id: orderId },
      include: {
        refund_items: {
          include: {
            order_items: true,
            inventory_locations: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        users: {
          select: { id: true, first_name: true, last_name: true, email: true },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }
}
