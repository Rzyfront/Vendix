import { Injectable } from '@nestjs/common';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';

export interface RefundMethodOption {
  value: 'original_payment' | 'cash' | 'bank_transfer' | 'store_credit';
  label: string;
  icon: string;
  available: boolean;
  reason_unavailable?: string;
}

export interface AvailableRefundMethods {
  methods: RefundMethodOption[];
  bank_accounts: { id: number; label: string }[];
}

/**
 * REFUND OVERHAUL — Resuelve qué métodos de reembolso puede ejecutar la
 * tienda. El frontend (order-refund-modal) consume este endpoint y nunca
 * debe mostrar un método que el backend rechazaría.
 *
 * Reglas de disponibilidad (sobreescriben PR-576, que era demasiado
 * restrictivo: 198/198 pagos reales excluidos de `original_payment`,
 * 16/16 tiendas excluidas de `cash` por `pos.cash_register.enabled=false`,
 * y solo 1 cuenta bancaria habilitaba `bank_transfer`):
 *
 *   - `original_payment`: la orden debe tener al menos un pago activo
 *     (state in ['succeeded', 'pending']). El processor es responsabilidad
 *     del gateway — no exigimos `is_active` ni `state='enabled'` aquí
 *     porque ese chequeo ya lo hace `RefundFlowService` al ejecutar el
 *     refund, y negarlo a nivel UI ocultaba el 100% de los pagos reales.
 *
 *   - `cash`: siempre disponible. La caja se valida al ejecutar el refund;
 *     exigir `pos.cash_register.enabled` aquí dejaba a la tienda muda en
 *     producción aunque tuviera caja operativa.
 *
 *   - `bank_transfer`: siempre disponible. La lista `bank_accounts` se
 *     devuelve (puede venir vacía) para que el selector del modal se
 *     renderice — la disponibilidad del método ya no depende de que
 *     existan cuentas configuradas.
 *
 *   - `store_credit`: requiere `order.customer_id`. Sin cliente no hay
 *     billetera donde depositar el saldo a favor.
 */
@Injectable()
export class RefundMethodsService {
  constructor(private readonly prisma: StorePrismaService) {}

  async getAvailableMethods(orderId: number): Promise<AvailableRefundMethods> {
    const order = await this.prisma.orders.findFirst({
      where: { id: orderId },
      select: {
        store_id: true,
        customer_id: true,
        payments: {
          where: { state: { in: ['succeeded', 'pending'] } },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!order) {
      return {
        methods: [
          this.disabled('original_payment', 'Order not found'),
          this.disabled('cash', 'Order not found'),
          this.disabled('bank_transfer', 'Order not found'),
          this.enabled('store_credit'),
        ],
        bank_accounts: [],
      };
    }

    // Cuentas bancarias — siempre se devuelven (puede ser []) para que el
    // selector del modal se renderice. La disponibilidad del método ya no
    // depende de que existan cuentas; si el operador elige transferencia
    // sin cuentas configuradas, el flujo `RefundFlowService` determinará
    // si hay fallback a otra vía.
    const bankAccounts = await this.prisma.bank_accounts.findMany({
      where: {
        OR: [{ store_id: order.store_id }, { store_id: null }],
        status: 'active',
      },
      select: { id: true, name: true, account_number: true, bank_name: true },
      orderBy: { name: 'asc' },
    });

    const originalPaymentAvailable = order.payments.length > 0;

    const methods: RefundMethodOption[] = [
      {
        value: 'original_payment',
        label: 'Pago original',
        icon: 'rotate-ccw',
        available: originalPaymentAvailable,
        reason_unavailable: originalPaymentAvailable
          ? undefined
          : 'La orden no tiene pagos registrados',
      },
      {
        value: 'cash',
        label: 'Efectivo',
        icon: 'banknote',
        available: true,
        reason_unavailable: undefined,
      },
      {
        value: 'bank_transfer',
        label: 'Transferencia',
        icon: 'landmark',
        available: true,
        reason_unavailable: undefined,
      },
      // `store_credit` requiere cliente: la billetera pertenece al cliente
      // y sin `customer_id` no hay destino para el saldo a favor.
      {
        value: 'store_credit',
        label: 'Billetera del cliente',
        icon: 'wallet',
        available: !!order.customer_id,
        reason_unavailable:
          order.customer_id
            ? undefined
            : 'La orden no tiene un cliente asociado para recibir el saldo a favor',
      },
    ];

    return {
      methods,
      bank_accounts: bankAccounts.map((b) => ({
        id: b.id,
        label: `${b.name} — ${b.bank_name} (${b.account_number})`,
      })),
    };
  }

  private enabled(value: RefundMethodOption['value']): RefundMethodOption {
    return this.option(value, true);
  }

  private disabled(
    value: RefundMethodOption['value'],
    reason: string,
  ): RefundMethodOption {
    return this.option(value, false, reason);
  }

  private option(
    value: RefundMethodOption['value'],
    available: boolean,
    reason_unavailable?: string,
  ): RefundMethodOption {
    const meta: Record<
      RefundMethodOption['value'],
      { label: string; icon: string }
    > = {
      original_payment: { label: 'Pago original', icon: 'rotate-ccw' },
      cash: { label: 'Efectivo', icon: 'banknote' },
      bank_transfer: { label: 'Transferencia', icon: 'landmark' },
      store_credit: { label: 'Billetera del cliente', icon: 'wallet' },
    };
    return {
      value,
      label: meta[value].label,
      icon: meta[value].icon,
      available,
      reason_unavailable,
    };
  }
}