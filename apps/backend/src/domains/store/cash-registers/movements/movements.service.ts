import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class MovementsService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  async findBySession(session_id: number) {
    return this.prisma.cash_register_movements.findMany({
      where: { session_id },
      include: {
        user: { select: { id: true, first_name: true, last_name: true } },
        order: { select: { id: true, order_number: true } },
      },
      orderBy: { created_at: 'asc' },
    });
  }

  async createManualMovement(
    session_id: number,
    data: {
      type: 'cash_in' | 'cash_out';
      amount: number;
      reference?: string;
      notes?: string;
    },
  ) {
    const context = RequestContextService.getContext()!;

    const movement = await this.prisma.cash_register_movements.create({
      data: {
        session_id,
        store_id: context.store_id,
        user_id: context.user_id,
        type: data.type,
        amount: data.amount,
        payment_method: 'cash',
        reference: data.reference,
        notes: data.notes,
      },
    });

    // Emit accounting event for manual cash movement
    const store = await this.prisma.stores.findUnique({
      where: { id: movement.store_id },
      select: { organization_id: true },
    });
    if (store) {
      this.event_emitter.emit('cash_register.movement', {
        movement_id: movement.id,
        session_id: session_id,
        store_id: movement.store_id,
        organization_id: store.organization_id,
        type: data.type,
        amount: Number(data.amount),
        reference: data.reference,
        notes: data.notes,
        user_id: movement.user_id,
      });
    }

    return movement;
  }

  /**
   * Record a sale movement from POS payment processing.
   * Called automatically when cash_register feature is enabled.
   */
  async recordSaleMovement(
    session_id: number,
    data: {
      store_id: number;
      user_id: number;
      amount: number;
      payment_method: string;
      order_id: number;
      payment_id: number;
    },
  ) {
    return this.prisma.withoutScope().cash_register_movements.create({
      data: {
        session_id,
        store_id: data.store_id,
        user_id: data.user_id,
        type: 'sale',
        amount: data.amount,
        payment_method: data.payment_method,
        order_id: data.order_id,
        payment_id: data.payment_id,
      },
    });
  }

  /**
   * Record a refund movement from refund processing.
   */
  async recordRefundMovement(
    session_id: number,
    data: {
      store_id: number;
      user_id: number;
      amount: number;
      payment_method: string;
      order_id?: number;
      payment_id?: number;
      reference?: string;
    },
  ) {
    return this.prisma.withoutScope().cash_register_movements.create({
      data: {
        session_id,
        store_id: data.store_id,
        user_id: data.user_id,
        type: 'refund',
        amount: data.amount,
        payment_method: data.payment_method,
        order_id: data.order_id,
        payment_id: data.payment_id,
        reference: data.reference,
      },
    });
  }
}
