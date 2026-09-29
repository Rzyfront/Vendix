import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { notification_type_enum } from '@prisma/client';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { NotificationsService } from '../../../domains/store/notifications/notifications.service';
import { NotificationsPushService } from '../../../domains/store/notifications/notifications-push.service';
import { UpdateSubscriptionDto } from '../../../domains/store/notifications/dto/update-subscription.dto';
import {
  PushSubscriptionDto,
  PushUnsubscribeDto,
} from '../../../domains/store/notifications/dto/push-subscription.dto';

export interface NotificationToolDeps {
  notificationsService: NotificationsService;
  pushService: NotificationsPushService;
}

const NOTIFICATION_TYPES = Object.values(notification_type_enum);
const MANAGE_ACTIONS = [
  'mark-read',
  'mark-all-read',
  'update-subscription',
  'push-subscribe',
  'push-unsubscribe',
];

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({
    error,
    ...(nextStep ? { next_step: nextStep } : {}),
  });
}

function previewError(target: string, message: string): ToolPreview {
  return {
    status: 'error',
    target,
    changes: [],
    message,
    domain: 'notifications',
  };
}

function noContext(what: string): string | null {
  return guidedError(
    `Sin usuario y tienda en contexto: ${what} siempre vive dentro de una tienda y un usuario.`,
  );
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
  if (error instanceof Error) return { message: error.message };
  return { message: 'Error desconocido' };
}

function toPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
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

function compactNotification(row: any) {
  return {
    notification_id: row.id,
    type: row.type,
    severity: row.severity ?? null,
    title: row.title,
    body: row.body ?? null,
    is_read: row.is_read ?? false,
    created_at: row.created_at ?? null,
  };
}

/**
 * D-12/D-13 — Notificaciones (paso 13, P1/P2).
 *
 * - D-12 `list_notifications` es read-only: lista + conteo de no leídas. El
 *   stream SSE NO es una tool: esta lectura es la foto para conversar.
 * - D-13 `manage_notifications` cubre marcar leída(s), preferencias por tipo
 *   y suscripciones push del navegador. Los tipos se validan en el borde
 *   contra `notification_type_enum` (el enum importado desde el cliente
 *   Prisma, sin acceso a datos): una emisión fuera del enum falla y se traga
 *   en el servicio, así que la tool la rechaza antes con remedio.
 *
 * Marcar leída(s) delega en los mismos métodos del servicio que los
 * endpoints con `@SkipSubscriptionGate`: leer la campana nunca exige plan.
 */
export function createNotificationTools(
  deps: NotificationToolDeps,
): RegisteredTool[] {
  const { notificationsService, pushService } = deps;

  return [
    // ─── D-12: list_notifications (READ) ───────────────────────────
    {
      name: 'list_notifications',
      version: '1',
      domain: 'notifications',
      readOnly: true,
      description:
        'Lee las notificaciones de la tienda para el usuario actual: lista paginada con filtros por tipo o solo-no-leídas, más el conteo de no leídas para la campana. Es la lectura habilitante antes de manage_notifications. El stream en vivo (SSE) no es una tool: esta lectura es la foto.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: NOTIFICATION_TYPES,
            description: 'Filtra por tipo de notificación.',
          },
          unread_only: {
            type: 'boolean',
            description: 'Solo no leídas (por defecto false).',
          },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 20, máximo 50).',
          },
          include_unread_count: {
            type: 'boolean',
            description:
              'Incluye el conteo de no leídas (por defecto true).',
          },
        },
      },
      requiredPermissions: ['store:notifications:read'],
      handler: async (args, context) => {
        if (!context.store_id || !context.user_id) {
          return noContext('la lectura de notificaciones') as string;
        }
        if (
          args.type !== undefined &&
          !NOTIFICATION_TYPES.includes(args.type)
        ) {
          return guidedError(
            `type "${args.type}" inválido. Valores válidos: ${NOTIFICATION_TYPES.join(', ')}.`,
          );
        }

        try {
          const page = Math.max(Number(args.page) || 1, 1);
          const limit = Math.min(
            Math.max(Number(args.limit) || 20, 1),
            50,
          );
          const [result, unread] = await Promise.all([
            notificationsService.findAll(Number(context.user_id), {
              page,
              limit,
              ...(args.type ? { type: String(args.type) } : {}),
              ...(args.unread_only === true ? { is_read: false } : {}),
            }),
            args.include_unread_count !== false
              ? notificationsService.getUnreadCount(Number(context.user_id))
              : Promise.resolve(null),
          ]);
          const rows = ((result as any)?.data ?? []).map(
            compactNotification,
          );
          return JSON.stringify({
            resumen: `${rows.length} notificación(es) de ${(result as any)?.meta?.total ?? rows.length} en total`,
            pagina: (result as any)?.meta?.page ?? page,
            paginas: (result as any)?.meta?.totalPages ?? 1,
            notificaciones: rows,
            ...(unread !== null
              ? { no_leidas: (unread as any)?.count ?? 0 }
              : {}),
            next_step: rows.length
              ? 'Para marcar leída(s) usa manage_notifications(mark-read/mark-all-read) con el ID que ves aquí.'
              : 'Sin notificaciones con ese filtro.',
          });
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude leer las notificaciones: ${info.message}`,
            'Verifica el filtro de tipo contra notification_type_enum.',
          );
        }
      },
    },

    // ─── D-13: manage_notifications (WRITE, exige D-12) ────────────
    {
      name: 'manage_notifications',
      version: '1',
      domain: 'notifications',
      description:
        'Opera la campana: mark-read (marca UNA como leída), mark-all-read (marca todas), update-subscription (enciende/apaga campana y correo por tipo) y push-subscribe/push-unsubscribe (alta/baja del navegador para push web). Lee PRIMERO con list_notifications. El tipo se valida contra notification_type_enum en el borde: fuera del enum no procede.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: MANAGE_ACTIONS,
            description:
              'mark-read, mark-all-read, update-subscription, push-subscribe o push-unsubscribe.',
          },
          notification_id: {
            type: 'number',
            description:
              'ID de la notificación (requerido en mark-read; resuélvelo con list_notifications).',
          },
          type: {
            type: 'string',
            enum: NOTIFICATION_TYPES,
            description:
              'Tipo de notification_type_enum (requerido en update-subscription).',
          },
          in_app: {
            type: 'boolean',
            description: 'Campana dentro de la app (update-subscription).',
          },
          email: {
            type: 'boolean',
            description: 'Correo (update-subscription).',
          },
          endpoint: {
            type: 'string',
            description:
              'Endpoint push del navegador (requerido en push-subscribe/push-unsubscribe).',
          },
          p256dh: {
            type: 'string',
            description: 'Clave p256dh (requerida en push-subscribe).',
          },
          auth: {
            type: 'string',
            description: 'Clave auth (requerida en push-subscribe).',
          },
          user_agent: {
            type: 'string',
            description: 'Navegador/dispositivo (opcional, push-subscribe).',
          },
        },
        required: ['action'],
      },
      requiredPermissions: ['store:notifications:update'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id || !context.user_id) {
          return previewError(
            'Notificaciones',
            'Sin usuario y tienda en contexto: la campana siempre vive dentro de una tienda y un usuario.',
          );
        }
        const action = String(args.action ?? '');
        if (!MANAGE_ACTIONS.includes(action)) {
          return previewError(
            'Notificaciones',
            `action "${action}" inválida. Usa ${MANAGE_ACTIONS.join(', ')}.`,
          );
        }

        try {
          if (action === 'mark-all-read') {
            const unread = await notificationsService.getUnreadCount(
              Number(context.user_id),
            );
            return {
              status: 'warning',
              target: `Marcar todas como leídas (${(unread as any)?.count ?? '?'} no leídas)`,
              changes: [
                {
                  field: 'is_read',
                  label: 'Campana',
                  from: `${(unread as any)?.count ?? '?'} no leídas`,
                  to: 'todas leídas',
                },
              ],
              domain: 'notifications',
            };
          }
          if (action === 'mark-read') {
            const notificationId = toPositiveInt(args.notification_id);
            if (!notificationId) {
              return previewError(
                'Notificaciones',
                'mark-read exige notification_id. Lee con list_notifications primero.',
              );
            }
            const recent = await notificationsService.findAll(
              Number(context.user_id),
              { page: 1, limit: 100, is_read: false } as any,
            );
            const found = ((recent as any)?.data ?? []).find(
              (row: any) => Number(row.id) === notificationId,
            );
            return {
              status: 'ok',
              target: found
                ? `Marcar leída — "${found.title ?? `#${notificationId}`}"`
                : `Marcar leída — notificación #${notificationId}`,
              changes: [
                {
                  field: 'is_read',
                  label: found?.title ?? `#${notificationId}`,
                  from: 'no leída',
                  to: 'leída',
                },
              ],
              ...(!found
                ? {
                    message:
                      'No la veo entre las 100 no leídas recientes: puede que ya esté leída; al confirmar se verifica.',
                  }
                : {}),
              domain: 'notifications',
            };
          }
          if (action === 'update-subscription') {
            const type = String(args.type ?? '');
            if (!NOTIFICATION_TYPES.includes(type as any)) {
              return previewError(
                'Notificaciones',
                `type "${type || '(vacío)'}" inválido: debe ser un valor de notification_type_enum (${NOTIFICATION_TYPES.join(', ')}).`,
              );
            }
            if (
              args.in_app === undefined &&
              args.email === undefined
            ) {
              return previewError(
                'Notificaciones',
                'update-subscription exige in_app o email.',
              );
            }
            const current = await notificationsService.getSubscriptions(
              Number(context.user_id),
            );
            const existing = ((current as any[]) ?? []).find(
              (row: any) => String(row.type) === type,
            );
            return {
              status: 'ok',
              target: `Preferencias — tipo "${type}"`,
              changes: [
                ...(args.in_app !== undefined
                  ? [
                      {
                        field: 'in_app',
                        label: 'Campana',
                        from: existing?.in_app ?? true,
                        to: Boolean(args.in_app),
                      },
                    ]
                  : []),
                ...(args.email !== undefined
                  ? [
                      {
                        field: 'email',
                        label: 'Correo',
                        from: existing?.email ?? false,
                        to: Boolean(args.email),
                      },
                    ]
                  : []),
              ],
              domain: 'notifications',
            };
          }

          const endpoint = String(args.endpoint ?? '').trim();
          if (!endpoint) {
            return previewError(
              'Notificaciones',
              `${action} exige endpoint push del navegador.`,
            );
          }
          if (action === 'push-subscribe') {
            if (!args.p256dh || !args.auth) {
              return previewError(
                'Notificaciones',
                'push-subscribe exige endpoint, p256dh y auth.',
              );
            }
            return {
              status: 'ok',
              target: 'Alta push — este navegador recibirá notificaciones web',
              changes: [
                {
                  field: 'push',
                  label: 'Push web',
                  from: 'inactivo',
                  to: 'activo',
                },
              ],
              domain: 'notifications',
            };
          }
          return {
            status: 'warning',
            target: 'Baja push — este navegador dejará de recibir push web',
            changes: [
              {
                field: 'push',
                label: 'Push web',
                from: 'activo',
                to: 'inactivo',
              },
            ],
            domain: 'notifications',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Notificaciones', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id || !context.user_id) {
          return noContext('la gestión de notificaciones') as string;
        }
        const action = String(args.action ?? '');
        const userId = Number(context.user_id);
        const storeId = Number(context.store_id);

        try {
          if (action === 'mark-all-read') {
            const result = await notificationsService.markAllRead();
            return JSON.stringify({
              resumen: `Campana al día: ${(result as any)?.count ?? 0} marcada(s) como leídas.`,
            });
          }
          if (action === 'mark-read') {
            const notificationId = toPositiveInt(args.notification_id);
            if (!notificationId) {
              return guidedError(
                'mark-read exige notification_id.',
                'Lee con list_notifications y pasa el ID que ves ahí.',
              );
            }
            // Re-verificación implícita al aplicar: el servicio lanza
            // NotFound si no existe o no es de esta tienda/usuario.
            await notificationsService.markRead(notificationId);
            return JSON.stringify({
              resumen: `Notificación #${notificationId} marcada como leída.`,
              notification_id: notificationId,
            });
          }
          if (action === 'update-subscription') {
            const type = String(args.type ?? '');
            if (!NOTIFICATION_TYPES.includes(type as any)) {
              return guidedError(
                `type "${type || '(vacío)'}" inválido: debe ser un valor de notification_type_enum.`,
                `Valores válidos: ${NOTIFICATION_TYPES.join(', ')}.`,
              );
            }
            const checked = toValidatedDto(UpdateSubscriptionDto, {
              type,
              ...(args.in_app !== undefined
                ? { in_app: Boolean(args.in_app) }
                : {}),
              ...(args.email !== undefined
                ? { email: Boolean(args.email) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await notificationsService.updateSubscription(userId, checked.dto);
            return JSON.stringify({
              resumen: `Preferencias de "${type}" actualizadas${args.in_app !== undefined ? ` (campana ${args.in_app ? 'encendida' : 'apagada'})` : ''}${args.email !== undefined ? ` (correo ${args.email ? 'encendido' : 'apagado'})` : ''}.`,
            });
          }
          if (action === 'push-subscribe') {
            const checked = toValidatedDto(PushSubscriptionDto, {
              subscription: {
                ...(args.endpoint
                  ? { endpoint: String(args.endpoint) }
                  : {}),
                keys: {
                  ...(args.p256dh ? { p256dh: String(args.p256dh) } : {}),
                  ...(args.auth ? { auth: String(args.auth) } : {}),
                },
              },
              ...(args.user_agent
                ? { user_agent: String(args.user_agent) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await pushService.saveSubscription(
              storeId,
              userId,
              (checked.dto as any).subscription,
              (checked.dto as any).user_agent,
            );
            return JSON.stringify({
              resumen: 'Navegador suscrito a push web.',
            });
          }
          if (action === 'push-unsubscribe') {
            const checked = toValidatedDto(PushUnsubscribeDto, {
              ...(args.endpoint
                ? { endpoint: String(args.endpoint) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await pushService.removeSubscription(
              storeId,
              userId,
              checked.dto.endpoint,
            );
            return JSON.stringify({
              resumen: 'Navegador dado de baja de push web.',
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa ${MANAGE_ACTIONS.join(', ')}.`,
          );
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude gestionar notificaciones: ${info.message}`,
            'Lee con list_notifications para ver el estado actual y reintenta.',
          );
        }
      },
    },
  ];
}
