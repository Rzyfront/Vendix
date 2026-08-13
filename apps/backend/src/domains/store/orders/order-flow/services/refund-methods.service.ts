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
 * REFUND OVERHAUL — Resolves which refund methods the calling store can
 * actually execute. The frontend's order-refund-modal renders the dropdown
 * from this response (never hardcoded) so operators never select a method
 * that the backend will reject.
 *
 * Logic per method:
 *   - `original_payment`: enabled if the order's payment has a configured
 *     processor (system_payment_method.is_active AND
 *     store_payment_methods.state = 'enabled'). Otherwise the merchant has
 *     no way to actually reverse the money at the gateway, so the method is
 *     hidden.
 *   - `cash`: enabled if the store has cash register enabled
 *     (settings.cash_register.enabled) AND the order has a customer (cash
 *     refunds pay out of the drawer — no customer means no destination).
 *   - `bank_transfer`: enabled if the store has at least one active
 *     bank_account. The modal exposes the list as `bank_accounts` so the
 *     operator picks the destination.
 *   - `store_credit`: always enabled. The wallet row is created on demand
 *     by WalletService.getOrCreateWallet().
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
          select: {
            store_payment_method_id: true,
            store_payment_method: {
              select: {
                state: true,
                system_payment_method: {
                  select: { type: true, is_active: true },
                },
              },
            },
          },
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

    // Cash register gate
    const cashRegisterSetting = await this.prisma.store_settings.findFirst({
      where: {
        store_id: order.store_id,
      },
      select: { settings: true },
    });
    const cashRegisterEnabled =
      readBool(cashRegisterSetting?.settings, 'cash_register')?.enabled === true ||
      readBool(cashRegisterSetting?.settings, 'cash_register') === true;
    const cashAvailable = cashRegisterEnabled && !!order.customer_id;

    // Bank accounts
    const bankAccounts = await this.prisma.bank_accounts.findMany({
      where: {
        store_id: order.store_id,
        status: 'active',
      },
      select: { id: true, name: true, account_number: true, bank_name: true },
      orderBy: { name: 'asc' },
    });

    // Original payment processor gate
    const payment = order.payments[0];
    const sm = payment?.store_payment_method;
    const originalPaymentAvailable =
      !!payment &&
      !!sm &&
      sm.state === 'enabled' &&
      !!sm.system_payment_method?.is_active &&
      sm.system_payment_method.type !== 'cash' &&
      sm.system_payment_method.type !== 'cash_on_delivery' &&
      sm.system_payment_method.type !== 'bank_transfer';

    const methods: RefundMethodOption[] = [
      {
        value: 'original_payment',
        label: 'Pago original',
        icon: 'rotate-ccw',
        available: originalPaymentAvailable,
        reason_unavailable: originalPaymentAvailable
          ? undefined
          : !payment
            ? 'La orden no tiene pagos registrados'
            : !sm
              ? 'No hay método de pago configurado para esta orden'
              : sm.state !== 'enabled'
                ? 'El método de pago no está habilitado en la tienda'
                : !sm.system_payment_method?.is_active
                  ? 'El método de pago está inactivo a nivel plataforma'
                  : 'El método de pago original no es reversible vía processor',
      },
      {
        value: 'cash',
        label: 'Efectivo',
        icon: 'banknote',
        available: cashAvailable,
        reason_unavailable: cashAvailable
          ? undefined
          : !cashRegisterEnabled
            ? 'Caja registradora deshabilitada — actívala en Configuración'
            : 'La orden no tiene un cliente asociado para recibir el reembolso',
      },
      {
        value: 'bank_transfer',
        label: 'Transferencia',
        icon: 'landmark',
        available: bankAccounts.length > 0,
        reason_unavailable:
          bankAccounts.length > 0
            ? undefined
            : 'No hay cuentas bancarias activas registradas',
      },
      this.enabled('store_credit'),
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
      store_credit: { label: 'Billetera', icon: 'wallet' },
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

// Settings values are stored as JSONB in store_settings.value. A missing
// key reads as {}; the legacy "enabled" boolean is the gate we care about.
function readBool(value: any, key: string): boolean | undefined {
  if (value == null) return undefined;
  const obj = typeof value === 'string' ? safeJson(value) : value;
  if (obj && typeof obj === 'object' && key in obj) {
    return Boolean((obj as any)[key]);
  }
  return undefined;
}

function safeJson(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
