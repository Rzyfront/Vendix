import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
  ToolPreview,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { SubscriptionAccessService } from '../../../domains/store/subscriptions/services/subscription-access.service';
import { SubscriptionBillingService } from '../../../domains/store/subscriptions/services/subscription-billing.service';
import { SubscriptionPaymentService } from '../../../domains/store/subscriptions/services/subscription-payment.service';
import { SubscriptionStateService } from '../../../domains/store/subscriptions/services/subscription-state.service';
import { SubscriptionProrationService } from '../../../domains/store/subscriptions/services/subscription-proration.service';
import { SubscriptionResolverService } from '../../../domains/store/subscriptions/services/subscription-resolver.service';
import { SubscriptionQueryDto } from '../../../domains/store/subscriptions/dto/subscription-query.dto';
import { PayDueDto } from '../../../domains/store/subscriptions/dto/pay-due.dto';
import { SubscribeDto } from '../../../domains/store/subscriptions/dto/subscribe.dto';
import { CancelDto } from '../../../domains/store/subscriptions/dto/cancel.dto';

export interface SubscriptionToolDeps {
  subscriptionAccessService: SubscriptionAccessService;
  subscriptionBillingService: SubscriptionBillingService;
  subscriptionPaymentService: SubscriptionPaymentService;
  subscriptionStateService: SubscriptionStateService;
  subscriptionProrationService: SubscriptionProrationService;
  subscriptionResolverService: SubscriptionResolverService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F-71.. (misma que `withholding.tools.ts`: los handlers NO
// lanzan, devuelven `{error, next_step}` en español; cero acceso directo a la
// base de datos aquí — toda lectura va al service dueño).
//
// Permisos verificados en código (paso 7, sin inventar):
// - `subscriptions:read` es el `@Permissions` de GET current,
//   GET current/dunning-state y GET current/invoices en
//   `store-subscriptions.controller.ts`.
// - GET current/invoices además exige `@Roles(OWNER, SUPER_ADMIN)`: el handler
//   de F-73 lo replica contra `context.roles` (fail-closed).
// - Reads puros sin gate de suscripción: el gate (`StoreOperationsGuard`) solo
//   cubre writes POST/PATCH/PUT/DELETE.
// ─────────────────────────────────────────────────────────────────────────────

const SUBSCRIPTIONS_READ = 'subscriptions:read';
// Verificados en código (paso 12, sin inventar):
// - `subscriptions:write` es el `@Permissions` de POST retry-payment,
//   subscribe y cancel (`store-subscriptions.controller.ts`) y de POST
//   preview/commit/retry-payment/pay-due (`subscription-checkout.controller.ts`).
// - `@Roles(OWNER, SUPER_ADMIN)`: en cada handler store (`retry-payment`,
//   `subscribe`, `cancel`, invoice detail) y a nivel de clase en el
//   checkout controller (cubre preview F-75 y pay-due F-77).
// - `GET current/access` y `GET usage` (`subscription-access.controller.ts`)
//   NO declaran `@Permissions` ni `@Roles` (solo auth + SkipSubscriptionGate):
//   F-80/F-81 los espejan sin `requiredPermissions`.
const SUBSCRIPTIONS_WRITE = 'subscriptions:write';
const OWNER_ROLES = ['owner', 'super_admin'];

/**
 * Espejo literal de `IRREVERSIBLE_DOMAINS['subscriptions']`
 * (`capability-registry.service.ts`, verificado en el paso 12): se copia y
 * no se importa para no arrastrar el grafo del bridge a esta familia; la
 * spec pinnea la igualdad para que no diverjan en silencio.
 */
const SUBSCRIPTIONS_IRREVERSIBLE_PHRASE =
  'Cambiar el plan modifica lo que el comercio paga por Vendix a partir del próximo periodo.';

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Valida un DTO ya construido como lo haría el `ValidationPipe` global del
 * HTTP (`whitelist` + `forbidNonWhitelisted`): las tools llaman a los
 * servicios directo, sin pasar por el pipe.
 */
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

/** Traduce una excepción del dominio a texto que el modelo pueda narrar. */
function describeReadError(error: unknown): string {
  if (error instanceof VendixHttpException) {
    const response = error.getResponse() as { message?: string } | string;
    return typeof response === 'string'
      ? response
      : (response?.message ?? error.message);
  }
  if (error instanceof HttpException) {
    const response = error.getResponse() as { message?: unknown } | string;
    if (typeof response === 'string') return response;
    const raw = response?.message;
    return Array.isArray(raw)
      ? raw.join('; ')
      : typeof raw === 'string'
        ? raw
        : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Error desconocido';
}

/** Respuesta de fallo de un handler de lectura. Nunca se lanza. */
function readToolError(message: string, nextStep?: string): string {
  return JSON.stringify({
    error: message,
    ...(nextStep && { next_step: nextStep }),
  });
}

function requireStoreId(
  context: ToolExecutionContext,
): { ok: true; storeId: number } | { ok: false; response: string } {
  const storeId = toPositiveInt(context.store_id);
  if (!storeId) {
    return {
      ok: false,
      response: readToolError(
        'Sin tienda en contexto: la suscripción se resuelve siempre dentro de un tenant.',
        'Reintenta desde una sesión con tienda seleccionada.',
      ),
    };
  }
  return { ok: true, storeId };
}

/** Los writes devuelven la misma forma `{error, next_step}` que los reads. */
function writeToolError(message: string, nextStep?: string): string {
  return readToolError(message, nextStep);
}

/**
 * Réplica del `@Roles(OWNER, SUPER_ADMIN)` de los endpoints store/checkout.
 * Fail-closed: sin rol owner/super_admin la tool no propone ni ejecuta.
 */
function hasOwnerRole(context: ToolExecutionContext): boolean {
  const roles = context.roles ?? [];
  return roles.some((role) => OWNER_ROLES.includes(role));
}

function ownerRolePreviewError(target: string): ToolPreview {
  return {
    status: 'error',
    target,
    changes: [],
    message:
      'Solo el owner o un super_admin puede hacer esto (réplica del @Roles del endpoint). Pide a un owner de la tienda que lo ejecute.',
  };
}

function ownerRoleHandlerError(): string {
  return writeToolError(
    'Solo el owner o un super_admin puede hacer esto (réplica del @Roles del endpoint).',
    'Pide a un owner de la tienda que lo ejecute.',
  );
}

/** Nivel del banner, espejo de `SubscriptionAccessController.bannerLevel`. */
function bannerLevel(state: string): string {
  switch (state) {
    case 'active':
    case 'trial':
      return 'none';
    case 'grace_soft':
      return 'warning';
    case 'grace_hard':
    case 'suspended':
    case 'blocked':
    case 'cancelled':
    case 'expired':
      return 'danger';
    case 'draft':
    default:
      return 'info';
  }
}

function projectInvoice(invoice: Record<string, any>) {
  const plan = invoice.store_subscription?.plan ?? null;
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number ?? null,
    state: invoice.state ?? null,
    total: invoice.total ?? null,
    amount_paid: invoice.amount_paid ?? null,
    currency: invoice.currency ?? null,
    issued_at: invoice.issued_at ?? null,
    due_at: invoice.due_at ?? null,
    paid_at: invoice.paid_at ?? null,
    period_start: invoice.period_start ?? null,
    period_end: invoice.period_end ?? null,
    line_items: invoice.line_items ?? null,
    split_breakdown: invoice.split_breakdown ?? null,
    plan: plan
      ? {
          code: plan.code ?? null,
          name: plan.name ?? null,
          billing_cycle: plan.billing_cycle ?? null,
        }
      : null,
  };
}

export function createSubscriptionTools(
  deps: SubscriptionToolDeps,
): RegisteredTool[] {
  const {
    subscriptionAccessService,
    subscriptionBillingService,
    subscriptionPaymentService,
    subscriptionStateService,
    subscriptionProrationService,
    subscriptionResolverService,
  } = deps;

  /**
   * Cadena habilitante de retry/pay_due (F-76/F-77): resuelve la factura
   * pagable desde el dunning (F-72). `which: 'latest'` espeja POST
   * retry-payment (issued_at desc); `'oldest'` espeja POST pay-due (id asc).
   * La usan `preview` y `handler` por igual (re-verificación).
   */
  const resolvePayableInvoice = async (
    storeId: number,
    which: 'latest' | 'oldest',
    invoiceId?: number,
  ): Promise<
    | {
        ok: true;
        invoice: {
          id: number;
          invoice_number: string | null;
          amount_due: number;
        };
        dunning: Record<string, any>;
      }
    | { ok: false; message: string; next_step: string }
  > => {
    let dunning: any;
    try {
      dunning =
        await subscriptionAccessService.getDunningStateForCurrentStore(storeId);
    } catch (error) {
      return {
        ok: false,
        message: `No pude leer la deuda (F-72): ${describeReadError(error)}`,
        next_step: 'Consulta el estado de dunning con get_dunning_state.',
      };
    }
    const overdue: Array<{
      id: number;
      invoice_number: string | null;
      amount_due: number;
    }> = dunning.invoices_overdue ?? [];
    if (overdue.length === 0) {
      return {
        ok: false,
        message: 'La tienda no tiene facturas pendientes de pago.',
        next_step:
          'Verifica el estado con get_subscription_status (F-71); si esperabas deuda, revisa el módulo de suscripción.',
      };
    }
    if (invoiceId) {
      const match = overdue.find((entry) => entry.id === invoiceId);
      if (!match) {
        return {
          ok: false,
          message: `La factura #${invoiceId} no tiene saldo pendiente.`,
          next_step:
            'Elige una factura con saldo desde get_dunning_state (F-72) u omite invoice_id para pagar la más antigua.',
        };
      }
      return { ok: true, invoice: match, dunning };
    }
    const picked =
      which === 'latest' ? overdue[overdue.length - 1] : overdue[0];
    return { ok: true, invoice: picked, dunning };
  };

  return [
    // ─── F-71: get_subscription_status ───────────────────────────────────
    {
      name: 'get_subscription_status',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Estado actual de la suscripción SaaS de la tienda: estado, plan, período, features resueltas, alertas de auto-renovación y factura pagable más antigua. Solo lectura, sin gate de suscripción. Habilita subscribe/cancel/retry (F-74..).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      requiredPermissions: [SUBSCRIPTIONS_READ],
      handler: async (_args, context: ToolExecutionContext) => {
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          return JSON.stringify(snapshot);
        } catch (error) {
          return readToolError(
            `No pude leer la suscripción: ${describeReadError(error)}`,
            'Reintenta en unos segundos; si persiste, revisa el estado en el módulo de suscripción.',
          );
        }
      },
    },

    // ─── F-72: get_dunning_state ─────────────────────────────────────────
    {
      name: 'get_dunning_state',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Estado de dunning (cobranza) de la tienda: estado, deadlines (gracia/suspensión/cancelación), facturas con saldo, total adeudado y features perdidas vs conservadas. Solo lectura, sin efectos secundarios. Habilita retry_subscription_payment (F-77).',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      requiredPermissions: [SUBSCRIPTIONS_READ],
      handler: async (_args, context: ToolExecutionContext) => {
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        try {
          const state =
            await subscriptionAccessService.getDunningStateForCurrentStore(
              store.storeId,
            );
          return JSON.stringify(state);
        } catch (error) {
          return readToolError(
            `No pude leer el estado de dunning: ${describeReadError(error)}`,
            'Reintenta en unos segundos; si persiste, revisa el estado en el módulo de suscripción.',
          );
        }
      },
    },

    // ─── F-73: list_subscription_invoices ────────────────────────────────
    {
      name: 'list_subscription_invoices',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Facturas SaaS de la suscripción de la tienda, paginadas (más recientes primero). Solo lectura. Réplica el control del endpoint: solo owner o super_admin.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Página (base 1).' },
          limit: { type: 'number', description: 'Registros por página.' },
        },
        required: [],
      },
      requiredPermissions: [SUBSCRIPTIONS_READ],
      handler: async (args, context: ToolExecutionContext) => {
        const roles = context.roles ?? [];
        if (!roles.some((role) => OWNER_ROLES.includes(role))) {
          return readToolError(
            'Solo el owner o un super_admin puede listar las facturas de la suscripción.',
            'Pide a un owner de la tienda que consulte las facturas.',
          );
        }
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const validated = toValidatedDto(SubscriptionQueryDto, {
          ...(args.page !== undefined && { page: args.page }),
          ...(args.limit !== undefined && { limit: args.limit }),
        });
        if (!validated.ok) {
          return readToolError(
            validated.message,
            'Revisa la paginación (page, limit).',
          );
        }
        try {
          const result = await subscriptionBillingService.listStoreInvoices(
            store.storeId,
            validated.dto,
          );
          return JSON.stringify(result);
        } catch (error) {
          return readToolError(
            `No pude listar las facturas: ${describeReadError(error)}`,
            'Verifica que la tienda tenga una suscripción creada.',
          );
        }
      },
    },

    // ─── F-74: get_subscription_invoice ──────────────────────────────────
    {
      name: 'get_subscription_invoice',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Detalle de una factura SaaS de la tienda: estado, totales, período, líneas y split Vendix/partner. Solo lectura. Réplica el control del endpoint: solo owner o super_admin.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: { type: 'number', description: 'ID de la factura.' },
        },
        required: ['invoice_id'],
      },
      requiredPermissions: [SUBSCRIPTIONS_READ],
      handler: async (args, context: ToolExecutionContext) => {
        if (!hasOwnerRole(context)) {
          return readToolError(
            'Solo el owner o un super_admin puede ver las facturas de la suscripción.',
            'Pide a un owner de la tienda que consulte la factura.',
          );
        }
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const invoiceId = toPositiveInt(args.invoice_id);
        if (!invoiceId) {
          return readToolError(
            'invoice_id inválido: debe ser un entero positivo.',
            'Lista las facturas con list_subscription_invoices (F-73).',
          );
        }
        try {
          const invoice =
            await subscriptionBillingService.getStoreInvoice(
              store.storeId,
              invoiceId,
            );
          return JSON.stringify(projectInvoice(invoice));
        } catch (error) {
          return readToolError(
            `No pude leer la factura #${invoiceId}: ${describeReadError(error)}`,
            'Verifica el ID con list_subscription_invoices (F-73).',
          );
        }
      },
    },

    // ─── F-75: preview_subscription_checkout ─────────────────────────────
    {
      name: 'preview_subscription_checkout',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Previsualiza un cambio de plan SIN persistir nada: prorrata a cobrar o crédito a favor, días restantes del ciclo y factura a emitir. Solo lectura. Habilita pay_subscription_due (F-77) cuando hay cambio de plan pendiente. Réplica el control del checkout: solo owner o super_admin.',
      parameters: {
        type: 'object',
        properties: {
          plan_id: {
            type: 'number',
            description: 'ID del plan destino.',
          },
        },
        required: ['plan_id'],
      },
      requiredPermissions: [SUBSCRIPTIONS_READ],
      handler: async (args, context: ToolExecutionContext) => {
        if (!hasOwnerRole(context)) {
          return readToolError(
            'Solo el owner o un super_admin puede previsualizar cambios de plan.',
            'Pide a un owner de la tienda que lo consulte.',
          );
        }
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const planId = toPositiveInt(args.plan_id);
        if (!planId) {
          return readToolError(
            'plan_id inválido: debe ser un entero positivo.',
            'Revisa el catálogo de planes en el módulo de suscripción.',
          );
        }
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          if (!snapshot.found || !snapshot.subscription) {
            return readToolError(
              'La tienda no tiene suscripción: no hay cambio de plan que previsualizar.',
              'Crea la suscripción con subscribe_plan (F-78).',
            );
          }
          const preview =
            await subscriptionProrationService.previewUpgrade(
              snapshot.subscription.id,
              planId,
            );
          return JSON.stringify(preview);
        } catch (error) {
          return readToolError(
            `No pude previsualizar el cambio de plan: ${describeReadError(error)}`,
            'Verifica el plan destino y que la suscripción exista (F-71).',
          );
        }
      },
    },

    // ─── F-76: retry_subscription_payment (write) ────────────────────────
    {
      name: 'retry_subscription_payment',
      version: '1',
      domain: 'subscriptions',
      description:
        'Reintenta el cobro de la factura SaaS pendiente más reciente con el medio de pago guardado (Wompi recurrente). Cadena: exige get_dunning_state (F-72) con deuda. Réplica el control del endpoint: solo owner o super_admin.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      requiredPermissions: [SUBSCRIPTIONS_WRITE],
      requiresConfirmation: true,
      preview: async (
        _args,
        context: ToolExecutionContext,
      ): Promise<ToolPreview> => {
        if (!hasOwnerRole(context)) {
          return ownerRolePreviewError('Reintentar cobro de suscripción');
        }
        const store = requireStoreId(context);
        if (!store.ok) {
          return {
            status: 'error',
            target: 'Reintentar cobro de suscripción',
            changes: [],
            message: JSON.parse(store.response).error,
          };
        }
        const gate = await resolvePayableInvoice(store.storeId, 'latest');
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Reintentar cobro de suscripción',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        return {
          status: 'ok',
          target: `Reintentar cobro de ${gate.invoice.invoice_number ?? `factura #${gate.invoice.id}`} · saldo ${gate.invoice.amount_due}`,
          changes: [
            {
              field: 'cobro',
              label: 'Cobro',
              from: 'pendiente',
              to: `charge a la factura #${gate.invoice.id} (medio guardado)`,
            },
          ],
          message:
            'Cadena verificada: F-72 (get_dunning_state) con deuda. El cobro usa el medio guardado; si no hay medio cobrable, la factura sigue pendiente y el dunning avanza.',
          domain: 'subscriptions',
        };
      },
      handler: async (_args, context: ToolExecutionContext) => {
        if (!hasOwnerRole(context)) return ownerRoleHandlerError();
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const gate = await resolvePayableInvoice(store.storeId, 'latest');
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        try {
          const payment = await subscriptionPaymentService.charge(
            gate.invoice.id,
          );
          return JSON.stringify({
            payment_id: (payment as any).id,
            invoice_id: gate.invoice.id,
            state: (payment as any).state,
          });
        } catch (error) {
          return writeToolError(
            `No pude reintentar el cobro de la factura #${gate.invoice.id}: ${describeReadError(error)}`,
            'Revisa el medio de pago y la deuda con get_dunning_state (F-72).',
          );
        }
      },
    },

    // ─── F-77: pay_subscription_due (write) ──────────────────────────────
    {
      name: 'pay_subscription_due',
      version: '1',
      domain: 'subscriptions',
      description:
        'Prepara el pago de la deuda SaaS: factura indicada o la más antigua con saldo, devolviendo la config del widget Wompi para pagar en el navegador (facturas en cero se resuelven solas). Cadena: exige get_dunning_state (F-72) con deuda; si hay cambio de plan pendiente, el preview incluye F-75 (preview_subscription_checkout). Réplica el control del checkout: solo owner o super_admin.',
      parameters: {
        type: 'object',
        properties: {
          invoice_id: {
            type: 'number',
            description:
              'ID de la factura a pagar (opcional; por defecto la más antigua con saldo).',
          },
          return_url: {
            type: 'string',
            description: 'URL de retorno post-pago (opcional).',
          },
          customer_email: {
            type: 'string',
            description: 'Email para prellenar el widget (opcional).',
          },
        },
        required: [],
      },
      requiredPermissions: [SUBSCRIPTIONS_WRITE],
      requiresConfirmation: true,
      preview: async (
        args,
        context: ToolExecutionContext,
      ): Promise<ToolPreview> => {
        if (!hasOwnerRole(context)) {
          return ownerRolePreviewError('Pagar deuda de suscripción');
        }
        const store = requireStoreId(context);
        if (!store.ok) {
          return {
            status: 'error',
            target: 'Pagar deuda de suscripción',
            changes: [],
            message: JSON.parse(store.response).error,
          };
        }
        const validated = toValidatedDto(PayDueDto, {
          ...(args.invoice_id !== undefined && { invoiceId: args.invoice_id }),
          ...(args.return_url !== undefined && {
            returnUrl: args.return_url,
          }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Pagar deuda de suscripción',
            changes: [],
            message: `${validated.message} Revisa invoice_id y return_url.`,
          };
        }
        const gate = await resolvePayableInvoice(
          store.storeId,
          'oldest',
          validated.dto.invoiceId,
        );
        if (!gate.ok) {
          return {
            status: 'error',
            target: 'Pagar deuda de suscripción',
            changes: [],
            message: `${gate.message} ${gate.next_step}`,
          };
        }
        let prorationNote = '';
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          const pendingPlanId = (snapshot.subscription as any)
            ?.pending_plan_id;
          if (snapshot.found && pendingPlanId) {
            const proration =
              await subscriptionProrationService.previewUpgrade(
                (snapshot.subscription as any).id,
                pendingPlanId,
              );
            prorationNote = ` Hay un cambio de plan pendiente (F-75): prorrata ${proration.proration_amount} (${proration.kind}).`;
          }
        } catch {
          prorationNote = '';
        }
        return {
          status: 'ok',
          target: `Pagar ${gate.invoice.invoice_number ?? `factura #${gate.invoice.id}`} · saldo ${gate.invoice.amount_due}`,
          changes: [
            {
              field: 'pago',
              label: 'Pago',
              from: 'deuda pendiente',
              to: `widget Wompi para la factura #${gate.invoice.id}`,
            },
          ],
          message: `Cadena verificada: F-72 (get_dunning_state) con deuda.${prorationNote} El pago se completa en el navegador con el widget devuelto.`,
          domain: 'subscriptions',
        };
      },
      handler: async (args, context: ToolExecutionContext) => {
        if (!hasOwnerRole(context)) return ownerRoleHandlerError();
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const validated = toValidatedDto(PayDueDto, {
          ...(args.invoice_id !== undefined && { invoiceId: args.invoice_id }),
          ...(args.return_url !== undefined && {
            returnUrl: args.return_url,
          }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa invoice_id y return_url.',
          );
        }
        const gate = await resolvePayableInvoice(
          store.storeId,
          'oldest',
          validated.dto.invoiceId,
        );
        if (!gate.ok) {
          return writeToolError(gate.message, gate.next_step);
        }
        try {
          const { widget } =
            await subscriptionPaymentService.prepareWidgetCharge(
              gate.invoice.id,
              {
                customerEmail: args.customer_email,
                redirectUrl: validated.dto.returnUrl,
              },
            );
          return JSON.stringify({
            widget,
            invoice: {
              id: gate.invoice.id,
              invoice_number: gate.invoice.invoice_number,
              amount_due: gate.invoice.amount_due,
            },
            next_step:
              'Completa el pago en el navegador con el widget devuelto.',
          });
        } catch (error) {
          return writeToolError(
            `No pude preparar el pago de la factura #${gate.invoice.id}: ${describeReadError(error)}`,
            'Revisa la deuda con get_dunning_state (F-72).',
          );
        }
      },
    },

    // ─── F-78: subscribe_plan (write, confirmación fuerte) ───────────────
    {
      name: 'subscribe_plan',
      version: '1',
      domain: 'subscriptions',
      description:
        'Crea la suscripción SaaS de una tienda SIN suscripción previa: valida el plan vendible, resuelve el precio efectivo (margen del partner clampado al cap) y activa en el período. Confirmación fuerte: cambia lo que el comercio paga por Vendix. Cadena: exige get_subscription_status (F-71) sin suscripción.',
      parameters: {
        type: 'object',
        properties: {
          plan_id: {
            type: 'number',
            description: 'ID del plan a suscribir.',
          },
          partner_override_id: {
            type: 'number',
            description: 'ID del override de partner (opcional).',
          },
        },
        required: ['plan_id'],
      },
      requiredPermissions: [SUBSCRIPTIONS_WRITE],
      requiresConfirmation: true,
      preview: async (
        args,
        context: ToolExecutionContext,
      ): Promise<ToolPreview> => {
        if (!hasOwnerRole(context)) {
          return ownerRolePreviewError('Suscribir plan');
        }
        const store = requireStoreId(context);
        if (!store.ok) {
          return {
            status: 'error',
            target: 'Suscribir plan',
            changes: [],
            message: JSON.parse(store.response).error,
          };
        }
        const validated = toValidatedDto(SubscribeDto, {
          planId: args.plan_id,
          ...(args.partner_override_id !== undefined && {
            partnerOverrideId: args.partner_override_id,
          }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Suscribir plan',
            changes: [],
            message: `${validated.message} Revisa plan_id y partner_override_id.`,
          };
        }
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          if (snapshot.found && snapshot.subscription) {
            return {
              status: 'error',
              target: 'Suscribir plan',
              changes: [],
              message:
                'La tienda ya tiene una suscripción: subscribe_plan es solo para tiendas sin plan. Para cambiar de plan usa el checkout (preview con F-75). Verifica con get_subscription_status (F-71).',
            };
          }
          const pricing =
            await subscriptionBillingService.previewNewSubscription(
              validated.dto.planId,
              validated.dto.partnerOverrideId,
            );
          return {
            status: 'warning',
            target: `Suscribir plan ${pricing.plan.name} (${pricing.plan.code}) · ${pricing.effective_price} ${pricing.plan.currency}/${pricing.plan.billing_cycle}`,
            changes: [
              {
                field: 'suscripcion',
                label: 'Suscripción',
                from: 'sin plan',
                to: `active · ${pricing.plan.name}`,
              },
              {
                field: 'precio_efectivo',
                label: 'Precio efectivo',
                from: null,
                to: `${pricing.effective_price} ${pricing.plan.currency} (base ${pricing.base_price} + margen ${pricing.margin_amount} + recargo ${pricing.fixed_surcharge})`,
              },
            ],
            message: `${SUBSCRIPTIONS_IRREVERSIBLE_PHRASE} Cadena verificada: F-71 (get_subscription_status) sin suscripción; plan vendible con precio efectivo resuelto.`,
            domain: 'subscriptions',
          };
        } catch (error) {
          return {
            status: 'error',
            target: 'Suscribir plan',
            changes: [],
            message: `${describeReadError(error)} Verifica el plan y el estado con get_subscription_status (F-71).`,
          };
        }
      },
      handler: async (args, context: ToolExecutionContext) => {
        if (!hasOwnerRole(context)) return ownerRoleHandlerError();
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const validated = toValidatedDto(SubscribeDto, {
          planId: args.plan_id,
          ...(args.partner_override_id !== undefined && {
            partnerOverrideId: args.partner_override_id,
          }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa plan_id y partner_override_id.',
          );
        }
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          if (snapshot.found && snapshot.subscription) {
            return writeToolError(
              'La tienda ya tiene una suscripción: subscribe_plan es solo para tiendas sin plan.',
              'Para cambiar de plan usa el checkout (preview con F-75).',
            );
          }
          const created =
            await subscriptionBillingService.createStoreSubscription(
              store.storeId,
              {
                planId: validated.dto.planId,
                partnerOverrideId: validated.dto.partnerOverrideId,
              },
              context.user_id,
            );
          let cacheWarning: string | null = null;
          try {
            await subscriptionAccessService.invalidateCache(store.storeId);
          } catch {
            cacheWarning =
              'La suscripción se creó pero el caché de features tardará ~60s en refrescarse.';
          }
          return JSON.stringify({
            id: (created as any).id,
            state: (created as any).state,
            plan_code: (created as any).plan?.code ?? null,
            effective_price: (created as any).effective_price ?? null,
            currency: (created as any).currency ?? null,
            current_period_start:
              (created as any).current_period_start ?? null,
            current_period_end: (created as any).current_period_end ?? null,
            ...(cacheWarning && { cache_warning: cacheWarning }),
          });
        } catch (error) {
          return writeToolError(
            `No pude crear la suscripción: ${describeReadError(error)}`,
            'Verifica el plan y que la tienda siga sin suscripción (F-71).',
          );
        }
      },
    },

    // ─── F-79: cancel_subscription (write, confirmación fuerte) ──────────
    {
      name: 'cancel_subscription',
      version: '1',
      domain: 'subscriptions',
      description:
        'Cancela la suscripción SaaS de la tienda: inmediata (estado cancelled) o programada a fin de ciclo (scheduled_cancel_at, revierte el auto-renew). Confirmación fuerte: corta o programa el fin del servicio pago. Cadena: exige get_subscription_status (F-71) con suscripción. Solo owner o super_admin.',
      parameters: {
        type: 'object',
        properties: {
          end_of_cycle: {
            type: 'boolean',
            description:
              'true = programa la cancelación a fin de ciclo; false/omitido = cancela de inmediato.',
          },
          reason: {
            type: 'string',
            description: 'Motivo (opcional, queda en la auditoría).',
          },
        },
        required: [],
      },
      requiredPermissions: [SUBSCRIPTIONS_WRITE],
      requiresConfirmation: true,
      preview: async (
        args,
        context: ToolExecutionContext,
      ): Promise<ToolPreview> => {
        if (!hasOwnerRole(context)) {
          return ownerRolePreviewError('Cancelar suscripción');
        }
        const store = requireStoreId(context);
        if (!store.ok) {
          return {
            status: 'error',
            target: 'Cancelar suscripción',
            changes: [],
            message: JSON.parse(store.response).error,
          };
        }
        const validated = toValidatedDto(CancelDto, {
          ...(args.end_of_cycle !== undefined && {
            end_of_cycle: args.end_of_cycle,
          }),
          ...(args.reason !== undefined && { reason: args.reason }),
        });
        if (!validated.ok) {
          return {
            status: 'error',
            target: 'Cancelar suscripción',
            changes: [],
            message: `${validated.message} Revisa end_of_cycle y reason.`,
          };
        }
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          if (!snapshot.found || !snapshot.subscription) {
            return {
              status: 'error',
              target: 'Cancelar suscripción',
              changes: [],
              message:
                'La tienda no tiene suscripción que cancelar. Verifica con get_subscription_status (F-71).',
            };
          }
          const sub = snapshot.subscription as any;
          const scheduled = validated.dto.end_of_cycle === true;
          if (scheduled && !sub.current_period_end) {
            return {
              status: 'error',
              target: 'Cancelar suscripción',
              changes: [],
              message:
                'No hay período de facturación activo para programar la cancelación. Verifica con get_subscription_status (F-71).',
            };
          }
          return {
            status: 'warning',
            target: scheduled
              ? `Programar fin de la suscripción ${sub.plan?.code ?? ''} al cierre del ciclo`
              : `Cancelar de inmediato la suscripción ${sub.plan?.code ?? ''}`,
            changes: scheduled
              ? [
                  {
                    field: 'cancelacion_programada',
                    label: 'Cancelación programada',
                    from: null,
                    to: sub.current_period_end,
                  },
                  {
                    field: 'auto_renew',
                    label: 'Auto-renovación',
                    from: true,
                    to: false,
                  },
                ]
              : [
                  {
                    field: 'estado',
                    label: 'Estado',
                    from: sub.state,
                    to: 'cancelled',
                  },
                ],
            message: `${SUBSCRIPTIONS_IRREVERSIBLE_PHRASE} Cadena verificada: F-71 (get_subscription_status) con suscripción ${sub.state}. ${scheduled ? 'El servicio pago sigue hasta fin de ciclo y luego se corta.' : 'La cancelación inmediata corta el servicio pago ahora.'}`,
            domain: 'subscriptions',
          };
        } catch (error) {
          return {
            status: 'error',
            target: 'Cancelar suscripción',
            changes: [],
            message: `${describeReadError(error)} Verifica con get_subscription_status (F-71).`,
          };
        }
      },
      handler: async (args, context: ToolExecutionContext) => {
        if (!hasOwnerRole(context)) return ownerRoleHandlerError();
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        const validated = toValidatedDto(CancelDto, {
          ...(args.end_of_cycle !== undefined && {
            end_of_cycle: args.end_of_cycle,
          }),
          ...(args.reason !== undefined && { reason: args.reason }),
        });
        if (!validated.ok) {
          return writeToolError(
            validated.message,
            'Revisa end_of_cycle y reason.',
          );
        }
        try {
          const snapshot =
            await subscriptionAccessService.getCurrentSubscriptionSnapshot(
              store.storeId,
            );
          if (!snapshot.found || !snapshot.subscription) {
            return writeToolError(
              'La tienda no tiene suscripción que cancelar.',
              'Verifica con get_subscription_status (F-71).',
            );
          }
          const sub = snapshot.subscription as any;
          const scheduled = validated.dto.end_of_cycle === true;
          if (scheduled) {
            if (!sub.current_period_end) {
              return writeToolError(
                'No hay período de facturación activo para programar la cancelación.',
                'Verifica con get_subscription_status (F-71).',
              );
            }
            const updated = await subscriptionStateService.scheduleCancel(
              store.storeId,
              new Date(sub.current_period_end),
              {
                reason:
                  validated.dto.reason ?? 'user_initiated_schedule_cancel',
                triggeredByUserId: context.user_id,
              },
            );
            return JSON.stringify({
              state: (updated as any).state,
              scheduled_cancel_at:
                (updated as any).scheduled_cancel_at ?? null,
              auto_renew: (updated as any).auto_renew ?? null,
            });
          }
          const updated = await subscriptionStateService.transition(
            store.storeId,
            'cancelled',
            {
              reason: validated.dto.reason ?? 'user_initiated_cancel',
              triggeredByUserId: context.user_id,
            },
          );
          return JSON.stringify({
            state: (updated as any).state,
          });
        } catch (error) {
          return writeToolError(
            `No pude cancelar la suscripción: ${describeReadError(error)}`,
            'Verifica el estado con get_subscription_status (F-71).',
          );
        }
      },
    },

    // ─── F-80: get_subscription_access ───────────────────────────────────
    {
      name: 'get_subscription_access',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Acceso efectivo de la suscripción (misma lectura que GET current/access): estado, plan, features resueltas, fin del período actual, overlay promocional y nivel del banner. Solo lectura, sin gate de suscripción. Sin requiredPermissions: espejo del HTTP, que solo exige auth.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async (_args, context: ToolExecutionContext) => {
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        try {
          const resolved =
            await subscriptionResolverService.resolveSubscription(
              store.storeId,
            );
          if (!resolved.found) {
            return JSON.stringify({
              found: false,
              state: 'draft',
              planCode: '',
              features: {},
              currentPeriodEnd: null,
              overlayActive: false,
              overlayExpiresAt: null,
              bannerLevel: 'info',
            });
          }
          return JSON.stringify({
            found: true,
            state: resolved.state,
            planCode: resolved.planCode,
            features: resolved.features,
            currentPeriodEnd: resolved.currentPeriodEnd
              ? resolved.currentPeriodEnd.toISOString()
              : null,
            overlayActive: resolved.overlayActive,
            overlayExpiresAt: resolved.overlayExpiresAt
              ? resolved.overlayExpiresAt.toISOString()
              : null,
            bannerLevel: bannerLevel(resolved.state),
          });
        } catch (error) {
          return readToolError(
            `No pude leer el acceso de la suscripción: ${describeReadError(error)}`,
            'Reintenta en unos segundos; si persiste, revisa el módulo de suscripción.',
          );
        }
      },
    },

    // ─── F-81: get_ai_usage ──────────────────────────────────────────────
    {
      name: 'get_ai_usage',
      version: '1',
      domain: 'subscriptions',
      readOnly: true,
      description:
        'Uso de IA de la tienda por feature (usado vs cap del plan + período diario/mensual), leído de los contadores Redis sin incrementarlos. Solo lectura, observabilidad (no autoriza). Sin requiredPermissions: espejo del HTTP, que solo exige auth.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async (_args, context: ToolExecutionContext) => {
        const store = requireStoreId(context);
        if (!store.ok) return store.response;
        try {
          const snapshot =
            await subscriptionAccessService.getAIUsageSnapshot(store.storeId);
          return JSON.stringify(snapshot);
        } catch (error) {
          return readToolError(
            `No pude leer el uso de IA: ${describeReadError(error)}`,
            'Reintenta en unos segundos; si persiste, revisa el módulo de suscripción.',
          );
        }
      },
    },
  ];
}
