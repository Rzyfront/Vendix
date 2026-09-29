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
import {
  CreateTableDto,
  TABLE_STATUS_VALUES,
  UpdateTableDto,
} from '../../../domains/store/tables/dto/table.dto';
import { EcommerceTablesService } from '../../../domains/ecommerce/tables/ecommerce-tables.service';
import { RequestBillDto } from '../../../domains/ecommerce/tables/dto/request-bill.dto';
import { RequestSplitDto } from '../../../domains/ecommerce/tables/dto/request-split.dto';

export interface TablesToolDeps {
  tablesService: TablesService;
  tableSessionsService: TableSessionsService;
  splitOrderService: SplitOrderService;
}

export interface ComensalToolDeps {
  ecommerceTablesService: EcommerceTablesService;
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
 * K-6/K-7/K-8/K-9 — Mesas y cuenta (paso 8 P0 + paso 13 K-6/K-7).
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
    // ─── K-6: list_tables (READ, plano + QR) ───────────────────────
    {
      name: 'list_tables',
      version: '1',
      domain: 'tables',
      readOnly: true,
      description:
        'Lee las mesas de la tienda: sin filtros devuelve el plano completo (zona, estado, capacidad, posición) con conteo por estado; con zone/status/search pagina el listado; con table_id devuelve el detalle de UNA mesa con su sesión activa y su QR (URL pública + imagen). Es la lectura habilitante antes de manage_tables y manage_table_session.',
      parameters: {
        type: 'object',
        properties: {
          table_id: {
            type: 'number',
            description:
              'Detalle de UNA mesa: estado, sesión activa y QR para el comensal.',
          },
          zone: {
            type: 'string',
            description: 'Filtra el listado por zona (ej. "Terraza").',
          },
          status: {
            type: 'string',
            enum: [...TABLE_STATUS_VALUES],
            description: 'Filtra por estado: available, occupied, reserved, cleaning.',
          },
          search: {
            type: 'string',
            description: 'Busca por nombre de mesa.',
          },
          page: { type: 'number', description: 'Página (por defecto 1).' },
          limit: {
            type: 'number',
            description: 'Filas por página (por defecto 50, máximo 100).',
          },
        },
      },
      requiredPermissions: ['store:tables:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la lectura de mesas');
        const status = args.status ? String(args.status) : undefined;
        if (
          status &&
          !(TABLE_STATUS_VALUES as readonly string[]).includes(status)
        ) {
          return guidedError(
            `status "${status}" inválido. Usa uno de: ${TABLE_STATUS_VALUES.join(', ')}.`,
          );
        }

        try {
          const tableId = toPositiveInt(args.table_id);
          if (args.table_id !== undefined && !tableId) {
            return guidedError('table_id inválido.');
          }
          if (tableId) {
            const [table, qr] = await Promise.all([
              tablesService.findOne(tableId),
              tablesService.getQr(tableId),
            ]);
            return JSON.stringify({
              mesa: {
                table_id: (table as any)?.id,
                name: (table as any)?.name,
                zone: (table as any)?.zone ?? null,
                status: (table as any)?.status,
                capacity: (table as any)?.capacity ?? null,
                pos_x: (table as any)?.pos_x ?? null,
                pos_y: (table as any)?.pos_y ?? null,
                active_session: (table as any)?.active_session ?? null,
              },
              qr: {
                public_url: (qr as any)?.public_url,
                qr_data_url: (qr as any)?.qr_data_url,
              },
              next_step:
                'Para operar la sesión abierta usa manage_table_session; para editar la mesa usa manage_tables.',
            });
          }

          const hasFilters =
            args.zone !== undefined ||
            status !== undefined ||
            args.search !== undefined;
          if (hasFilters) {
            const page = Math.max(Number(args.page) || 1, 1);
            const limit = Math.min(
              Math.max(Number(args.limit) || 50, 1),
              100,
            );
            const result = await tablesService.findAll({
              page,
              limit,
              ...(args.zone ? { zone: String(args.zone) } : {}),
              ...(status ? { status: status as any } : {}),
              ...(args.search ? { search: String(args.search) } : {}),
            });
            return JSON.stringify({
              resumen: `${(result.data ?? []).length} mesa(s) de ${result.meta?.total ?? 0} en total`,
              pagina: result.meta?.page ?? page,
              paginas: result.meta?.totalPages ?? 1,
              mesas: (result.data ?? []).map((table: any) => ({
                table_id: table.id,
                name: table.name,
                zone: table.zone ?? null,
                status: table.status,
                capacity: table.capacity ?? null,
              })),
            });
          }

          const floor = await tablesService.floorMap();
          const byStatus: Record<string, number> = {};
          for (const table of floor as any[]) {
            byStatus[table.status] = (byStatus[table.status] ?? 0) + 1;
          }
          return JSON.stringify({
            resumen: `Plano: ${(floor as any[]).length} mesa(s)`,
            por_estado: byStatus,
            mesas: (floor as any[]).map((table: any) => ({
              table_id: table.id,
              name: table.name,
              zone: table.zone ?? null,
              status: table.status,
              capacity: table.capacity ?? null,
              pos_x: table.pos_x ?? null,
              pos_y: table.pos_y ?? null,
              session_open: Boolean(table.active_session),
            })),
          });
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude leer las mesas: ${info.message}`,
            'Verifica el table_id con list_tables sin filtros.',
          );
        }
      },
    },

    // ─── K-7: manage_tables (WRITE, exige K-6) ─────────────────────
    {
      name: 'manage_tables',
      version: '1',
      domain: 'tables',
      description:
        'Crea, edita o elimina mesas físicas: create (nombre + zona/capacidad/posición opcionales), update (cambia nombre, zona, estado, capacidad o posición) y remove (elimina; la mesa no debe tener sesión abierta). Lee PRIMERO la mesa con list_tables + table_id: el preview muestra el cambio from→to y el handler re-verifica que la mesa siga igual antes de mutar.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create', 'update', 'remove'],
            description: 'create, update o remove.',
          },
          table_id: {
            type: 'number',
            description: 'ID de la mesa (requerido en update y remove).',
          },
          name: {
            type: 'string',
            description: 'Nombre de la mesa (requerido en create).',
          },
          zone: { type: 'string', description: 'Zona (ej. "Terraza").' },
          capacity: { type: 'number', description: 'Comensales (mínimo 1).' },
          status: {
            type: 'string',
            enum: [...TABLE_STATUS_VALUES],
            description: 'Estado: available, occupied, reserved, cleaning.',
          },
          pos_x: { type: 'number', description: 'Posición X en el plano.' },
          pos_y: { type: 'number', description: 'Posición Y en el plano.' },
        },
        required: ['action'],
      },
      requiredPermissions: [
        'store:tables:create',
        'store:tables:update',
        'store:tables:delete',
      ],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Mesas',
            'Sin tienda en contexto: las mesas siempre viven dentro de una tienda.',
          );
        }
        const action = String(args.action ?? '');
        if (!['create', 'update', 'remove'].includes(action)) {
          return previewError(
            'Mesas',
            `action "${action}" inválida. Usa create, update o remove.`,
          );
        }

        try {
          if (action === 'create') {
            const name = String(args.name ?? '').trim();
            if (!name) {
              return previewError(
                'Creación de mesa',
                'create exige name.',
              );
            }
            return {
              status: 'ok',
              target: `Creación de mesa — "${name}"`,
              changes: [
                ...(args.zone
                  ? [
                      {
                        field: 'zone',
                        label: 'Zona',
                        from: null,
                        to: String(args.zone),
                      },
                    ]
                  : []),
                ...(args.capacity !== undefined
                  ? [
                      {
                        field: 'capacity',
                        label: 'Capacidad',
                        from: null,
                        to: Number(args.capacity),
                      },
                    ]
                  : []),
                ...(args.status
                  ? [
                      {
                        field: 'status',
                        label: 'Estado',
                        from: null,
                        to: String(args.status),
                      },
                    ]
                  : []),
              ],
              domain: 'tables',
            };
          }

          const tableId = toPositiveInt(args.table_id);
          if (!tableId) {
            return previewError(
              'Mesas',
              `${action} exige table_id. Lee la mesa con list_tables primero.`,
            );
          }
          const table = await tablesService.findOne(tableId);
          const label = `Mesa ${(table as any)?.name ?? `#${tableId}`}`;
          if (action === 'remove') {
            if ((table as any)?.active_session) {
              return previewError(
                label,
                'Esa mesa tiene una sesión abierta: ciérrala con manage_table_session(close) antes de eliminarla.',
              );
            }
            return {
              status: 'warning',
              target: `Eliminación — ${label}`,
              changes: [
                {
                  field: 'table',
                  label: 'Mesa',
                  from: (table as any)?.name ?? `#${tableId}`,
                  to: 'eliminada',
                },
              ],
              message: 'Eliminar es irreversible.',
              domain: 'tables',
            };
          }

          const fields = [
            'name',
            'zone',
            'capacity',
            'status',
            'pos_x',
            'pos_y',
          ].filter((field) => args[field] !== undefined);
          if (!fields.length) {
            return previewError(
              label,
              'update exige al menos un campo: name, zone, capacity, status, pos_x o pos_y.',
            );
          }
          return {
            status: 'ok',
            target: `Edición — ${label}`,
            changes: fields.map((field) => ({
              field,
              label: field,
              from: (table as any)?.[field] ?? null,
              to: args[field],
            })),
            domain: 'tables',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Mesas', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la gestión de mesas');
        const action = String(args.action ?? '');

        try {
          if (action === 'create') {
            const checked = toValidatedDto(CreateTableDto, {
              ...(args.name ? { name: String(args.name) } : {}),
              ...(args.zone ? { zone: String(args.zone) } : {}),
              ...(args.capacity !== undefined
                ? { capacity: Number(args.capacity) }
                : {}),
              ...(args.status ? { status: String(args.status) } : {}),
              ...(args.pos_x !== undefined
                ? { pos_x: Number(args.pos_x) }
                : {}),
              ...(args.pos_y !== undefined
                ? { pos_y: Number(args.pos_y) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const created = await tablesService.create(checked.dto);
            return JSON.stringify({
              resumen: `Mesa "${(created as any)?.name}" creada (#${(created as any)?.id})`,
              table_id: (created as any)?.id,
            });
          }

          const tableId = toPositiveInt(args.table_id);
          if (!tableId) {
            return guidedError(
              `${action} exige table_id.`,
              'Lee la mesa con list_tables y pasa su table_id.',
            );
          }
          // Re-verificación: la mesa pudo cambiar o abrir sesión tras el preview.
          const current = await tablesService.findOne(tableId);
          if (action === 'remove') {
            if ((current as any)?.active_session) {
              return guidedError(
                'La mesa abrió una sesión después de la confirmación: no la eliminé.',
                'Cierra la sesión con manage_table_session(close) e inténtalo de nuevo.',
              );
            }
            await tablesService.remove(tableId);
            return JSON.stringify({
              resumen: `Mesa "${(current as any)?.name ?? `#${tableId}`}" eliminada`,
              table_id: tableId,
            });
          }

          if (action === 'update') {
            const checked = toValidatedDto(UpdateTableDto, {
              ...(args.name !== undefined
                ? { name: String(args.name) }
                : {}),
              ...(args.zone !== undefined
                ? { zone: String(args.zone) }
                : {}),
              ...(args.capacity !== undefined
                ? { capacity: Number(args.capacity) }
                : {}),
              ...(args.status !== undefined
                ? { status: String(args.status) }
                : {}),
              ...(args.pos_x !== undefined
                ? { pos_x: Number(args.pos_x) }
                : {}),
              ...(args.pos_y !== undefined
                ? { pos_y: Number(args.pos_y) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            const updated = await tablesService.update(
              tableId,
              checked.dto,
            );
            return JSON.stringify({
              resumen: `Mesa "${(updated as any)?.name ?? `#${tableId}`}" actualizada`,
              table_id: tableId,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa create, update o remove.`,
          );
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude gestionar la mesa: ${info.message}`,
            'Lee la mesa con list_tables para ver su estado actual y reintenta.',
          );
        }
      },
    },

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

/**
 * K-10/K-11 — Soporte comensal lado merchant (paso 13, P1/P2).
 *
 * Vive en este fichero por dominio (mesas) pero se registra en
 * `EcommerceTablesModule.onModuleInit`, NO en `TablesModule`: ese módulo
 * ecommerce ya importa `TablesModule`, así que registrar aquí
 * reintroduciría el ciclo DI que el registro descentralizado existe para
 * evitar. El `token` es el `public_token` del QR de la mesa.
 *
 * - K-10 `get_table_bill` es read-only: lee la cuenta y los medios de
 *   pago habilitados. No abre sesiones ni cobra.
 * - K-11 `manage_comensal_request` registra solicitudes del comensal
 *   (llamar al mesero, pedir la cuenta, pedir división). NUNCA paga:
 *   `pay`/`pay/confirm` quedan deliberadamente fuera de esta tool.
 */
export function createComensalTools(
  deps: ComensalToolDeps,
): RegisteredTool[] {
  const { ecommerceTablesService } = deps;

  return [
    // ─── K-10: get_table_bill (READ) ─────────────────────────────
    {
      name: 'get_table_bill',
      version: '1',
      domain: 'tables',
      readOnly: true,
      description:
        'Lee la cuenta abierta de una mesa desde el token del QR: mesa, sesión, renglones con subtotal/impuestos/total, lo ya pagado y el saldo pendiente, más los medios de pago habilitados. Es la lectura habilitante antes de manage_comensal_request. No abre sesiones ni cobra: solo lee (deliberadamente NO resuelve el token, porque resolverlo abre sesión según el modo QR).',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description:
              'El public_token del QR de la mesa (lo devuelve list_tables + table_id).',
          },
        },
        required: ['token'],
      },
      requiredPermissions: ['store:tables:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la lectura de la cuenta');
        const token = String(args.token ?? '').trim();
        if (!token) {
          return guidedError(
            'token es obligatorio.',
            'Lee la mesa con list_tables + table_id para obtener su token del QR.',
          );
        }

        try {
          // Solo lecturas puras: `resolveByToken` tiene efectos (según el
          // modo QR marca ocupada, abre sesión o avisa al personal) y una
          // tool readOnly jamás los dispara.
          const [bill, paymentMethods] = await Promise.all([
            ecommerceTablesService.getBill(token),
            ecommerceTablesService.getTablePaymentMethods(token),
          ]);
          return JSON.stringify({
            mesa: {
              table_id: (bill as any)?.table?.id,
              name: (bill as any)?.table?.name,
              session_id: (bill as any)?.session_id,
              order_id: (bill as any)?.order_id,
            },
            cuenta: {
              items: ((bill as any)?.items ?? []).map((item: any) => ({
                product_name: item.product_name ?? item.name,
                quantity: item.quantity,
                unit_price: item.unit_price ?? null,
                total: item.total ?? item.line_total ?? null,
              })),
              subtotal: (bill as any)?.subtotal,
              tax_amount: (bill as any)?.tax_amount ?? null,
              grand_total: (bill as any)?.grand_total,
              total_paid: (bill as any)?.total_paid ?? null,
              balance_due: (bill as any)?.balance_due ?? null,
              currency: (bill as any)?.currency ?? null,
            },
            medios_de_pago: (paymentMethods as any[]).map((method: any) => ({
              id: method.id,
              type: method.type,
              name: method.name,
              requires_reference: method.requires_reference ?? false,
            })),
            next_step:
              'Para registrar una solicitud del comensal (mesero, cuenta, división) usa manage_comensal_request con este mismo token. El cobro lo hace el personal, nunca el agente.',
          });
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'TABLE_NOT_FOUND') {
            return guidedError(
              'Ese token no corresponde a ninguna mesa de esta tienda.',
              'Lee la mesa con list_tables + table_id para obtener su token vigente.',
            );
          }
          return guidedError(
            `No pude leer la cuenta: ${info.message}`,
            'Verifica que la mesa tenga una sesión abierta.',
          );
        }
      },
    },

    // ─── K-11: manage_comensal_request (WRITE, exige K-10) ────────
    {
      name: 'manage_comensal_request',
      version: '1',
      domain: 'tables',
      description:
        'Registra una solicitud del comensal sobre su mesa: call-waiter (llamar al mesero), request-bill (pedir la cuenta, con preferencia de pago opcional) o request-split (pedir división en N partes). Lee PRIMERO la cuenta con get_table_bill + token. NUNCA cobra ni auto-paga: el pago lo confirma el personal por su flujo; esta tool solo avisa al personal.',
      parameters: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'El public_token del QR de la mesa.',
          },
          action: {
            type: 'string',
            enum: ['call-waiter', 'request-bill', 'request-split'],
            description:
              'call-waiter: llamar al mesero. request-bill: pedir la cuenta. request-split: pedir división (exige n_splits y mode).',
          },
          note: {
            type: 'string',
            description: 'Nota para el personal (opcional, máx. 280).',
          },
          payment_preference: {
            type: 'string',
            enum: ['cash', 'card', 'split'],
            description:
              'Preferencia de pago del comensal (solo request-bill).',
          },
          n_splits: {
            type: 'number',
            description: 'Número de partes (solo request-split, mínimo 2).',
          },
          mode: {
            type: 'string',
            enum: ['equal', 'custom', 'by_items'],
            description: 'Modo de división (solo request-split).',
          },
        },
        required: ['token', 'action'],
      },
      requiredPermissions: ['store:tables:update'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Solicitud del comensal',
            'Sin tienda en contexto: las mesas siempre viven dentro de una tienda.',
          );
        }
        const token = String(args.token ?? '').trim();
        const action = String(args.action ?? '');
        if (!token) {
          return previewError(
            'Solicitud del comensal',
            'token es obligatorio. Lee la cuenta con get_table_bill primero.',
          );
        }
        if (!['call-waiter', 'request-bill', 'request-split'].includes(action)) {
          return previewError(
            'Solicitud del comensal',
            `action "${action}" inválida. Usa call-waiter, request-bill o request-split.`,
          );
        }
        if (action === 'request-split') {
          const nSplits = Number(args.n_splits);
          const mode = String(args.mode ?? '');
          if (!Number.isInteger(nSplits) || nSplits < 2) {
            return previewError(
              'Solicitud del comensal',
              'request-split exige n_splits (entero, mínimo 2).',
            );
          }
          if (!['equal', 'custom', 'by_items'].includes(mode)) {
            return previewError(
              'Solicitud del comensal',
              'request-split exige mode: equal, custom o by_items.',
            );
          }
        }

        try {
          const bill = await ecommerceTablesService.getBill(token);
          const label = `Mesa ${(bill as any)?.table?.name ?? '(desconocida)'}`;
          const actionLabel: Record<string, string> = {
            'call-waiter': 'llamado al mesero',
            'request-bill': 'solicitud de cuenta',
            'request-split': `solicitud de división en ${args.n_splits}`,
          };
          return {
            status: 'ok',
            target: `${label} — ${actionLabel[action]}`,
            changes: [
              {
                field: 'staff_request',
                label: 'Aviso al personal',
                from: null,
                to: `${actionLabel[action]}${args.note ? ` ("${args.note}")` : ''}`,
              },
            ],
            message:
              'Solo avisa al personal: no cobra, no divide ni cierra nada. El cobro lo confirma el personal por su flujo.',
            domain: 'tables',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Solicitud del comensal', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la solicitud del comensal');
        const token = String(args.token ?? '').trim();
        const action = String(args.action ?? '');
        if (!token || !action) {
          return guidedError(
            'Toda solicitud exige get_table_bill primero.',
            'Llama get_table_bill con el token del QR y pasa token + action.',
          );
        }

        try {
          // Re-verificación: la sesión pudo cerrarse tras el preview.
          const bill = await ecommerceTablesService.getBill(token);
          const label = `Mesa ${(bill as any)?.table?.name ?? '(desconocida)'}`;

          if (action === 'call-waiter') {
            await ecommerceTablesService.callWaiter(
              token,
              args.note ? String(args.note) : undefined,
            );
            return JSON.stringify({
              resumen: `${label}: mesero llamado${args.note ? ` ("${args.note}")` : ''}. El personal confirma en sala; nada se cobró.`,
            });
          }

          if (action === 'request-bill') {
            const checked = toValidatedDto(RequestBillDto, {
              ...(args.note ? { note: String(args.note) } : {}),
              ...(args.payment_preference
                ? { payment_preference: String(args.payment_preference) }
                : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await ecommerceTablesService.requestBill(token, checked.dto);
            return JSON.stringify({
              resumen: `${label}: cuenta solicitada${args.payment_preference ? ` (prefiere ${args.payment_preference})` : ''}. El cobro lo confirma el personal; nada se cobró.`,
            });
          }

          if (action === 'request-split') {
            const checked = toValidatedDto(RequestSplitDto, {
              ...(args.n_splits !== undefined
                ? { n_splits: Number(args.n_splits) }
                : {}),
              ...(args.mode ? { mode: String(args.mode) } : {}),
            });
            if (!checked.ok) return guidedError(checked.message);
            await ecommerceTablesService.requestSplit(token, checked.dto);
            return JSON.stringify({
              resumen: `${label}: división solicitada en ${args.n_splits} parte(s) (${args.mode}). El personal la ejecuta con split_bill; nada se cobró.`,
            });
          }

          return guidedError(
            `action "${action}" inválida. Usa call-waiter, request-bill o request-split.`,
          );
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude registrar la solicitud: ${info.message}`,
            'Repite get_table_bill para ver si la sesión sigue abierta y reintenta.',
          );
        }
      },
    },
  ];
}
