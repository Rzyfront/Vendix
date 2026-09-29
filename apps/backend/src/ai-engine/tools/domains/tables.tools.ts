import { randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { TablesService } from '../../../domains/store/tables/tables.service';
import { TableSessionsService } from '../../../domains/store/tables/table-sessions.service';
import { SplitOrderService } from '../../../domains/store/tables/split-order.service';
import {
  OpenTableSessionDto,
  AddItemsToTableSessionDto,
} from '../../../domains/store/tables/dto/table-session.dto';
import {
  SplitPreviewDto,
  SplitByItemsDto,
  SplitByAmountDto,
} from '../../../domains/store/tables/dto/split-order.dto';

export interface TablesToolDeps {
  tablesService: TablesService;
  tableSessionsService: TableSessionsService;
  splitOrderService: SplitOrderService;
}

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({
    error,
    ...(nextStep ? { next_step: nextStep } : {}),
  });
}

function previewError(target: string, message: string): ToolPreview {
  return { status: 'error', target, changes: [], message, domain: 'tables' };
}

function noStore(what: string): string {
  return guidedError(
    `Sin tienda en contexto: ${what} siempre vive dentro de una tienda.`,
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

function sessionLabel(session: any): string {
  const table = session?.table?.name ?? `mesa #${session?.table_id ?? '?'}`;
  return `${table} (sesión #${session?.id ?? '?'})`;
}

/**
 * K-8/K-9 — Mesas y cuenta (paso 8, P0).
 *
 * - K-8 `manage_table_session` opera la cuenta abierta: open crea la sesión
 *   (y su orden en borrador), add-items agrega platos al borrador (el POS
 *   decide cuándo disparar a cocina, nunca es automático) y close cierra la
 *   sesión SIN cobrar (el cobro sigue su flujo normal de pago). El cliente
 *   es opcional y nullable: no existe sentinel "Cliente General".
 * - K-9 `split_bill` es puramente financiero: divide la cuenta en partes
 *   pagables sin crear movimientos de inventario (propaga
 *   `inventory_consumed_at_fire`, que ya se consumió al disparar) y sin
 *   tocar la cocina. El preview del servicio ata `source_version`: el
 *   handler lo re-calcula al aplicar, así que una cuenta que se movió tras
 *   la confirmación se rechaza en vez de dividirse sobre un supuesto viejo.
 */
export function createTablesTools(deps: TablesToolDeps): RegisteredTool[] {
  const { tablesService, tableSessionsService, splitOrderService } = deps;

  return [
    // ─── K-8: manage_table_session (WRITE) ─────────────────────────
    {
      name: 'manage_table_session',
      version: '1',
      domain: 'tables',
      description:
        'Opera la cuenta abierta de una mesa: open abre sesión (crea el borrador de la orden), add-items agrega platos al borrador sin disparar a cocina, close cierra la sesión sin cobrar. El cliente es opcional (cuenta anónima válida). Cerrar no cobra ni dispara: solo marca la cuenta como cerrada para que el pago siga su flujo normal.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['open', 'add-items', 'close'],
            description:
              'open: abrir sesión en una mesa libre. add-items: agregar platos al borrador. close: cerrar la sesión sin cobrar.',
          },
          session_id: {
            type: 'number',
            description:
              'ID de la sesión (requerido en add-items y close).',
          },
          table_id: {
            type: 'number',
            description: 'ID de la mesa (requerido en open).',
          },
          guest_count: {
            type: 'number',
            description: 'Comensales (opcional, solo open).',
          },
          customer_id: {
            type: 'number',
            description:
              'Cliente a atar al borrador (opcional, solo open; omitir para cuenta anónima).',
          },
          items: {
            type: 'array',
            description:
              'Platos a agregar (requerido en add-items): product_id, quantity y opcionales product_variant_id, price_tier_id, is_takeaway, notes.',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'number' },
                product_variant_id: { type: 'number' },
                quantity: { type: 'number' },
                price_tier_id: { type: 'number' },
                is_takeaway: { type: 'boolean' },
                notes: { type: 'string' },
              },
              required: ['product_id', 'quantity'],
            },
          },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:table_sessions:create',
        'store:table_sessions:update',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Sesión de mesa',
            'Sin tienda en contexto: las mesas siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!['open', 'add-items', 'close'].includes(action)) {
          return previewError(
            'Sesión de mesa',
            `action "${action}" inválida. Usa open, add-items o close.`,
          );
        }

        try {
          if (action === 'open') {
            const tableId = toPositiveInt(args.table_id);
            if (!tableId) {
              return previewError(
                'Apertura de mesa',
                'open exige table_id.',
              );
            }
            const table = await tablesService.findOne(tableId);
            if ((table as any)?.active_session) {
              return previewError(
                `Mesa ${(table as any)?.name ?? `#${tableId}`}`,
                'Esa mesa ya tiene una sesión abierta. Ciérrala o elige otra mesa.',
              );
            }
            const guestCount = toPositiveInt(args.guest_count);
            return {
              status: 'ok',
              target: `Apertura de sesión — mesa ${(table as any)?.name ?? `#${tableId}`}`,
              changes: [
                ...(guestCount
                  ? [
                      {
                        field: 'guest_count',
                        label: 'Comensales',
                        from: null,
                        to: guestCount,
                      },
                    ]
                  : []),
                ...(args.customer_id
                  ? [
                      {
                        field: 'customer_id',
                        label: 'Cliente',
                        from: null,
                        to: `#${args.customer_id}`,
                      },
                    ]
                  : [
                      {
                        field: 'customer_id',
                        label: 'Cliente',
                        from: null,
                        to: 'cuenta anónima',
                      },
                    ]),
              ],
              message:
                'Abre la cuenta (crea el borrador de la orden). Agregar platos no dispara a cocina: eso se pide aparte.',
              domain: 'tables',
            };
          }

          const sessionId = toPositiveInt(args.session_id);
          if (!sessionId) {
            return previewError(
              'Sesión de mesa',
              `${action} exige session_id.`,
            );
          }
          const session = await tableSessionsService.findOne(sessionId);
          if ((session as any)?.closed_at) {
            return previewError(
              sessionLabel(session),
              'Esa sesión ya está cerrada: no acepta más movimientos.',
            );
          }

          if (action === 'add-items') {
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return previewError(
                sessionLabel(session),
                'add-items exige al menos 1 plato en items.',
              );
            }
            const detail = items
              .map(
                (line: any) =>
                  `#${line?.product_id ?? '?'} x${line?.quantity ?? '?'}${line?.notes ? ` ("${line.notes}")` : ''}`,
              )
              .join('; ');
            return {
              status: 'ok',
              target: `Agregar ${items.length} plato(s) — ${sessionLabel(session)}`,
              changes: [
                {
                  field: 'items',
                  label: 'Platos',
                  from: null,
                  to: detail,
                },
              ],
              message:
                'Los platos entran al borrador de la orden; no se disparan a cocina automáticamente.',
              domain: 'tables',
            };
          }

          return {
            status: 'warning',
            target: `Cierre de sesión — ${sessionLabel(session)}`,
            changes: [
              {
                field: 'closed_at',
                label: 'Sesión',
                from: 'abierta',
                to: 'cerrada',
              },
            ],
            message:
              'Cerrar NO cobra ni dispara a cocina: solo marca la cuenta como cerrada. El cobro sigue su flujo normal de pago.',
            domain: 'tables',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Sesión de mesa', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la sesión de mesa');
        const action = String(args.action ?? '');

        try {
          if (action === 'open') {
            const tableId = toPositiveInt(args.table_id);
            if (!tableId) {
              return guidedError('open exige table_id.');
            }
            // Re-verificación: la mesa pudo ocuparse tras el preview.
            const table = await tablesService.findOne(tableId);
            if ((table as any)?.active_session) {
              return guidedError(
                `La mesa ${(table as any)?.name ?? `#${tableId}`} ya tiene una sesión abierta: no abrí otra.`,
                'Elige otra mesa o cierra la sesión activa primero.',
              );
            }
            const checked = toValidatedDto(OpenTableSessionDto, {
              table_id: tableId,
              ...(toPositiveInt(args.guest_count)
                ? { guest_count: Number(args.guest_count) }
                : {}),
              ...(toPositiveInt(args.customer_id)
                ? { customer_id: Number(args.customer_id) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const session =
              await tableSessionsService.openSession(checked.dto);
            return JSON.stringify({
              resumen: `Sesión #${(session as any)?.id} abierta en la mesa ${(table as any)?.name ?? `#${tableId}`}`,
              session_id: (session as any)?.id,
              table_id: tableId,
              order_id: (session as any)?.order_id ?? null,
            });
          }

          if (action === 'add-items') {
            const sessionId = toPositiveInt(args.session_id);
            if (!sessionId) {
              return guidedError('add-items exige session_id.');
            }
            const items = Array.isArray(args.items) ? args.items : [];
            if (!items.length) {
              return guidedError('add-items exige al menos 1 plato en items.');
            }
            // Re-verificación: la sesión pudo cerrarse tras el preview.
            const current =
              await tableSessionsService.findOne(sessionId);
            if ((current as any)?.closed_at) {
              return guidedError(
                'La sesión se cerró después de la confirmación: no agregué nada.',
                'Abre una sesión nueva si la mesa sigue ocupada.',
              );
            }
            const checked = toValidatedDto(AddItemsToTableSessionDto, {
              items: items.map((line: any) => ({
                product_id: Number(line.product_id),
                ...(line.product_variant_id !== undefined
                  ? { product_variant_id: Number(line.product_variant_id) }
                  : {}),
                quantity: Number(line.quantity),
                ...(line.price_tier_id !== undefined
                  ? { price_tier_id: Number(line.price_tier_id) }
                  : {}),
                ...(line.is_takeaway !== undefined
                  ? { is_takeaway: Boolean(line.is_takeaway) }
                  : {}),
                ...(line.notes ? { notes: String(line.notes) } : {}),
              })),
            });
            if (!checked.ok) return guidedError(checked.message);
            const session = await tableSessionsService.addItems(
              sessionId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `Agregados ${items.length} plato(s) a ${sessionLabel(session)} (borrador, sin disparar a cocina)`,
              session_id: sessionId,
              order_id: (session as any)?.order_id ?? null,
              ...((session as any)?.stock_warnings
                ? { stock_warnings: (session as any).stock_warnings }
                : {}),
            });
          }

          if (action === 'close') {
            const sessionId = toPositiveInt(args.session_id);
            if (!sessionId) {
              return guidedError('close exige session_id.');
            }
            // Re-verificación: la sesión pudo cerrarse tras el preview.
            const current =
              await tableSessionsService.findOne(sessionId);
            if ((current as any)?.closed_at) {
              return guidedError(
                'La sesión ya estaba cerrada: no hice nada.',
                'Si falta cobrar, sigue el flujo normal de pago sobre la orden.',
              );
            }
            const session =
              await tableSessionsService.closeSession(sessionId);
            return JSON.stringify({
              resumen: `Sesión #${sessionId} cerrada (${sessionLabel(session)}). Pendiente de cobro por el flujo normal.`,
              session_id: sessionId,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa open, add-items o close.`,
          );
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'TABLE_SESSION_CLOSED') {
            return guidedError(
              'La sesión ya está cerrada: no acepta más movimientos.',
              'Abre una sesión nueva si la mesa sigue ocupada.',
            );
          }
          return guidedError(
            `No pude operar la sesión: ${info.message}`,
            'Revisa la mesa y la sesión e inténtalo de nuevo.',
          );
        }
      },
    },

    // ─── K-9: split_bill (WRITE, puramente financiero) ─────────────
    {
      name: 'split_bill',
      version: '1',
      domain: 'tables',
      description:
        'Divide la cuenta de una orden en partes pagables: items (por platos, con item_groups) o equal/custom (por monto, con n_splits y amounts opcionales). Es puramente financiero: no crea movimientos de inventario ni toca la cocina (el consumo ya ocurrió al disparar). Opcionalmente nombra cada cuenta con accounts (label, customer_id o customer_alias).',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description: 'ID de la orden cuya cuenta se divide.',
          },
          mode: {
            type: 'string',
            enum: ['items', 'equal', 'custom'],
            description:
              'items: por platos (exige item_groups). equal: partes iguales (exige n_splits). custom: montos libres (exige amounts).',
          },
          item_groups: {
            type: 'array',
            minItems: 2,
            maxItems: 20,
            description:
              'Grupos de renglones por cuenta (requerido en mode items): cada grupo lista sus order_item_ids.',
            items: {
              type: 'object',
              properties: {
                order_item_ids: {
                  type: 'array',
                  items: { type: 'number' },
                },
              },
              required: ['order_item_ids'],
            },
          },
          n_splits: {
            type: 'number',
            description:
              'Número de partes (requerido en equal, 2-20; en custom se deriva de amounts).',
          },
          amounts: {
            type: 'array',
            minItems: 2,
            maxItems: 20,
            items: { type: 'number' },
            description: 'Montos por cuenta (requerido en custom).',
          },
          accounts: {
            type: 'array',
            minItems: 2,
            maxItems: 20,
            description:
              'Nombre opcional de cada cuenta: label, customer_id o customer_alias.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                customer_id: { type: 'number' },
                customer_alias: { type: 'string' },
              },
            },
          },
        },
        required: ['order_id', 'mode'],
      },
      requiredPermissions: ['store:table_sessions:update'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'División de cuenta',
            'Sin tienda en contexto: las cuentas siempre viven dentro de una tienda.',
          );
        }
        const orderId = toPositiveInt(args.order_id);
        const mode = String(args.mode ?? '');
        if (!orderId) {
          return previewError('División de cuenta', 'order_id inválido.');
        }
        if (!['items', 'equal', 'custom'].includes(mode)) {
          return previewError(
            'División de cuenta',
            `mode "${mode}" inválido. Usa items, equal o custom.`,
          );
        }

        const plain = buildSplitPlain(args, mode);
        if (typeof plain === 'string') {
          return previewError('División de cuenta', plain);
        }
        const checked = toValidatedDto(SplitPreviewDto, plain);
        if (!checked.ok) {
          return previewError('División de cuenta', checked.message);
        }

        try {
          const result = await splitOrderService.preview(
            orderId,
            checked.dto,
          );
          const accounts = (result.accounts ?? []).filter(
            (account: any) => account.role === 'payable',
          );
          return {
            status: 'warning',
            target: `División de cuenta — orden #${orderId} en ${accounts.length} parte(s), total ${result.pending_to_split} ${result.currency}`,
            changes: accounts.map((account: any) => ({
              field: `cuenta:${account.ordinal}`,
              label: account.label || `Cuenta ${account.ordinal}`,
              from: null,
              to: `${account.grand_total} ${result.currency} (${account.payment_state})`,
            })),
            message:
              'Puramente financiero: no mueve inventario ni cocina. Al confirmar, cada parte queda pagable por separado.',
            domain: 'tables',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('División de cuenta', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la división de cuenta');
        const orderId = toPositiveInt(args.order_id);
        const mode = String(args.mode ?? '');
        if (!orderId || !['items', 'equal', 'custom'].includes(mode)) {
          return guidedError(
            'order_id y mode (items, equal o custom) son obligatorios.',
          );
        }

        const plain = buildSplitPlain(args, mode);
        if (typeof plain === 'string') return guidedError(plain);

        try {
          // Re-verificación: el servicio ata source_version, así que se
          // re-calcula el preview al aplicar. Si la cuenta se movió tras la
          // confirmación, la versión no coincide y el servicio rechaza en vez
          // de dividir sobre un supuesto viejo.
          const fresh = await splitOrderService.preview(
            orderId,
            plainToInstance(SplitPreviewDto, plain, {
              enableImplicitConversion: true,
            }),
          );
          const idempotencyKey = randomUUID();
          const confirmPlain = {
            ...plain,
            source_version: fresh.source_version,
            idempotency_key: idempotencyKey,
          };

          if (mode === 'items') {
            // `SplitByItemsDto` no declara `mode` (el servicio lo fija en
            // 'items' al confirmar): viajaría como non-whitelisted.
            const { mode: _ignoredMode, ...itemsPlain } = confirmPlain as Record<
              string,
              unknown
            >;
            void _ignoredMode;
            const checked = toValidatedDto(SplitByItemsDto, itemsPlain);
            if (!checked.ok) return guidedError(checked.message);
            const result = await splitOrderService.splitByItems(
              orderId,
              checked.dto,
            );
            return JSON.stringify(splitSummary(orderId, result));
          }

          const checked = toValidatedDto(SplitByAmountDto, {
            ...confirmPlain,
            mode: mode === 'custom' ? 'custom' : 'equal',
            ...(mode === 'equal' ? { amounts: undefined } : {}),
          });
          if (!checked.ok) return guidedError(checked.message);
          const result = await splitOrderService.splitByAmount(
            orderId,
            checked.dto,
          );
          return JSON.stringify(splitSummary(orderId, result));
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude dividir la cuenta: ${info.message}`,
            'La cuenta pudo cambiar tras la confirmación: revisa la orden y pide la división de nuevo.',
          );
        }
      },
    },
  ];
}

function buildSplitPlain(
  args: Record<string, any>,
  mode: string,
): Record<string, unknown> | string {
  const accounts = Array.isArray(args.accounts)
    ? args.accounts.map((account: any) => ({
        ...(account?.label ? { label: String(account.label) } : {}),
        ...(account?.customer_id !== undefined &&
        account?.customer_id !== null
          ? { customer_id: Number(account.customer_id) }
          : {}),
        ...(account?.customer_alias
          ? { customer_alias: String(account.customer_alias) }
          : {}),
      }))
    : undefined;

  if (mode === 'items') {
    const groups = Array.isArray(args.item_groups) ? args.item_groups : [];
    if (groups.length < 2) {
      return 'mode items exige item_groups con al menos 2 grupos de renglones.';
    }
    return {
      mode: 'items',
      item_groups: groups.map((group: any) => ({
        order_item_ids: (Array.isArray(group?.order_item_ids)
          ? group.order_item_ids
          : []
        ).map(Number),
      })),
      ...(accounts ? { accounts } : {}),
    };
  }

  if (mode === 'equal') {
    const nSplits = Number(args.n_splits);
    if (!Number.isInteger(nSplits) || nSplits < 2 || nSplits > 20) {
      return 'mode equal exige n_splits entre 2 y 20.';
    }
    return {
      mode: 'equal',
      n_splits: nSplits,
      ...(accounts ? { accounts } : {}),
    };
  }

  const amounts = Array.isArray(args.amounts)
    ? args.amounts.map(Number)
    : [];
  if (amounts.length < 2) {
    return 'mode custom exige amounts con al menos 2 montos.';
  }
  return {
    mode: 'custom',
    n_splits: amounts.length,
    amounts,
    ...(accounts ? { accounts } : {}),
  };
}

function splitSummary(orderId: number, result: any): Record<string, unknown> {
  const accounts = (result.accounts ?? []).filter(
    (account: any) => account.role === 'payable',
  );
  return {
    resumen: `Cuenta #${orderId} dividida en ${accounts.length} parte(s) (solo financiero, sin movimientos de inventario)`,
    order_id: orderId,
    split_group_id: result.split_group_id,
    currency: result.currency,
    pending_to_split: result.pending_to_split,
    accounts: accounts.map((account: any) => ({
      ordinal: account.ordinal,
      label: account.label,
      customer_alias: account.customer_alias,
      grand_total: account.grand_total,
      payment_state: account.payment_state,
    })),
  };
}
