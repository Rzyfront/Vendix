import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { Prisma } from '@prisma/client';
import {
  CreateLayawayDto,
  LayawayQueryDto,
  MakeLayawayPaymentDto,
  ModifyInstallmentsDto,
  CancelLayawayDto,
} from './dto';

@Injectable()
export class LayawayService {
  constructor(
    private prisma: StorePrismaService,
    private stockLevelManager: StockLevelManager,
    private eventEmitter: EventEmitter2,
  ) {}

  // ===== CREATE =====

  async create(dto: CreateLayawayDto) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    return this.prisma.$transaction(async (tx: any) => {
      // 1. Generar plan_number
      const last_plan = await tx.layaway_plans.findFirst({
        where: { store_id },
        orderBy: { id: 'desc' },
        select: { plan_number: true },
      });

      const next_number = last_plan
        ? parseInt(last_plan.plan_number.replace('LAY-', '')) + 1
        : 1;
      const plan_number = `LAY-${String(next_number).padStart(5, '0')}`;

      // 2. Calcular totales desde items
      let total_amount = new Prisma.Decimal(0);
      const items_data = dto.items.map((item) => {
        const discount = new Prisma.Decimal(item.discount_amount || 0);
        const tax = new Prisma.Decimal(item.tax_amount || 0);
        const subtotal = new Prisma.Decimal(item.unit_price)
          .times(item.quantity)
          .minus(discount)
          .plus(tax);
        total_amount = total_amount.plus(subtotal);
        return { ...item, discount_amount: discount, tax_amount: tax, subtotal };
      });

      const down_payment = new Prisma.Decimal(dto.down_payment_amount || 0);
      const remaining_after_down = total_amount.minus(down_payment);

      // 3. Validar que suma de cuotas + down_payment = total_amount
      const installments_sum = dto.installments.reduce(
        (sum, inst) => sum.plus(new Prisma.Decimal(inst.amount)),
        new Prisma.Decimal(0),
      );

      if (!installments_sum.equals(remaining_after_down)) {
        throw new VendixHttpException(ErrorCodes.LAY_INSTALLMENT_001);
      }

      // 4. Crear plan
      const plan = await tx.layaway_plans.create({
        data: {
          store_id,
          customer_id: dto.customer_id,
          plan_number,
          state: 'active',
          total_amount,
          down_payment_amount: down_payment,
          paid_amount: down_payment,
          remaining_amount: remaining_after_down,
          currency: dto.currency || null,
          num_installments: dto.installments.length,
          notes: dto.notes || null,
          internal_notes: dto.internal_notes || null,
          started_at: new Date(),
          created_by_user_id: context?.user_id || null,
        },
      });

      // 5. Crear items
      for (const item of items_data) {
        await tx.layaway_items.create({
          data: {
            layaway_plan_id: plan.id,
            product_id: item.product_id,
            product_variant_id: item.product_variant_id || null,
            product_name: item.product_name,
            variant_name: item.variant_name || null,
            sku: item.sku || null,
            quantity: item.quantity,
            unit_price: item.unit_price,
            discount_amount: item.discount_amount,
            tax_amount: item.tax_amount,
            subtotal: item.subtotal,
            location_id: item.location_id || null,
          },
        });
      }

      // 6. Crear installments
      for (let i = 0; i < dto.installments.length; i++) {
        await tx.layaway_installments.create({
          data: {
            layaway_plan_id: plan.id,
            installment_number: i + 1,
            amount: dto.installments[i].amount,
            due_date: new Date(dto.installments[i].due_date),
            state: 'pending',
          },
        });
      }

      // 7. Reservar stock para cada item (expires_at: null = no expira)
      for (const item of items_data) {
        const location_id =
          item.location_id ||
          (await this.stockLevelManager.getDefaultLocationForProduct(
            item.product_id,
            item.product_variant_id,
          ));

        await this.stockLevelManager.reserveStock(
          item.product_id,
          item.product_variant_id,
          location_id,
          item.quantity,
          'layaway',
          plan.id,
          context?.user_id,
          true,
          tx,
          null, // expires_at: null = no expira
        );
      }

      // 8. Si hay down_payment, crear registro de pago
      if (down_payment.greaterThan(0)) {
        await tx.layaway_payments.create({
          data: {
            layaway_plan_id: plan.id,
            amount: down_payment,
            currency: dto.currency || null,
            store_payment_method_id: dto.down_payment_method_id || null,
            state: 'succeeded',
            paid_at: new Date(),
            received_by_user_id: context?.user_id || null,
            notes: 'Cuota inicial (down payment)',
          },
        });
      }

      // 9. Emitir evento
      this.eventEmitter.emit('layaway.created', {
        store_id,
        organization_id: context?.organization_id,
        plan_id: plan.id,
        plan_number,
        customer_id: dto.customer_id,
        total_amount: total_amount.toNumber(),
      });

      // 10. Retornar plan completo
      return tx.layaway_plans.findUnique({
        where: { id: plan.id },
        include: {
          layaway_items: true,
          layaway_installments: { orderBy: { installment_number: 'asc' } },
          layaway_payments: { orderBy: { created_at: 'desc' } },
          customer: { select: { id: true, first_name: true, last_name: true, email: true } },
        },
      });
    });
  }

  // ===== FIND ALL =====

  async findAll(query: LayawayQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      state,
      customer_id,
    } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { plan_number: { contains: search, mode: 'insensitive' } },
        { customer: { first_name: { contains: search, mode: 'insensitive' } } },
        { customer: { last_name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (state) {
      where.state = state;
    }

    if (customer_id) {
      where.customer_id = customer_id;
    }

    const [data, total] = await Promise.all([
      this.prisma.layaway_plans.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          customer: { select: { id: true, first_name: true, last_name: true, email: true } },
          layaway_installments: {
            where: { state: 'pending' },
            orderBy: { due_date: 'asc' },
            take: 1,
          },
        },
      }),
      this.prisma.layaway_plans.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, total_pages: Math.ceil(total / limit) },
    };
  }

  // ===== FIND ONE =====

  async findOne(id: number) {
    const plan = await this.prisma.layaway_plans.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, first_name: true, last_name: true, email: true, phone: true } },
        created_by: { select: { id: true, first_name: true, last_name: true } },
        layaway_items: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
            product_variants: { select: { id: true, name: true, sku: true } },
            inventory_locations: { select: { id: true, name: true, code: true } },
          },
        },
        layaway_installments: { orderBy: { installment_number: 'asc' } },
        layaway_payments: {
          orderBy: { created_at: 'desc' },
          include: {
            store_payment_methods: {
              select: { id: true, display_name: true },
            },
            received_by: { select: { id: true, first_name: true, last_name: true } },
          },
        },
      },
    });

    if (!plan) {
      throw new VendixHttpException(ErrorCodes.LAY_FIND_001);
    }

    return plan;
  }

  // ===== STATS =====

  async getStats() {
    const [active, completed, overdue, total_receivable] = await Promise.all([
      this.prisma.layaway_plans.count({ where: { state: 'active' } }),
      this.prisma.layaway_plans.count({ where: { state: 'completed' } }),
      this.prisma.layaway_plans.count({ where: { state: 'overdue' } }),
      this.prisma.layaway_plans.aggregate({
        where: { state: { in: ['active', 'overdue'] } },
        _sum: { remaining_amount: true },
      }),
    ]);

    return {
      active,
      completed,
      overdue,
      total_receivable: total_receivable._sum.remaining_amount || 0,
    };
  }

  // ===== MAKE PAYMENT =====

  async makePayment(plan_id: number, dto: MakeLayawayPaymentDto) {
    const context = RequestContextService.getContext();

    return this.prisma.$transaction(async (tx: any) => {
      // 1. Obtener plan
      const plan = await tx.layaway_plans.findUnique({
        where: { id: plan_id },
        include: {
          layaway_installments: { orderBy: { installment_number: 'asc' } },
        },
      });

      if (!plan) {
        throw new VendixHttpException(ErrorCodes.LAY_FIND_001);
      }

      // 2. Validar estado
      if (!['active', 'overdue'].includes(plan.state)) {
        throw new VendixHttpException(ErrorCodes.LAY_STATE_001);
      }

      // 3. Validar monto
      const amount = new Prisma.Decimal(dto.amount);
      if (amount.greaterThan(plan.remaining_amount)) {
        throw new VendixHttpException(ErrorCodes.LAY_PAYMENT_001);
      }

      // 4. Determinar cuota a aplicar
      let target_installment: (typeof plan.layaway_installments)[number] | undefined = undefined;
      if (dto.installment_id) {
        target_installment = plan.layaway_installments.find(
          (i) => i.id === dto.installment_id,
        );
        if (target_installment && target_installment.state === 'paid') {
          throw new VendixHttpException(ErrorCodes.LAY_INSTALLMENT_002);
        }
      } else {
        // Aplicar a la próxima cuota pendiente
        target_installment = plan.layaway_installments.find(
          (i) => i.state === 'pending' || i.state === 'overdue',
        );
      }

      // 5. Crear pago
      const payment = await tx.layaway_payments.create({
        data: {
          layaway_plan_id: plan_id,
          layaway_installment_id: target_installment?.id || null,
          amount,
          currency: plan.currency,
          store_payment_method_id: dto.store_payment_method_id || null,
          transaction_id: dto.transaction_id || null,
          state: 'succeeded',
          paid_at: new Date(),
          notes: dto.notes || null,
          received_by_user_id: context?.user_id || null,
        },
      });

      // 6. Marcar cuota como pagada si aplica
      if (target_installment && amount.greaterThanOrEqualTo(target_installment.amount)) {
        await tx.layaway_installments.update({
          where: { id: target_installment.id },
          data: { state: 'paid', paid_at: new Date(), updated_at: new Date() },
        });
      }

      // 7. Actualizar plan
      const new_paid = new Prisma.Decimal(plan.paid_amount).plus(amount);
      const new_remaining = new Prisma.Decimal(plan.remaining_amount).minus(amount);
      const is_completed = new_remaining.lessThanOrEqualTo(0);

      await tx.layaway_plans.update({
        where: { id: plan_id },
        data: {
          paid_amount: new_paid,
          remaining_amount: new_remaining.greaterThan(0) ? new_remaining : new Prisma.Decimal(0),
          ...(is_completed && {
            state: 'completed',
            completed_at: new Date(),
          }),
          updated_at: new Date(),
        },
      });

      // 8. Emitir eventos
      this.eventEmitter.emit('layaway.payment_received', {
        store_id: plan.store_id,
        organization_id: context?.organization_id,
        plan_id: plan.id,
        plan_number: plan.plan_number,
        payment_id: payment.id,
        amount: amount.toNumber(),
        customer_id: plan.customer_id,
      });

      if (is_completed) {
        // Liberar reservas como consumidas (productos entregados)
        await this.stockLevelManager.releaseReservationsByReference(
          'layaway',
          plan_id,
          'consumed',
          tx,
        );

        // Marcar todas las cuotas pendientes como pagadas
        await tx.layaway_installments.updateMany({
          where: { layaway_plan_id: plan_id, state: { in: ['pending', 'overdue'] } },
          data: { state: 'paid', paid_at: new Date(), updated_at: new Date() },
        });

        this.eventEmitter.emit('layaway.completed', {
          store_id: plan.store_id,
          organization_id: context?.organization_id,
          plan_id: plan.id,
          plan_number: plan.plan_number,
          customer_id: plan.customer_id,
          total_amount: plan.total_amount,
        });
      }

      return payment;
    });
  }

  // ===== MODIFY INSTALLMENTS =====

  async modifyInstallments(plan_id: number, dto: ModifyInstallmentsDto) {
    return this.prisma.$transaction(async (tx: any) => {
      const plan = await tx.layaway_plans.findUnique({
        where: { id: plan_id },
        include: { layaway_installments: { orderBy: { installment_number: 'asc' } } },
      });

      if (!plan) {
        throw new VendixHttpException(ErrorCodes.LAY_FIND_001);
      }

      if (plan.state !== 'active' && plan.state !== 'overdue') {
        throw new VendixHttpException(ErrorCodes.LAY_STATE_001);
      }

      // Validar que suma de nuevas cuotas = remaining_amount
      const new_sum = dto.installments.reduce(
        (sum, inst) => sum.plus(new Prisma.Decimal(inst.amount)),
        new Prisma.Decimal(0),
      );

      if (!new_sum.equals(new Prisma.Decimal(plan.remaining_amount))) {
        throw new VendixHttpException(ErrorCodes.LAY_INSTALLMENT_001);
      }

      // Eliminar cuotas pendientes/overdue actuales
      await tx.layaway_installments.deleteMany({
        where: {
          layaway_plan_id: plan_id,
          state: { in: ['pending', 'overdue'] },
        },
      });

      // Calcular el próximo número de cuota
      const paid_installments = plan.layaway_installments.filter(
        (i) => i.state === 'paid',
      );
      const next_number = paid_installments.length + 1;

      // Crear nuevas cuotas
      for (let i = 0; i < dto.installments.length; i++) {
        await tx.layaway_installments.create({
          data: {
            layaway_plan_id: plan_id,
            installment_number: next_number + i,
            amount: dto.installments[i].amount,
            due_date: new Date(dto.installments[i].due_date),
            state: 'pending',
          },
        });
      }

      // Actualizar num_installments
      await tx.layaway_plans.update({
        where: { id: plan_id },
        data: {
          num_installments: paid_installments.length + dto.installments.length,
          updated_at: new Date(),
        },
      });

      return this.findOne(plan_id);
    });
  }

  // ===== CANCEL =====

  async cancel(plan_id: number, dto: CancelLayawayDto) {
    const context = RequestContextService.getContext();

    return this.prisma.$transaction(async (tx: any) => {
      const plan = await tx.layaway_plans.findUnique({ where: { id: plan_id } });

      if (!plan) {
        throw new VendixHttpException(ErrorCodes.LAY_FIND_001);
      }

      if (plan.state === 'completed') {
        throw new VendixHttpException(ErrorCodes.LAY_STATE_001);
      }

      // 1. Marcar plan como cancelado
      await tx.layaway_plans.update({
        where: { id: plan_id },
        data: {
          state: 'cancelled',
          cancelled_at: new Date(),
          cancellation_reason: dto.cancellation_reason,
          updated_at: new Date(),
        },
      });

      // 2. Cancelar cuotas pendientes
      await tx.layaway_installments.updateMany({
        where: { layaway_plan_id: plan_id, state: { in: ['pending', 'overdue'] } },
        data: { state: 'cancelled', updated_at: new Date() },
      });

      // 3. Liberar reservas de stock
      await this.stockLevelManager.releaseReservationsByReference(
        'layaway',
        plan_id,
        'cancelled',
        tx,
      );

      // 4. Emitir evento
      this.eventEmitter.emit('layaway.cancelled', {
        store_id: plan.store_id,
        organization_id: context?.organization_id,
        plan_id: plan.id,
        plan_number: plan.plan_number,
        customer_id: plan.customer_id,
        paid_amount: plan.paid_amount,
        cancellation_reason: dto.cancellation_reason,
      });

      return tx.layaway_plans.findUnique({
        where: { id: plan_id },
        include: { customer: { select: { id: true, first_name: true, last_name: true } } },
      });
    });
  }

  // ===== COMPLETE (manual) =====

  async complete(plan_id: number) {
    return this.prisma.$transaction(async (tx: any) => {
      const plan = await tx.layaway_plans.findUnique({ where: { id: plan_id } });

      if (!plan) {
        throw new VendixHttpException(ErrorCodes.LAY_FIND_001);
      }

      if (plan.state === 'completed' || plan.state === 'cancelled') {
        throw new VendixHttpException(ErrorCodes.LAY_STATE_001);
      }

      const remaining = new Prisma.Decimal(plan.remaining_amount);
      if (remaining.greaterThan(0)) {
        throw new VendixHttpException(ErrorCodes.LAY_PAYMENT_001);
      }

      await tx.layaway_plans.update({
        where: { id: plan_id },
        data: { state: 'completed', completed_at: new Date(), updated_at: new Date() },
      });

      // Marcar cuotas pendientes como pagadas
      await tx.layaway_installments.updateMany({
        where: { layaway_plan_id: plan_id, state: { in: ['pending', 'overdue'] } },
        data: { state: 'paid', paid_at: new Date(), updated_at: new Date() },
      });

      // Liberar reservas como consumidas
      await this.stockLevelManager.releaseReservationsByReference(
        'layaway',
        plan_id,
        'consumed',
        tx,
      );

      this.eventEmitter.emit('layaway.completed', {
        store_id: plan.store_id,
        plan_id: plan.id,
        plan_number: plan.plan_number,
        customer_id: plan.customer_id,
        total_amount: plan.total_amount,
      });

      return tx.layaway_plans.findUnique({
        where: { id: plan_id },
        include: { customer: { select: { id: true, first_name: true, last_name: true } } },
      });
    });
  }
}
