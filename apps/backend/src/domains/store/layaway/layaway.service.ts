import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { Prisma } from '@prisma/client';
import { resolveTierSnapshotsForItems } from '../products/services/tier-snapshot.util';
import { resolvePackSize } from '../products/services/packaging.util';
import {
  resolveLineTotal,
  resolvePriceUnitScale,
} from '../products/services/price-unit.util';
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

      /**
       * QUI-648 — el plan separé cobra con la MISMA aritmética que la venta.
       *
       * Antes reconstruía el total como `unit_price × quantity − descuento +
       * impuesto`, una fórmula que no conoce ni la escala de precio ni las
       * presentaciones. Sobre un cable publicado por metro y medido en
       * milímetros eso cobraba el precio del metro por cada milímetro: mil
       * veces de más, sin que nada lo frenara.
       *
       * Las dos correcciones son las mismas que en orders y en el cobro POS:
       *  - `price_unit_quantity` (escala): el precio publicado cubre N
       *    unidades de stock, así que el multiplicador es `quantity / N`. Sale
       *    del catálogo dentro de la transacción — nunca del cliente.
       *  - presentación aplicada: ahí `unit_price` ya es el precio del paquete
       *    y `quantity` cuenta paquetes, así que la escala NO aplica y el
       *    stock a reservar sale de la cascada de empaque
       *    (`stock_units_consumed`), no de `quantity`.
       *
       * El criterio de exclusión es la PRESENTACIÓN (`packSize > 1`), no "la
       * línea trae tarifa". Una tarifa de cliente (Mayorista) cambia el precio
       * pero lo sigue expresando por unidad de PRECIO, así que la escala sí
       * aplica: excluirla dejaba el plan en $9.000.000 por 2 metros de un cable
       * a $4.500 el metro (plan 36 en dev), y como las cuotas se validan contra
       * ese total, el comerciante recibía un plan de nueve millones.
       *
       * Con escala 1 y sin tarifa —todo lo que existe hoy— la fórmula colapsa
       * a la histórica y ningún plan cambia de total.
       */
      const tierSnapshots = await resolveTierSnapshotsForItems(
        tx,
        dto.items,
        context,
      );

      /** Una línea vendida por presentación: `unit_price` ya es el paquete. */
      const esPresentacion = (index: number): boolean =>
        resolvePackSize(
          tierSnapshots[index]?.units_per_package,
          tierSnapshots[index]?.override_units_per_package,
        ) > 1;

      // La escala solo interesa en las líneas SIN presentación. `tx` sale del
      // baseClient (sin la extensión de scoping), así que el filtro de tienda
      // va explícito: la escala es del catálogo de ESTA tienda.
      const scaledProductIds = Array.from(
        new Set(
          dto.items
            .map((item, index) =>
              esPresentacion(index) ? null : item.product_id,
            )
            .filter((id): id is number => typeof id === 'number'),
        ),
      );
      const scaleByProductId = new Map<number, number>();
      if (scaledProductIds.length > 0) {
        const rows = await tx.products.findMany({
          where: { id: { in: scaledProductIds }, store_id },
          select: { id: true, price_unit_quantity: true },
        });
        for (const row of rows) {
          const scale = resolvePriceUnitScale(row.price_unit_quantity);
          if (scale > 1) scaleByProductId.set(Number(row.id), scale);
        }
      }

      // 2. Calcular totales desde items
      let total_amount = new Prisma.Decimal(0);
      const items_data = dto.items.map((item, index) => {
        const tierSnap = tierSnapshots[index];
        const discount = new Prisma.Decimal(item.discount_amount || 0);
        const tax = new Prisma.Decimal(item.tax_amount || 0);
        const price_unit_quantity = esPresentacion(index)
          ? 1
          : (scaleByProductId.get(Number(item.product_id)) ?? 1);
        const line_total = resolveLineTotal(
          Number(item.unit_price),
          Number(item.quantity),
          price_unit_quantity,
        );
        const subtotal = new Prisma.Decimal(line_total)
          .minus(discount)
          .plus(tax);
        total_amount = total_amount.plus(subtotal);
        return {
          ...item,
          discount_amount: discount,
          tax_amount: tax,
          subtotal,
          price_unit_quantity,
          // Unidades REALES de stock que reserva la línea. `null` = sin
          // empaque, la cantidad ya está en unidades de stock.
          stock_units_consumed: tierSnap?.stock_units_consumed ?? null,
        };
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
          false, // skip_reservation
          // Presentación aplicada: `quantity` cuenta paquetes, así que las
          // unidades a descontar son las del empaque. `null` deja la cantidad
          // tal cual, que es el comportamiento histórico.
          item.stock_units_consumed ?? undefined,
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
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
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
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
            },
          },
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
        customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            phone: true,
          },
        },
        created_by: { select: { id: true, first_name: true, last_name: true } },
        layaway_items: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
            product_variants: { select: { id: true, name: true, sku: true } },
            inventory_locations: {
              select: { id: true, name: true, code: true },
            },
          },
        },
        layaway_installments: { orderBy: { installment_number: 'asc' } },
        layaway_payments: {
          orderBy: { created_at: 'desc' },
          include: {
            store_payment_methods: {
              select: { id: true, display_name: true },
            },
            received_by: {
              select: { id: true, first_name: true, last_name: true },
            },
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
      let target_installment:
        | (typeof plan.layaway_installments)[number]
        | undefined = undefined;
      if (dto.installment_id) {
        target_installment = plan.layaway_installments.find(
          (i) => i.id === dto.installment_id,
        );
        // Una cuota de otro plan (o inexistente) se ignoraba en silencio: el
        // `find` devolvía undefined, el pago se guardaba con
        // `layaway_installment_id: null` y el endpoint respondía 200. La plata
        // entraba al plan sin quedar imputada a ninguna cuota.
        if (!target_installment) {
          throw new VendixHttpException(
            ErrorCodes.LAY_INSTALLMENT_003,
            undefined,
            { installment_id: dto.installment_id, plan_id },
          );
        }
        if (target_installment.state === 'paid') {
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

      // 6. Marcar cuota como pagada si aplica.
      // Se compara el ACUMULADO imputado a la cuota, no el pago suelto. Con la
      // comparación contra `amount` a secas, dos abonos de 2.250 sobre una
      // cuota de 4.500 la dejaban en `pending` con la plata ya cobrada, y el
      // cliente figuraba en mora de una cuota que había pagado completa; solo
      // el barrido de cierre del plan la corregía.
      if (target_installment) {
        const imputado = await tx.layaway_payments.aggregate({
          where: {
            layaway_installment_id: target_installment.id,
            state: 'succeeded',
          },
          _sum: { amount: true },
        });
        // El pago recién creado ya cuenta: se agrega dentro de la transacción.
        const acumulado = new Prisma.Decimal(imputado._sum.amount ?? 0);

        if (acumulado.greaterThanOrEqualTo(target_installment.amount)) {
          await tx.layaway_installments.update({
            where: { id: target_installment.id },
            data: { state: 'paid', paid_at: new Date(), updated_at: new Date() },
          });
        }
      }

      // 7. Actualizar plan
      const new_paid = new Prisma.Decimal(plan.paid_amount).plus(amount);
      const new_remaining = new Prisma.Decimal(plan.remaining_amount).minus(
        amount,
      );
      const is_completed = new_remaining.lessThanOrEqualTo(0);

      await tx.layaway_plans.update({
        where: { id: plan_id },
        data: {
          paid_amount: new_paid,
          remaining_amount: new_remaining.greaterThan(0)
            ? new_remaining
            : new Prisma.Decimal(0),
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
          where: {
            layaway_plan_id: plan_id,
            state: { in: ['pending', 'overdue'] },
          },
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
        include: {
          layaway_installments: { orderBy: { installment_number: 'asc' } },
        },
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
      const plan = await tx.layaway_plans.findUnique({
        where: { id: plan_id },
      });

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
        where: {
          layaway_plan_id: plan_id,
          state: { in: ['pending', 'overdue'] },
        },
        data: { state: 'cancelled', updated_at: new Date() },
      });

      // 3. Liberar reservas de stock
      await this.stockLevelManager.releaseReservationsByReference(
        'layaway',
        plan_id,
        'cancelled',
        tx,
      );

      // 4. Resolver montos del cuadre contable (reversa del anticipo 2805):
      //    total_paid = lo abonado por el cliente; el descuadre se reparte entre
      //    devolución (caja/banco) y penalización retenida (otros ingresos).
      //    Invariante para que el asiento balancee: refund + fee == total_paid.
      //    Default si no se especifica: devolución total, sin penalización.
      const total_paid = Number(plan.paid_amount || 0);
      const cancellation_fee = Math.min(
        Number(dto.cancellation_fee ?? 0),
        total_paid,
      );
      const refund_amount =
        dto.refund_amount != null
          ? Math.min(Number(dto.refund_amount), total_paid - cancellation_fee)
          : total_paid - cancellation_fee;

      // 5. Emitir evento
      this.eventEmitter.emit('layaway.cancelled', {
        store_id: plan.store_id,
        organization_id: context?.organization_id,
        plan_id: plan.id,
        plan_number: plan.plan_number,
        customer_id: plan.customer_id,
        paid_amount: plan.paid_amount,
        total_paid,
        refund_amount,
        cancellation_fee,
        cancellation_reason: dto.cancellation_reason,
        user_id: context?.user_id,
      });

      return tx.layaway_plans.findUnique({
        where: { id: plan_id },
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
        },
      });
    });
  }

  // ===== COMPLETE (manual) =====

  async complete(plan_id: number) {
    return this.prisma.$transaction(async (tx: any) => {
      const plan = await tx.layaway_plans.findUnique({
        where: { id: plan_id },
      });

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
        data: {
          state: 'completed',
          completed_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Marcar cuotas pendientes como pagadas
      await tx.layaway_installments.updateMany({
        where: {
          layaway_plan_id: plan_id,
          state: { in: ['pending', 'overdue'] },
        },
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
        include: {
          customer: { select: { id: true, first_name: true, last_name: true } },
        },
      });
    });
  }
}
