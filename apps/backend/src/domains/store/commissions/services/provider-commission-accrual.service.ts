import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

/**
 * Cálculo y registro del split dueño/mecánico por reserva de servicio.
 *
 * Por cada reserva que tiene un servicio con `owner_commission_pct`
 * configurado, este servicio crea UN registro en `booking_commission_accruals`
 * cuando se recibe el pago de la orden ligada. La fila es idempotente
 * (UNIQUE booking_id) — pagos subsecuentes de la misma reserva se ignoran
 * (documentado en plan: ver riesgos #2).
 *
 * Reversión: cuando la reserva pasa a `cancelled` o `no_show`, el accrual
 * se marca `status='reversed'` con timestamp + motivo. También dispara
 * `provider.commission.reversed` para que la contabilidad reversa el entry.
 */
@Injectable()
export class ProviderCommissionAccrualService {
  private readonly logger = new Logger(ProviderCommissionAccrualService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Calcula el split del dueño para una reserva cuando se recibe el pago.
   * Idempotente: si ya existe un accrual para el booking_id, retorna el
   * existente sin crear uno nuevo (catch P2002).
   *
   * Si el producto no tiene `owner_commission_pct` configurado, retorna
   * null sin crear nada (split deshabilitado para este servicio).
   */
  async accrueForPayment(params: {
    payment_id: number;
    order_id: number;
    store_id: number;
    organization_id: number;
  }): Promise<{ accrual_id: number; owner_amount: number; provider_amount: number } | null> {
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
    const existing = await this.prisma.booking_commission_accruals.findUnique({
      where: { booking_id: booking.id },
    });
    if (existing) {
      this.logger.debug(
        `accrueForPayment: accrual already exists for booking_id=${booking.id}, returning existing`,
      );
      return {
        accrual_id: existing.id,
        owner_amount: Number(existing.owner_amount),
        provider_amount: Number(existing.provider_amount),
      };
    }

    // 3. Cargar el producto y el service_provider para conocer el % y el empleado
    const [product, provider] = await Promise.all([
      this.prisma.products.findUnique({
        where: { id: booking.product_id },
        select: { id: true, owner_commission_pct: true },
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

    // 5. Determinar base_amount y calcular el split
    const order = await this.prisma.orders.findUnique({
      where: { id: booking.order_id ?? -1 },
      select: { subtotal_amount: true },
    });
    const baseAmount = order ? Number(order.subtotal_amount) : 0;
    const ownerPct = Number(product.owner_commission_pct);

    const split = this.calculateSplit({
      base_amount: baseAmount,
      owner_pct: ownerPct,
    });

    // 6. Crear el accrual (catch P2002 si hubo race con otro listener)
    try {
      const accrual = await this.prisma.booking_commission_accruals.create({
        data: {
          store_id: booking.store_id,
          organization_id: params.organization_id,
          booking_id: booking.id,
          order_id: booking.order_id,
          payment_id: params.payment_id,
          provider_id: booking.provider_id,
          employee_id: provider?.employee_id ?? null,
          product_id: booking.product_id,
          base_amount: split.base_amount,
          owner_pct_snapshot: split.owner_pct_snapshot,
          owner_amount: split.owner_amount,
          provider_amount: split.provider_amount,
        },
      });

      this.logger.log(
        `accrueForPayment: created accrual ${accrual.id} for booking_id=${booking.id} ` +
          `(owner=${split.owner_amount}, provider=${split.provider_amount})`,
      );

      this.eventEmitter.emit('provider.commission.accrued', {
        accrual_id: accrual.id,
        store_id: booking.store_id,
        organization_id: params.organization_id,
        booking_id: booking.id,
        product_id: booking.product_id,
        base_amount: Number(accrual.base_amount),
        owner_amount: Number(accrual.owner_amount),
        provider_amount: Number(accrual.provider_amount),
      });

      return {
        accrual_id: accrual.id,
        owner_amount: Number(accrual.owner_amount),
        provider_amount: Number(accrual.provider_amount),
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Race condition: otro listener creó primero. Retornar el existente.
        const existingAfter = await this.prisma.booking_commission_accruals.findUnique({
          where: { booking_id: booking.id },
        });
        if (existingAfter) {
          return {
            accrual_id: existingAfter.id,
            owner_amount: Number(existingAfter.owner_amount),
            provider_amount: Number(existingAfter.provider_amount),
          };
        }
      }
      throw error;
    }
  }

  /**
   * Reversa el accrual de una reserva (cancel o no_show).
   * Idempotente: si ya está reversado, retorna sin error.
   */
  async reverseForBooking(params: {
    booking_id: number;
    reason: 'cancelled' | 'no_show';
  }): Promise<void> {
    const existing = await this.prisma.booking_commission_accruals.findUnique({
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

    await this.prisma.booking_commission_accruals.update({
      where: { id: existing.id },
      data: {
        status: 'reversed',
        reversed_at: new Date(),
        reversed_reason: params.reason,
      },
    });

    this.eventEmitter.emit('provider.commission.reversed', {
      accrual_id: existing.id,
      store_id: existing.store_id,
      organization_id: existing.organization_id,
      booking_id: existing.booking_id,
    });

    this.logger.log(
      `reverseForBooking: reversed accrual ${existing.id} for booking_id=${params.booking_id} (reason=${params.reason})`,
    );
  }

  /**
   * Resumen diario del split para el reporte al cierre del día.
   *
   * Filtra por `bookings.date` (un Date puro, sin hora). La conversión a
   * timezone de tienda se hace a nivel del controller con la convención
   * de `vendix-date-timezone` skill.
   *
   * Retorna: totales + breakdown por mecánico + breakdown por servicio +
   * lista plana de reservas del día.
   */
  async getDailySummary(params: {
    store_id: number;
    date: Date;
    provider_id?: number;
    product_id?: number;
  }): Promise<{
    date: string;
    totals: {
      total_revenue: number;
      total_owner_commission: number;
      total_provider_payable: number;
      bookings_count: number;
    };
    by_mechanic: Array<{
      employee_id: number | null;
      display_name: string;
      bookings_count: number;
      total_revenue: number;
      owner_commission: number;
      provider_payable: number;
    }>;
    by_service: Array<{
      product_id: number;
      product_name: string;
      bookings_count: number;
      total_revenue: number;
      owner_commission: number;
      provider_payable: number;
    }>;
  }> {
    const dayStart = new Date(params.date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const whereBookings: Prisma.bookingsWhereInput = {
      store_id: params.store_id,
      date: { gte: dayStart, lt: dayEnd },
      commission_accrual: { isNot: null },
    };
    if (params.provider_id) whereBookings.provider_id = params.provider_id;
    if (params.product_id) whereBookings.product_id = params.product_id;

    const bookings = await this.prisma.bookings.findMany({
      where: whereBookings,
      include: {
        commission_accrual: true,
        provider: { include: { employee: true } },
        product: { select: { id: true, name: true } },
      },
      orderBy: { start_time: 'asc' },
    });

    // Filtrar los que el accrual es null (por si el include no filter) y los reversed
    const activeBookings = bookings.filter(
      (b) => b.commission_accrual && b.commission_accrual.status === 'accrued',
    );

    const totals = activeBookings.reduce(
      (acc, b) => {
        const a = b.commission_accrual!;
        acc.total_revenue += Number(a.base_amount);
        acc.total_owner_commission += Number(a.owner_amount);
        acc.total_provider_payable += Number(a.provider_amount);
        acc.bookings_count += 1;
        return acc;
      },
      { total_revenue: 0, total_owner_commission: 0, total_provider_payable: 0, bookings_count: 0 },
    );

    const byMechanicMap = new Map<
      number | null,
      { display_name: string; bookings_count: number; total_revenue: number; owner_commission: number; provider_payable: number }
    >();
    const byServiceMap = new Map<
      number,
      { product_name: string; bookings_count: number; total_revenue: number; owner_commission: number; provider_payable: number }
    >();

    for (const b of activeBookings) {
      const a = b.commission_accrual!;
      const mKey = b.provider?.employee_id ?? null;
      const mName = b.provider?.display_name
        ?? b.provider?.employee
          ? `${b.provider.employee.first_name ?? ''} ${b.provider.employee.last_name ?? ''}`.trim()
          : 'Sin mecánico asignado';
      const m = byMechanicMap.get(mKey) ?? {
        display_name: mName,
        bookings_count: 0,
        total_revenue: 0,
        owner_commission: 0,
        provider_payable: 0,
      };
      m.bookings_count += 1;
      m.total_revenue += Number(a.base_amount);
      m.owner_commission += Number(a.owner_amount);
      m.provider_payable += Number(a.provider_amount);
      byMechanicMap.set(mKey, m);

      const sKey = b.product_id;
      const sName = b.product?.name ?? `Producto ${b.product_id}`;
      const s = byServiceMap.get(sKey) ?? {
        product_name: sName,
        bookings_count: 0,
        total_revenue: 0,
        owner_commission: 0,
        provider_payable: 0,
      };
      s.bookings_count += 1;
      s.total_revenue += Number(a.base_amount);
      s.owner_commission += Number(a.owner_amount);
      s.provider_payable += Number(a.provider_amount);
      byServiceMap.set(sKey, s);
    }

    return {
      date: dayStart.toISOString().split('T')[0],
      totals,
      by_mechanic: Array.from(byMechanicMap.entries()).map(([employee_id, v]) => ({
        employee_id,
        ...v,
      })),
      by_service: Array.from(byServiceMap.entries()).map(([product_id, v]) => ({
        product_id,
        ...v,
      })),
    };
  }

  /**
   * TODO(human): Calcular el split del dueño vs mecánico.
   *
   * Esta función define LA REGLA DE NEGOCIO central de la feature.
   * Tenés que decidir:
   *
   * 1. ¿Cuál es la base del cálculo? Te paso `base_amount` (= subtotal
   *    de la orden) y `owner_pct` (= products.owner_commission_pct).
   *    ¿Querés usar el subtotal puro, o querés descontar impuestos / propinas
   *    / descuentos antes de calcular el %?
   *
   * 2. ¿Cómo se reparte lo que sobra? Si base = 10000 y owner_pct = 20,
   *    owner_amount = 2000 y provider_amount = 8000. ¿Pero si por
   *    redondeos no da exacto, quién se queda el centavo? ¿Dueño o mecánico?
   *
   * 3. ¿Qué moneda / escala? La columna owner_amount es DECIMAL(14, 2).
   *    Usá `round2()` (Math.round(n * 100) / 100) para mantener la
   *    convención del repo.
   *
   * Devolvé un objeto con: base_amount, owner_pct_snapshot, owner_amount,
   * provider_amount. Todos como `number` (Prisma convierte a Decimal al
   * insertar).
   */
  private calculateSplit(params: {
    base_amount: number;
    owner_pct: number;
  }): {
    base_amount: number;
    owner_pct_snapshot: number;
    owner_amount: number;
    provider_amount: number;
  } {
    // TODO(human): reemplazar este stub con la lógica real
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const owner_amount = round2(params.base_amount * (params.owner_pct / 100));
    const provider_amount = round2(params.base_amount - owner_amount);
    return {
      base_amount: params.base_amount,
      owner_pct_snapshot: params.owner_pct,
      owner_amount,
      provider_amount,
    };
  }
}