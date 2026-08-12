import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/**
 * State machine permitido del feature de comisiones (QUI-678).
 *
 *   pending   → accrued      (cliente pagó)
 *   pending   → reversed     (reserva cancelada/no-show antes del pago)
 *   accrued   → paid         (dueño marcó pagado)
 *   accrued   → declined     (dueño declinó con motivo)
 *   accrued   → reversed     (reserva cancelada post-pago, raro)
 *   declined  → accrued      (reopen — dueño se arrepiente)
 *
 * NO permitidas: paid → declined, reversed → cualquier otra.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['accrued', 'reversed'],
  accrued: ['paid', 'declined', 'reversed'],
  paid: [],
  declined: ['accrued'],
  reversed: [],
};

/**
 * Servicio de comisiones dueño/mecánico (modelo nuevo del QUI-678).
 *
 * Reemplaza al MVP `ProviderCommissionAccrualService` que usaba la tabla
 * legacy `booking_commission_accruals`. La migración aplicada en
 * 20260812100000_user_commissions_state_machine hace backfill automático.
 *
 * Idempotencia:
 *   - accrueForPayment usa UNIQUE(booking_id) → 2do intento = existing row
 *   - decline/markPaid/reopen usan guard sobre el status actual
 *
 * Eventos emitidos:
 *   - commission.accrued (al crear o transicionar a accrued)
 *   - commission.paid     (al transicionar a paid)
 *   - commission.declined (al transicionar a declined)
 *   - commission.reversed (al transicionar a reversed)
 *
 * El accounting listener escucha estos eventos y crea los asientos contables
 * correspondientes (auto-entry).
 */
@Injectable()
export class ProviderCommissionsService {
  private readonly logger = new Logger(ProviderCommissionsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── State machine ───────────────────────────────────────────────────────

  /**
   * Verifica si una transición de estado es válida. Lanza BadRequest si no.
   */
  private assertTransition(from: string, to: string): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new BadRequestException(
        `Transición inválida: ${from} → ${to}. Permitidas desde ${from}: ${allowed?.join(', ') || '(ninguna)'}`,
      );
    }
  }

  // ─── Accrual (payment.received) ────────────────────────────────────────

  /**
   * Crea el accrual de comisión cuando se cobra el pago de la reserva.
   * Idempotente: si ya existe un accrual para este booking, retorna el existente.
   *
   * Si el producto no tiene `owner_commission_pct` configurado, retorna
   * null sin crear nada.
   */
  async accrueForPayment(params: {
    payment_id: number;
    order_id: number;
    store_id: number;
    organization_id: number;
  }): Promise<{ accrual_id: number; employee_id: number; amount: number } | null> {
    // 1. Buscar la reserva ligada a esta orden
    const booking = await this.prisma.bookings.findFirst({
      where: { order_id: params.order_id, store_id: params.store_id },
      select: {
        id: true,
        store_id: true,
        organization_id: true,
        provider_id: true,
        product_id: true,
        order_id: true,
      },
    });
    if (!booking) {
      this.logger.debug(
        `accrueForPayment: no booking for order_id=${params.order_id}, skipping`,
      );
      return null;
    }

    // 2. Idempotencia: si ya existe accrual para este booking, retornar el existente
    const existing = await this.prisma.user_commissions.findUnique({
      where: { booking_id: booking.id },
    });
    if (existing) {
      this.logger.debug(
        `accrueForPayment: accrual already exists for booking_id=${booking.id}, returning existing`,
      );
      return {
        accrual_id: existing.id,
        employee_id: existing.employee_id,
        amount: Number(existing.commission_amount),
      };
    }

    // 3. Cargar el producto y el service_provider para conocer el % y el empleado
    const [product, provider] = await Promise.all([
      this.prisma.products.findUnique({
        where: { id: booking.product_id },
        select: { id: true, owner_commission_pct: true, base_price: true },
      }),
      booking.provider_id
        ? this.prisma.service_providers.findUnique({
            where: { id: booking.provider_id },
            select: { id: true, employee_id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!product) {
      this.logger.warn(
        `accrueForPayment: product ${booking.product_id} not found for booking_id=${booking.id}`,
      );
      return null;
    }

    // 4. Si el producto no tiene % configurado, no hay split
    if (product.owner_commission_pct === null) {
      this.logger.debug(
        `accrueForPayment: product ${product.id} has no owner_commission_pct, skipping`,
      );
      return null;
    }

    // 5. Si no hay empleado asignado (free_booking), no se puede crear comisión
    if (!provider || provider.employee_id === null) {
      this.logger.debug(
        `accrueForPayment: no employee assigned for booking_id=${booking.id}, skipping`,
      );
      return null;
    }

    // 6. Calcular el split (snapshot del %)
    const order = await this.prisma.orders.findUnique({
      where: { id: booking.order_id ?? -1 },
      select: { subtotal_amount: true },
    });
    const baseAmount = order ? Number(order.subtotal_amount) : 0;
    const commissionPct = Number(product.owner_commission_pct);
    const split = this.calculateSplit({
      base_amount: baseAmount,
      commission_pct: commissionPct,
    });
    const commissionAmount = split.commission_amount;

    // 7. Crear el accrual (catch P2002 si hubo race con otro listener)
    try {
      const accrual = await this.prisma.user_commissions.create({
        data: {
          store_id: booking.store_id,
          organization_id: params.organization_id,
          employee_id: provider.employee_id,
          provider_id: booking.provider_id,
          booking_id: booking.id,
          order_id: booking.order_id,
          payment_id: params.payment_id,
          product_id: booking.product_id,
          base_amount: baseAmount,
          commission_pct: commissionPct,
          commission_amount: commissionAmount,
          status: 'accrued',
          notes: 'Auto-accrual al recibir pago del cliente',
        },
      });

      this.logger.log(
        `accrueForPayment: created accrual ${accrual.id} for booking_id=${booking.id} ` +
          `(employee=${accrual.employee_id}, amount=${commissionAmount})`,
      );

      this.eventEmitter.emit('commission.accrued', {
        accrual_id: accrual.id,
        store_id: booking.store_id,
        organization_id: params.organization_id,
        employee_id: accrual.employee_id,
        booking_id: booking.id,
        amount: commissionAmount,
      });

      return {
        accrual_id: accrual.id,
        employee_id: accrual.employee_id,
        amount: commissionAmount,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Race: otro listener creó primero. Retornar el existente.
        const existingAfter = await this.prisma.user_commissions.findUnique({
          where: { booking_id: booking.id },
        });
        if (existingAfter) {
          return {
            accrual_id: existingAfter.id,
            employee_id: existingAfter.employee_id,
            amount: Number(existingAfter.commission_amount),
          };
        }
      }
      throw error;
    }
  }

  // ─── Reverse (booking.cancelled, booking.no_show) ─────────────────────

  /**
   * Reversa el accrual de una reserva. Idempotente.
   */
  async reverseForBooking(params: {
    booking_id: number;
    reason: 'cancelled' | 'no_show';
  }): Promise<void> {
    const existing = await this.prisma.user_commissions.findUnique({
      where: { booking_id: params.booking_id },
    });
    if (!existing) {
      this.logger.debug(
        `reverseForBooking: no accrual for booking_id=${params.booking_id}, nothing to reverse`,
      );
      return;
    }
    if (existing.status === 'reversed') {
      this.logger.debug(
        `reverseForBooking: accrual ${existing.id} already reversed, skipping`,
      );
      return;
    }

    this.assertTransition(existing.status, 'reversed');

    await this.prisma.user_commissions.update({
      where: { id: existing.id },
      data: {
        status: 'reversed',
        declined_reason: params.reason,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('commission.reversed', {
      accrual_id: existing.id,
      store_id: existing.store_id,
      organization_id: existing.organization_id,
      employee_id: existing.employee_id,
      booking_id: existing.booking_id,
      amount: Number(existing.commission_amount),
      reason: params.reason,
    });

    this.logger.log(
      `reverseForBooking: reversed accrual ${existing.id} (reason=${params.reason})`,
    );
  }

  // ─── Acciones manuales (decline, mark-paid, reopen) ──────────────────

  /**
   * Declina una comisión (no se pagará). Motivo obligatorio.
   * Solo válido desde accrued. Emite `commission.declined` para reversar CxP.
   */
  async decline(params: {
    accrual_id: number;
    reason: string;
    declined_by_user_id: number;
  }): Promise<void> {
    if (!params.reason || params.reason.trim().length < 3) {
      throw new BadRequestException('El motivo de declinación es obligatorio (mínimo 3 chars)');
    }

    const existing = await this.prisma.user_commissions.findUnique({
      where: { id: params.accrual_id },
    });
    if (!existing) {
      throw new NotFoundException(`Accrual ${params.accrual_id} no existe`);
    }
    this.assertTransition(existing.status, 'declined');

    await this.prisma.user_commissions.update({
      where: { id: params.accrual_id },
      data: {
        status: 'declined',
        declined_reason: params.reason.trim(),
        declined_at: new Date(),
        declined_by_user_id: params.declined_by_user_id,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('commission.declined', {
      accrual_id: existing.id,
      store_id: existing.store_id,
      organization_id: existing.organization_id,
      employee_id: existing.employee_id,
      booking_id: existing.booking_id,
      amount: Number(existing.commission_amount),
      reason: params.reason.trim(),
      declined_by_user_id: params.declined_by_user_id,
    });

    this.logger.log(
      `decline: declined accrual ${existing.id} (reason="${params.reason.slice(0, 50)}")`,
    );
  }

  /**
   * Marca una comisión como pagada. Solo válido desde accrued.
   * Emite `commission.paid` para cerrar la CxP.
   */
  async markPaid(params: {
    accrual_id: number;
    paid_by_user_id: number;
    payment_reference?: string;
    notes?: string;
  }): Promise<void> {
    const existing = await this.prisma.user_commissions.findUnique({
      where: { id: params.accrual_id },
    });
    if (!existing) {
      throw new NotFoundException(`Accrual ${params.accrual_id} no existe`);
    }
    this.assertTransition(existing.status, 'paid');

    await this.prisma.user_commissions.update({
      where: { id: params.accrual_id },
      data: {
        status: 'paid',
        paid_at: new Date(),
        paid_by_user_id: params.paid_by_user_id,
        payment_reference: params.payment_reference ?? null,
        notes: params.notes ?? existing.notes,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('commission.paid', {
      accrual_id: existing.id,
      store_id: existing.store_id,
      organization_id: existing.organization_id,
      employee_id: existing.employee_id,
      booking_id: existing.booking_id,
      amount: Number(existing.commission_amount),
      payment_reference: params.payment_reference ?? null,
      paid_by_user_id: params.paid_by_user_id,
    });

    this.logger.log(
      `markPaid: paid accrual ${existing.id} (ref="${params.payment_reference ?? '(sin referencia)'}")`,
    );
  }

  /**
   * Re-abre una comisión declinada. Solo válido desde declined → accrued.
   */
  async reopen(params: {
    accrual_id: number;
    user_id: number;
  }): Promise<void> {
    const existing = await this.prisma.user_commissions.findUnique({
      where: { id: params.accrual_id },
    });
    if (!existing) {
      throw new NotFoundException(`Accrual ${params.accrual_id} no existe`);
    }
    this.assertTransition(existing.status, 'accrued');

    await this.prisma.user_commissions.update({
      where: { id: params.accrual_id },
      data: {
        status: 'accrued',
        declined_reason: null,
        declined_at: null,
        declined_by_user_id: null,
        updated_at: new Date(),
      },
    });

    this.eventEmitter.emit('commission.accrued', {
      accrual_id: existing.id,
      store_id: existing.store_id,
      organization_id: existing.organization_id,
      employee_id: existing.employee_id,
      booking_id: existing.booking_id,
      amount: Number(existing.commission_amount),
      reopened_by: params.user_id,
    });

    this.logger.log(`reopen: reopened declined accrual ${existing.id}`);
  }

  // ─── Reads ─────────────────────────────────────────────────────────────

  /**
   * Lista las comisiones de un mecánico (perfil). Paginado + filtros opcionales.
   */
  async listByEmployee(params: {
    employee_id: number;
    store_id: number;
    status?: string | string[];
    date_from?: Date;
    date_to?: Date;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.user_commissionsWhereInput = {
      employee_id: params.employee_id,
      store_id: params.store_id,
    };
    if (params.status) {
      where.status = Array.isArray(params.status)
        ? { in: params.status as any }
        : (params.status as any);
    }
    if (params.date_from || params.date_to) {
      where.created_at = {};
      if (params.date_from) (where.created_at as any).gte = params.date_from;
      if (params.date_to) (where.created_at as any).lte = params.date_to;
    }

    const [items, total] = await Promise.all([
      this.prisma.user_commissions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          product: { select: { id: true, name: true } },
          booking: { select: { id: true, booking_number: true, date: true } },
        },
      }),
      this.prisma.user_commissions.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * KPIs por mecánico: pendiente, pagado este mes, declinado.
   */
  async getEmployeeSummary(params: {
    employee_id: number;
    store_id: number;
  }) {
    const where = {
      employee_id: params.employee_id,
      store_id: params.store_id,
    };

    const [accrued, paid, declined, reversed, pending] = await Promise.all([
      this.prisma.user_commissions.aggregate({
        where: { ...where, status: 'accrued' },
        _sum: { commission_amount: true },
        _count: true,
      }),
      this.prisma.user_commissions.aggregate({
        where: { ...where, status: 'paid' },
        _sum: { commission_amount: true },
        _count: true,
      }),
      this.prisma.user_commissions.aggregate({
        where: { ...where, status: 'declined' },
        _sum: { commission_amount: true },
        _count: true,
      }),
      this.prisma.user_commissions.aggregate({
        where: { ...where, status: 'reversed' },
        _count: true,
      }),
      this.prisma.user_commissions.aggregate({
        where: { ...where, status: 'pending' },
        _sum: { commission_amount: true },
        _count: true,
      }),
    ]);

    return {
      pending_amount: Number(pending._sum.commission_amount ?? 0),
      pending_count: pending._count,
      accrued_amount: Number(accrued._sum.commission_amount ?? 0),
      accrued_count: accrued._count,
      paid_amount: Number(paid._sum.commission_amount ?? 0),
      paid_count: paid._count,
      declined_amount: Number(declined._sum.commission_amount ?? 0),
      declined_count: declined._count,
      reversed_count: reversed._count,
    };
  }

  // ─── Reporte diario (cierre del día) ───────────────────────────────────

  /**
   * Resumen diario del split dueño/mecánico. Usado por la pantalla
   * `/store/reservations/commissions/daily-summary`.
   */
  async getDailySummary(params: {
    store_id: number;
    date: Date;
  }) {
    const dayStart = new Date(params.date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const accruals = await this.prisma.user_commissions.findMany({
      where: {
        store_id: params.store_id,
        status: 'accrued',
        created_at: { gte: dayStart, lt: dayEnd },
      },
      include: {
        product: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    const totals = accruals.reduce(
      (acc, c) => {
        const amount = Number(c.commission_amount);
        acc.total_revenue += Number(c.base_amount);
        acc.total_provider_payable += amount;
        acc.bookings_count += 1;
        return acc;
      },
      { total_revenue: 0, total_provider_payable: 0, bookings_count: 0 },
    );

    // Para el KPI "tu comisión" (owner commission), usamos el mismo monto que
    // "provider_payable" — es exactamente lo que se le debe al mecánico y
    // por complementariedad, lo que se queda el dueño = subtotal - provider.
    // Mantenemos los 2 campos separados para que el reporte sea explícito.

    // Por empleado
    const byEmployeeMap = new Map<
      number,
      { display_name: string; bookings_count: number; total_revenue: number; owner_commission: number; provider_payable: number }
    >();
    // Por servicio
    const byServiceMap = new Map<
      number,
      { product_name: string; bookings_count: number; total_revenue: number; owner_commission: number; provider_payable: number }
    >();

    // Cargamos info de empleados por separado (necesitamos JOIN con users)
    const employeeIds: number[] = Array.from(
      new Set(accruals.map((a) => a.employee_id)),
    ) as number[];
    const employees = employeeIds.length
      ? await this.prisma.users.findMany({
          where: { id: { in: employeeIds } },
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        })
      : [];
    const empMap = new Map(employees.map((e) => [e.id, e]));

    for (const a of accruals) {
      const emp = empMap.get(a.employee_id);
      const empName =
        emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : 'Sin nombre asignado';
        (emp ? `${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() : 'Sin nombre');

      const e = byEmployeeMap.get(a.employee_id) ?? {
        display_name: empName,
        bookings_count: 0,
        total_revenue: 0,
        owner_commission: 0,
        provider_payable: 0,
      };
      e.bookings_count += 1;
      e.total_revenue += Number(a.base_amount);
      e.provider_payable += Number(a.commission_amount);
      // owner_commission = base - provider
      e.owner_commission = e.total_revenue - e.provider_payable;
      byEmployeeMap.set(a.employee_id, e);

      const s = byServiceMap.get(a.product_id) ?? {
        product_name: a.product?.name ?? `Producto ${a.product_id}`,
        bookings_count: 0,
        total_revenue: 0,
        owner_commission: 0,
        provider_payable: 0,
      };
      s.bookings_count += 1;
      s.total_revenue += Number(a.base_amount);
      s.provider_payable += Number(a.commission_amount);
      s.owner_commission = s.total_revenue - s.provider_payable;
      byServiceMap.set(a.product_id, s);
    }

    return {
      date: dayStart.toISOString().split('T')[0],
      totals: {
        ...totals,
        total_owner_commission: totals.total_revenue - totals.total_provider_payable,
      },
      by_mechanic: Array.from(byEmployeeMap.entries()).map(([employee_id, v]) => ({
        employee_id,
        ...v,
      })),
      by_service: Array.from(byServiceMap.entries()).map(([product_id, v]) => ({
        product_id,
        ...v,
      })),
    };
  }

  // ─── Cálculo del split ─────────────────────────────────────────────────

  /**
   * Calcula el split del dueño vs mecánico. Stub actual — la regla final
   * depende de las decisiones D1-D4 del líder. TODO: ajustar según feedback.
   */
  private calculateSplit(params: {
    base_amount: number;
    commission_pct: number;
  }): {
    base_amount: number;
    commission_pct: number;
    commission_amount: number;
  } {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const commission_amount = round2(
      params.base_amount * (params.commission_pct / 100),
    );
    return {
      base_amount: params.base_amount,
      commission_pct: params.commission_pct,
      commission_amount,
    };
  }
}