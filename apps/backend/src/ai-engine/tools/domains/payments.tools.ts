import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { PaymentsService } from '../../../domains/store/payments/payments.service';
import { StorePaymentMethodsService } from '../../../domains/store/payments/services/store-payment-methods.service';
import {
  CreateOrderPaymentDto,
  CreatePaymentDto,
  RefundPaymentDto,
} from '../../../domains/store/payments/dto/create-payment.dto';

export interface PaymentToolDeps {
  paymentsService: PaymentsService;
  storePaymentMethodsService: StorePaymentMethodsService;
}

function toolError(
  message: string,
  nextStep?: string,
  code?: string,
): string {
  return JSON.stringify({
    error: message,
    ...(nextStep ? { next_step: nextStep } : {}),
    ...(code ? { code } : {}),
  });
}

function previewError(
  target: string,
  message: string,
  domain = 'payments',
): ToolPreview {
  return { status: 'error', target, changes: [], message, domain };
}

function toValidatedDto<T extends object>(
  DtoClass: new () => T,
  plain: Record<string, unknown>,
): { ok: true; dto: T } | { ok: false; message: string } {
  const dto = plainToInstance(DtoClass, plain, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (!errors.length) return { ok: true, dto };
  const details = errors
    .flatMap((entry) => Object.values(entry.constraints ?? {}))
    .join('; ');
  return {
    ok: false,
    message: `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
  };
}

function describeError(error: unknown): { code?: string; message: string } {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    const message =
      typeof response === 'string'
        ? response
        : (response?.message ?? error.message);
    return { code: error.errorCode, message };
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as
      | { message?: unknown; error_code?: string }
      | string;
    if (typeof response === 'string') return { message: response };
    const raw = response?.message;
    const message = Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
    return {
      ...(response?.error_code && { code: response.error_code }),
      message,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * O-30..O-32 — POS y pagos P0 (paso 6 del lote O).
 *
 * Cobro directo vía `PaymentsService`: no depende de una UI abierta, a
 * diferencia de `ui_pos_checkout`. El read O-31 (`get_payment_status`) es la
 * cadena de validación obligatoria de los writes: el agente consulta el estado
 * del pago antes de proponer crearlo (verifica el medio) o reembolsarlo
 * (verifica cobertura y estado).
 *
 * `refund_payment` es reembolso de un PAGO (por `transaction_id`), distinto de
 * `refund_order` (reembolso de una ORDEN): operan sobre agregados diferentes y
 * no son intercambiables.
 *
 * Los métodos del servicio exigen el `user` del request (validan pertenencia a
 * la tienda); la tool lo reconstruye desde el contexto del turno.
 */
export function createPaymentTools(deps: PaymentToolDeps): RegisteredTool[] {
  const { paymentsService, storePaymentMethodsService } = deps;

  const buildUser = (context: Record<string, any>) => ({
    id: context.user_id,
    store_id: context.store_id,
    organization_id: context.organization_id,
    roles: context.roles ?? [],
  });

  const requireStore = (context: Record<string, any>) =>
    context.store_id
      ? null
      : JSON.stringify({
          error:
            'Sin tienda en contexto: los pagos están acotados por tienda.',
        });

  async function resolveMethodName(
    storePaymentMethodId: number,
  ): Promise<string | null> {
    try {
      const method =
        await storePaymentMethodsService.findOne(storePaymentMethodId);
      return (
        method?.system_payment_method?.name ??
        method?.system_payment_method?.type ??
        method?.name ??
        null
      );
    } catch {
      return null;
    }
  }

  return [
    // ─── O-31: get_payment_status (READ) ───────────────────────────────
    {
      name: 'get_payment_status',
      version: '1',
      domain: 'payments',
      readOnly: true,
      description:
        'Estado de un pago por su ID de transacción: estado (pending/succeeded/failed/refunded...), monto y fecha de pago. Cadena obligatoria antes de create_pos_payment y refund_payment: confirma cobertura, método y que el pago existe antes de proponer cualquier movimiento de dinero.',
      parameters: {
        type: 'object',
        properties: {
          payment_id: {
            type: 'string',
            description:
              'ID de transacción del pago (transaction_id), no el ID interno de la orden.',
          },
        },
        required: ['payment_id'],
      },
      requiredPermissions: ['store:pos:access'],
      handler: async (args, context) => {
        const missing = requireStore(context);
        if (missing) return missing;

        const paymentId = String(args.payment_id ?? '').trim();
        if (!paymentId) {
          return JSON.stringify({ error: 'payment_id vacío.' });
        }

        try {
          const result = await paymentsService.getPaymentStatus(
            paymentId,
            buildUser(context),
          );
          const status = result?.data ?? {};
          return JSON.stringify({
            payment_id: paymentId,
            estado: status.status ?? 'unknown',
            monto: status.amount ?? null,
            transaction_id: status.transactionId ?? paymentId,
            pagado_en: status.paidAt ?? null,
            reembolsable: !['refunded', 'failed'].includes(status.status),
          });
        } catch (error) {
          const info = describeError(error);
          return JSON.stringify({
            error: `No se pudo leer el pago ${paymentId}: ${info.message}`,
            next_step:
              'Verifica el transaction_id: es el ID de transacción del pago, no el número de orden.',
          });
        }
      },
    },

    // ─── O-30: create_pos_payment (WRITE) ──────────────────────────────
    {
      name: 'create_pos_payment',
      version: '1',
      domain: 'payments',
      description:
        'Cobra en POS sin depender de una UI abierta. Dos modos: existing_order cobra una orden ya creada (order_id + amount + store_payment_method_id); new_order crea la orden desde los items y la cobra en el mismo acto (items + customer_email + customer_name + amount + store_payment_method_id). El monto lo valida el servidor contra la orden (compuerta anti-sobrepago).',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['existing_order', 'new_order'],
            description:
              'existing_order: cobra una orden existente. new_order: crea la orden desde items y la cobra.',
          },
          order_id: {
            type: 'number',
            description: 'ID de la orden (requerido en existing_order).',
          },
          amount: {
            type: 'number',
            description: 'Monto a cobrar (mayor que cero).',
          },
          currency: {
            type: 'string',
            description: 'Moneda ISO (por defecto COP).',
          },
          store_payment_method_id: {
            type: 'number',
            description: 'Medio de pago de la tienda.',
          },
          items: {
            type: 'array',
            description:
              'Items de la venta (requerido en new_order): product_id, product_name, quantity, unit_price y total_price.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                product_name: { type: 'string' },
                quantity: { type: 'number' },
                unit_price: { type: 'number' },
                total_price: { type: 'number' },
              },
              required: [
                'product_id',
                'product_name',
                'quantity',
                'unit_price',
                'total_price',
              ],
            },
          },
          customer_email: {
            type: 'string',
            description: 'Correo del cliente (requerido en new_order).',
          },
          customer_name: {
            type: 'string',
            description: 'Nombre del cliente (requerido en new_order).',
          },
          customer_phone: {
            type: 'string',
            description: 'Teléfono del cliente (opcional, new_order).',
          },
        },
        required: ['mode', 'amount', 'store_payment_method_id'],
      },
      requiredPermissions: ['store:pos:access'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context) => {
        const missing = requireStore(context);
        if (missing) {
          return previewError(
            'Cobro POS',
            'Sin tienda en contexto: los pagos están acotados por tienda.',
          );
        }

        const mode = String(args.mode ?? '');
        if (!['existing_order', 'new_order'].includes(mode)) {
          return previewError(
            'Cobro POS',
            `mode "${mode}" inválido. Usa existing_order o new_order.`,
          );
        }

        const amount = Number(args.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          return previewError(
            'Cobro POS',
            'amount debe ser un número mayor que cero.',
          );
        }

        const methodId = toPositiveInt(args.store_payment_method_id);
        if (!methodId) {
          return previewError('Cobro POS', 'store_payment_method_id inválido.');
        }

        try {
          const methodName = await resolveMethodName(methodId);
          if (!methodName) {
            return previewError(
              'Cobro POS',
              `El medio de pago ${methodId} no existe o no está habilitado en esta tienda.`,
            );
          }

          if (mode === 'existing_order') {
            const orderId = toPositiveInt(args.order_id);
            if (!orderId) {
              return previewError(
                'Cobro POS',
                'existing_order exige order_id.',
              );
            }
            return {
              status: 'warning',
              target: `Cobro $${amount} — orden #${orderId} vía ${methodName}`,
              changes: [
                {
                  field: 'order',
                  label: 'Orden',
                  from: null,
                  to: `#${orderId}`,
                },
                {
                  field: 'amount',
                  label: 'Monto',
                  from: null,
                  to: `$${amount} ${String(args.currency ?? 'COP')}`,
                },
                {
                  field: 'method',
                  label: 'Medio',
                  from: null,
                  to: methodName,
                },
              ],
              message:
                'El servidor valida el monto contra el saldo de la orden (compuerta anti-sobrepago) y bloquea sin stock salvo sobreventa explícita.',
              domain: 'payments',
            };
          }

          const items = Array.isArray(args.items) ? args.items : [];
          if (!items.length) {
            return previewError(
              'Cobro POS',
              'new_order exige al menos un item en items.',
            );
          }
          if (!args.customer_email || !args.customer_name) {
            return previewError(
              'Cobro POS',
              'new_order exige customer_email y customer_name.',
            );
          }
          const detail = items
            .map(
              (line: any) =>
                `${line?.product_name ?? `#${line?.product_id}`} x${line?.quantity ?? '?'}`,
            )
            .join('; ');
          return {
            status: 'warning',
            target: `Cobro $${amount} — nueva orden para ${String(args.customer_name)} vía ${methodName}`,
            changes: [
              {
                field: 'customer',
                label: 'Cliente',
                from: null,
                to: `${String(args.customer_name)} <${String(args.customer_email)}>`,
              },
              {
                field: 'items',
                label: 'Items',
                from: null,
                to: detail,
              },
              {
                field: 'amount',
                label: 'Monto',
                from: null,
                to: `$${amount} ${String(args.currency ?? 'COP')}`,
              },
              {
                field: 'method',
                label: 'Medio',
                from: null,
                to: methodName,
              },
            ],
            message:
              'Crea la orden y la cobra en el mismo acto. El servidor valida stock antes de cobrar.',
            domain: 'payments',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Cobro POS', info.message);
        }
      },
      handler: async (args, context) => {
        const missing = requireStore(context);
        if (missing) return missing;

        const mode = String(args.mode ?? '');
        const storeId = Number(context.store_id);

        try {
          // Re-verificación común: el medio sigue habilitado en la tienda.
          const methodId = toPositiveInt(args.store_payment_method_id);
          if (!methodId) {
            return toolError('store_payment_method_id inválido.');
          }
          const methodName = await resolveMethodName(methodId);
          if (!methodName) {
            return toolError(
              `El medio de pago ${methodId} ya no está habilitado en esta tienda.`,
            );
          }

          if (mode === 'existing_order') {
            const orderId = toPositiveInt(args.order_id);
            if (!orderId) {
              return toolError('existing_order exige order_id.');
            }
            const checked = toValidatedDto(CreatePaymentDto, {
              orderId,
              amount: Number(args.amount),
              currency: String(args.currency ?? 'COP'),
              storePaymentMethodId: methodId,
              storeId,
            });
            if (!checked.ok) return toolError(checked.message);
            const result = await paymentsService.processPayment(
              checked.dto,
              buildUser(context),
            );
            return JSON.stringify({
              resumen: `Cobro de $${args.amount} aplicado a la orden #${orderId} vía ${methodName}`,
              order_id: orderId,
              medio: methodName,
              resultado: result?.data ?? result,
            });
          }

          if (mode === 'new_order') {
            const items = Array.isArray(args.items) ? args.items : [];
            if (
              !items.length ||
              !args.customer_email ||
              !args.customer_name
            ) {
              return toolError(
                'new_order exige items, customer_email y customer_name.',
              );
            }
            const checked = toValidatedDto(CreateOrderPaymentDto, {
              // El gateway IGNORA este campo en with-order: la orden se crea
              // desde los datos (createOrderFromPaymentData) y su id real
              // reemplaza al enviado. Viaja 0 porque el DTO lo exige.
              orderId: 0,
              amount: Number(args.amount),
              currency: String(args.currency ?? 'COP'),
              storePaymentMethodId: methodId,
              storeId,
              customerEmail: String(args.customer_email),
              customerName: String(args.customer_name),
              ...(args.customer_phone
                ? { customerPhone: String(args.customer_phone) }
                : {}),
              items: items.map((line: any) => ({
                productId: Number(line.product_id),
                ...(line.product_variant_id !== undefined
                  ? {
                      productVariantId: Number(line.product_variant_id),
                    }
                  : {}),
                productName: String(line.product_name),
                quantity: Number(line.quantity),
                unitPrice: Number(line.unit_price),
                totalPrice: Number(line.total_price),
              })),
            });
            if (!checked.ok) return toolError(checked.message);
            const result = await paymentsService.processPaymentWithOrder(
              checked.dto,
              buildUser(context),
            );
            return JSON.stringify({
              resumen: `Orden creada y cobrada: $${args.amount} a ${String(args.customer_name)} vía ${methodName}`,
              medio: methodName,
              resultado: result?.data ?? result,
            });
          }

          return toolError(
            `mode "${mode}" inválido. Usa existing_order o new_order.`,
          );
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Verifica el saldo de la orden, el stock disponible y que el medio siga habilitado antes de reintentar.',
            info.code,
          );
        }
      },
    },

    // ─── O-32: refund_payment (WRITE) ──────────────────────────────────
    {
      name: 'refund_payment',
      version: '1',
      domain: 'payments',
      description:
        'Reembolsa un PAGO por su transaction_id (total o parcial con amount). Distinto de refund_order: este opera sobre el pago, aquel sobre la orden. Lee primero con get_payment_status: el preview cita cobertura y método, y el handler re-verifica que el pago siga siendo reembolsable.',
      parameters: {
        type: 'object',
        properties: {
          payment_id: {
            type: 'string',
            description: 'ID de transacción del pago a reembolsar.',
          },
          amount: {
            type: 'number',
            description:
              'Monto parcial a reembolsar. Omitirlo reembolsa el total.',
          },
          reason: {
            type: 'string',
            description: 'Motivo del reembolso (auditoría).',
          },
        },
        required: ['payment_id'],
      },
      requiredPermissions: ['store:pos:access'],
      requiresConfirmation: true,
      irreversible: true,
      preview: async (args, context) => {
        const missing = requireStore(context);
        if (missing) {
          return previewError(
            'Reembolso de pago',
            'Sin tienda en contexto: los pagos están acotados por tienda.',
          );
        }

        const paymentId = String(args.payment_id ?? '').trim();
        if (!paymentId) {
          return previewError('Reembolso de pago', 'payment_id vacío.');
        }

        try {
          const result = await paymentsService.getPaymentStatus(
            paymentId,
            buildUser(context),
          );
          const status = result?.data ?? {};
          if (['refunded', 'failed'].includes(status.status)) {
            return previewError(
              `Reembolso de pago ${paymentId}`,
              `El pago está en «${status.status}»: ya no es reembolsable.`,
            );
          }
          const amount =
            args.amount !== undefined ? Number(args.amount) : null;
          if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
            return previewError(
              `Reembolso de pago ${paymentId}`,
              'amount debe ser un número mayor que cero.',
            );
          }
          return {
            status: 'warning',
            target: `Reembolso de pago ${paymentId}${status.amount ? ` ($${status.amount})` : ''}`,
            changes: [
              {
                field: 'payment_status',
                label: 'Estado del pago',
                from: status.status ?? 'unknown',
                to: amount !== null ? 'partially_refunded' : 'refunded',
              },
              {
                field: 'amount',
                label: 'Monto a reembolsar',
                from: null,
                to: amount !== null ? `$${amount}` : 'total',
              },
            ],
            message:
              'Mueve dinero de vuelta al cliente. No toca el estado de la orden: si hay que devolver la orden completa, usa refund_order.',
            domain: 'payments',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError(
            `Reembolso de pago ${paymentId}`,
            info.message,
          );
        }
      },
      handler: async (args, context) => {
        const missing = requireStore(context);
        if (missing) return missing;

        const paymentId = String(args.payment_id ?? '').trim();
        if (!paymentId) {
          return toolError('payment_id vacío.');
        }

        try {
          // Re-verificación: el pago sigue existiendo y siendo reembolsable.
          const fresh = await paymentsService.getPaymentStatus(
            paymentId,
            buildUser(context),
          );
          const freshStatus = fresh?.data?.status;
          if (['refunded', 'failed'].includes(freshStatus)) {
            return toolError(
              `El pago ${paymentId} ya está en «${freshStatus}»: nada que reembolsar.`,
            );
          }

          const checked = toValidatedDto(RefundPaymentDto, {
            paymentId,
            ...(args.amount !== undefined
              ? { amount: Number(args.amount) }
              : {}),
            ...(args.reason ? { reason: String(args.reason) } : {}),
          });
          if (!checked.ok) return toolError(checked.message);

          const result = await paymentsService.refundPayment(
            paymentId,
            checked.dto,
            buildUser(context),
          );
          return JSON.stringify({
            resumen: `Pago ${paymentId} reembolsado${args.amount !== undefined ? ` parcialmente ($${args.amount})` : ''}`,
            payment_id: paymentId,
            resultado: result?.data ?? result,
          });
        } catch (error) {
          const info = describeError(error);
          return toolError(
            info.message,
            'Lee el pago con get_payment_status para ver su estado actual antes de reintentar.',
            info.code,
          );
        }
      },
    },
  ];
}
