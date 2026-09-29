import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  RegisteredTool,
  ToolExecutionContext,
} from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { SubscriptionAccessService } from '../../../domains/store/subscriptions/services/subscription-access.service';
import { SubscriptionBillingService } from '../../../domains/store/subscriptions/services/subscription-billing.service';
import { SubscriptionQueryDto } from '../../../domains/store/subscriptions/dto/subscription-query.dto';

export interface SubscriptionToolDeps {
  subscriptionAccessService: SubscriptionAccessService;
  subscriptionBillingService: SubscriptionBillingService;
}

// ─────────────────────────────────────────────────────────────────────────────
// Doctrina de lectura F-71.. (misma que `withholding.tools.ts`: los handlers NO
// lanzan, devuelven `{error, next_step}` en español; cero `prisma.` aquí — toda
// lectura va al service dueño).
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
const INVOICE_ROLES = ['owner', 'super_admin'];

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

export function createSubscriptionTools(
  deps: SubscriptionToolDeps,
): RegisteredTool[] {
  const { subscriptionAccessService, subscriptionBillingService } = deps;

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
        if (!roles.some((role) => INVOICE_ROLES.includes(role))) {
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
  ];
}
