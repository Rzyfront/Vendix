import { createHash } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';
import { VendixHttpException } from '../../../common/errors';
import { KitchenFireService } from '../../../domains/store/kitchen-fire/kitchen-fire.service';
import {
  StockValidatorService,
  StockDemandLine,
  InsufficientStockItem,
} from '../../../domains/store/inventory/shared/services/stock-validator.service';
import { FireOrderItemsDto } from '../../../domains/store/kitchen-fire/dto/fire-order-items.dto';

export interface KitchenToolDeps {
  kitchenFireService: KitchenFireService;
  stockValidator: StockValidatorService;
}

type PreviewComponent = {
  component_product_id: number;
  name: string;
  sku: string | null;
  stock_unit: string | null;
  quantity: number;
};

type PreviewItem = {
  order_item_id: number;
  product_name: string;
  quantity: number;
  notes: string | null;
  has_active_recipe: boolean;
  components: PreviewComponent[];
};

function guidedError(error: string, nextStep?: string): string {
  return JSON.stringify({
    error,
    ...(nextStep ? { next_step: nextStep } : {}),
  });
}

function previewError(target: string, message: string): ToolPreview {
  return { status: 'error', target, changes: [], message, domain: 'kitchen' };
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

function toIdList(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const ids = value.map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return ids;
}

/**
 * K-1/K-2/K-4/K-5 — Cocina y KDS (paso 8, P0).
 *
 * Cadenas de validación obligatorias, con el mismo mecanismo que
 * `preview_refund` → `refund_order`: la lectura devuelve un testigo que el
 * write exige y re-verifica, porque el preview es proyección, no transacción.
 *
 * - K-2 `fire_kitchen_order` exige K-1 previo: el `preview_hash` ata
 *   (orden + renglones + BOM agregado + política de insumos). Si el mundo se
 *   movió entre la lectura y el apply, el hash no coincide y el write pide
 *   repetir K-1 en vez de cocinar sobre un supuesto viejo.
 * - K-5 `transition_kitchen_ticket` exige K-4 previo: el
 *   `ticket_status_seen` ata el estado que el agente vio. Si el ticket avanzó
 *   (otro mesero, el KDS), la transición pide re-leer.
 *
 * Invariantes del dominio (vendix-restaurant-ops): el consumo de insumos y el
 * COGS ocurren al disparar, no al pagar; un plato sin receta activa igual se
 * dispara y marca `inventory_consumed_at_fire=true` para que el pago no lo
 * toque (anti-doble-descuento); pasar a `in_preparation` sin receta se
 * rechaza con KITCHEN_TICKET_NO_RECIPE.
 */
export function createKitchenTools(deps: KitchenToolDeps): RegisteredTool[] {
  const { kitchenFireService, stockValidator } = deps;

  /**
   * Núcleo compartido de K-1, del preview de K-2 y del handler de K-2: corre
   * el `previewFire` del servicio, agrega el BOM por insumo compartido (un
   * insumo en dos platos se valida una vez, sumado) y corre
   * `assertIngredientsAvailable` respetando `allow_ingredient_overuse`
   * (`?? true`: la cocina que nunca tocó el switch sigue cocinando).
   */
  async function runFirePreview(
    orderId: number,
    orderItemIds: number[],
    storeId: number,
  ): Promise<{
    items: PreviewItem[];
    skipped_item_ids: number[];
    demands: StockDemandLine[];
    allow_ingredient_overuse: boolean;
    shortfalls: InsufficientStockItem[];
    blocked: boolean;
    preview_hash: string;
  }> {
    const preview = await kitchenFireService.previewFire(
      orderId,
      orderItemIds,
    );
    const items = (preview.items ?? []) as PreviewItem[];

    const aggregated = new Map<number, StockDemandLine>();
    for (const item of items) {
      for (const component of item.components ?? []) {
        const existing = aggregated.get(component.component_product_id);
        if (existing) {
          existing.quantity += component.quantity;
          existing.used_by = `${existing.used_by}; ${item.product_name}`;
        } else {
          aggregated.set(component.component_product_id, {
            product_id: component.component_product_id,
            quantity: component.quantity,
            product_name: component.name,
            used_by: item.product_name,
          });
        }
      }
    }
    const demands = [...aggregated.values()];

    const policy =
      await stockValidator.resolveInventoryPolicy(storeId);
    // Default permisivo del dominio: missing/null resuelve a `true`, NUNCA
    // `?? false` (eso bloquearía en silencio cada cocina que nunca tocó el
    // switch). Ver vendix-restaurant-ops § no-overselling.
    const allowIngredientOveruse =
      (policy as { allow_ingredient_overuse?: boolean | null })
        .allow_ingredient_overuse ?? true;

    let shortfalls: InsufficientStockItem[] = [];
    if (demands.length) {
      try {
        shortfalls = await stockValidator.assertIngredientsAvailable(
          demands,
          { allowIngredientOveruse },
        );
      } catch (error) {
        const info = describeError(error);
        if (info.code === 'INV_STOCK_INSUFFICIENT_LINES') {
          const details = (
            error as VendixHttpException
          ).getResponse() as {
            details?: { items?: InsufficientStockItem[] };
          };
          shortfalls =
            (typeof details === 'object' &&
              details?.details?.items) ||
            [];
        } else {
          throw error;
        }
      }
    }

    const fingerprint = JSON.stringify({
      order_id: orderId,
      items: items
        .map((item) => ({
          id: item.order_item_id,
          qty: item.quantity,
          recipe: item.has_active_recipe,
          bom: (item.components ?? [])
            .map((c) => [c.component_product_id, c.quantity])
            .sort((a, b) => a[0] - b[0]),
        }))
        .sort((a, b) => a.id - b.id),
      skipped: [...(preview.skipped_item_ids ?? [])].sort((a, b) => a - b),
      allow_ingredient_overuse: allowIngredientOveruse,
      // El stock también ata el hash: si un insumo se movió entre K-1 y el
      // apply, los faltantes cambian y el write pide repetir el preview.
      shortfalls: shortfalls
        .map((item) => [item.product_id, item.requested, item.available])
        .sort((a, b) => a[0] - b[0]),
    });
    const preview_hash = createHash('sha256')
      .update(fingerprint)
      .digest('hex')
      .slice(0, 32);

    return {
      items,
      skipped_item_ids: preview.skipped_item_ids ?? [],
      demands,
      allow_ingredient_overuse: allowIngredientOveruse,
      shortfalls,
      blocked: shortfalls.length > 0 && !allowIngredientOveruse,
      preview_hash,
    };
  }

  function shortfallLines(
    shortfalls: InsufficientStockItem[],
  ): string {
    return shortfalls
      .map(
        (item) =>
          `${(item as unknown as Record<string, unknown>).product_name ?? `#${item.product_id}`} (pide ${item.requested}, hay ${item.available}${item.used_by ? `; para ${item.used_by}` : ''})`,
      )
      .join('; ');
  }

  return [
    // ─── K-1: preview_kitchen_fire (READ) ──────────────────────────
    {
      name: 'preview_kitchen_fire',
      version: '1',
      domain: 'kitchen',
      readOnly: true,
      description:
        'Simula el envío de renglones de una orden a la cocina: explota el BOM por plato, agrega el consumo por insumo compartido y valida stock de insumos. Paso OBLIGATORIO antes de fire_kitchen_order: ese write exige el preview_hash que esta lectura devuelve. Respeta la política de la tienda (si permite sobre-uso, los faltantes son advertencia, no bloqueo).',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description: 'ID de la orden con los platos a enviar.',
          },
          order_item_ids: {
            type: 'array',
            minItems: 1,
            items: { type: 'number' },
            description: 'Renglones de la orden a enviar a cocina.',
          },
        },
        required: ['order_id', 'order_item_ids'],
      },
      requiredPermissions: ['store:kitchen_fire:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la vista previa de cocina');
        const orderId = toPositiveInt(args.order_id);
        const orderItemIds = toIdList(args.order_item_ids);
        if (!orderId || !orderItemIds) {
          return guidedError(
            'order_id y order_item_ids (al menos 1, enteros positivos) son obligatorios.',
            'Lee la orden para obtener sus renglones y reintenta.',
          );
        }

        try {
          const result = await runFirePreview(
            orderId,
            orderItemIds,
            Number(context.store_id),
          );
          if (!result.items.length) {
            return guidedError(
              'Ninguno de esos renglones se puede enviar: ya fueron disparados o no son platos preparados.',
              'Revisa el estado de la orden y elige renglones pendientes de cocina.',
            );
          }
          const recipeLess = result.items.filter(
            (item) => !item.has_active_recipe,
          );
          return JSON.stringify({
            order_id: orderId,
            items: result.items.map((item) => ({
              order_item_id: item.order_item_id,
              product_name: item.product_name,
              quantity: item.quantity,
              notes: item.notes,
              has_active_recipe: item.has_active_recipe,
              components: item.components,
            })),
            skipped_item_ids: result.skipped_item_ids,
            demands_aggregated: result.demands,
            ingredient_policy: {
              allow_ingredient_overuse: result.allow_ingredient_overuse,
            },
            shortfalls: result.shortfalls,
            blocked:
              result.shortfalls.length > 0 &&
              !result.allow_ingredient_overuse,
            recipe_less: recipeLess.map((item) => item.product_name),
            preview_hash: result.preview_hash,
            next_step:
              'Pasa order_id, order_item_ids y este preview_hash tal cual a fire_kitchen_order para pedir la confirmación.',
          });
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude simular el envío: ${info.message}`,
            'Verifica que la orden exista y tenga renglones preparados pendientes.',
          );
        }
      },
    },

    // ─── K-2: fire_kitchen_order (WRITE, exige K-1) ────────────────
    {
      name: 'fire_kitchen_order',
      version: '1',
      domain: 'kitchen',
      description:
        'Envía renglones de una orden a la cocina: consume insumos (BOM), reconoce COGS y crea el ticket del KDS. EXIGE haber llamado preview_kitchen_fire primero: pasa su preview_hash tal cual y el handler lo re-verifica (si el stock o la receta se movieron, te pide repetir el preview). Los platos sin receta activa igual se disparan pero sin consumo ni COGS.',
      parameters: {
        type: 'object',
        properties: {
          order_id: {
            type: 'number',
            description: 'ID de la orden con los platos a enviar.',
          },
          order_item_ids: {
            type: 'array',
            minItems: 1,
            items: { type: 'number' },
            description:
              'Renglones a enviar (los mismos del preview).',
          },
          preview_hash: {
            type: 'string',
            description:
              'El preview_hash que devolvió preview_kitchen_fire para estos mismos renglones. Sin haber llamado ese preview, el envío no procede.',
          },
          notes: {
            type: 'string',
            description: 'Nota general del envío (opcional).',
          },
        },
        required: ['order_id', 'order_item_ids', 'preview_hash'],
      },
      requiredPermissions: ['store:kitchen_fire:create'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Envío a cocina',
            'Sin tienda en contexto: el envío siempre vive dentro de una tienda.',
          );
        }
        const orderId = toPositiveInt(args.order_id);
        const orderItemIds = toIdList(args.order_item_ids);
        if (!orderId || !orderItemIds) {
          return previewError(
            'Envío a cocina',
            'order_id y order_item_ids (al menos 1, enteros positivos) son obligatorios.',
          );
        }
        const previewHash = String(args.preview_hash ?? '').trim();
        if (!previewHash) {
          return previewError(
            'Envío a cocina',
            'Todo envío exige preview_kitchen_fire primero: llama a esa lectura y pasa su preview_hash tal cual.',
          );
        }

        try {
          const result = await runFirePreview(
            orderId,
            orderItemIds,
            Number(context.store_id),
          );
          if (result.preview_hash !== previewHash) {
            return previewError(
              'Envío a cocina',
              'El preview cambió desde que lo leíste (stock, receta o renglones se movieron). Repite preview_kitchen_fire y usa su preview_hash nuevo.',
            );
          }
          if (result.blocked) {
            return previewError(
              'Envío a cocina',
              `Falta insumo controlado y la tienda no permite sobre-uso: ${shortfallLines(result.shortfalls)}. Ajusta el pedido o habilita el sobre-uso en la configuración de inventario.`,
            );
          }
          const subject = result.items
            .map((item) => `${item.product_name} x${item.quantity}`)
            .join('; ');
          return {
            status:
              result.shortfalls.length ||
              result.items.some((i) => !i.has_active_recipe)
                ? 'warning'
                : 'ok',
            target: `Envío a cocina — orden #${orderId}: ${subject}`,
            changes: result.items.map((item) => ({
              field: `item:${item.order_item_id}`,
              label: item.product_name,
              from: 'en borrador',
              to: item.has_active_recipe
                ? `a cocina (consume ${item.components.length} insumo(s))`
                : 'a cocina SIN receta (sin consumo, COGS 0; el pago no lo toca)',
            })),
            message:
              result.shortfalls.length && result.allow_ingredient_overuse
                ? `Sobre-uso permitido: estos insumos quedarán en negativo: ${shortfallLines(result.shortfalls)}.`
                : 'Al confirmar, los insumos salen del inventario y el ticket llega al KDS.',
            domain: 'kitchen',
          };
        } catch (error) {
          const info = describeError(error);
          return previewError('Envío a cocina', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('el envío a cocina');
        const orderId = toPositiveInt(args.order_id);
        const orderItemIds = toIdList(args.order_item_ids);
        const previewHash = String(args.preview_hash ?? '').trim();
        if (!orderId || !orderItemIds || !previewHash) {
          return guidedError(
            'Todo envío exige preview_kitchen_fire primero.',
            'Llama preview_kitchen_fire con los renglones a enviar y pasa su preview_hash tal cual.',
          );
        }

        try {
          // Re-verificación: el preview es proyección, el mundo pudo moverse.
          const result = await runFirePreview(
            orderId,
            orderItemIds,
            Number(context.store_id),
          );
          if (result.preview_hash !== previewHash) {
            return guidedError(
              'El preview cambió desde la confirmación (stock, receta o renglones se movieron): no disparé nada.',
              'Repite preview_kitchen_fire para cotizar con el estado actual y pide la confirmación de nuevo.',
            );
          }

          const dto = plainToInstance(
            FireOrderItemsDto,
            {
              order_id: orderId,
              order_item_ids: orderItemIds,
              ...(args.notes ? { notes: String(args.notes) } : {}),
            },
            { enableImplicitConversion: true },
          );
          const violations = validateSync(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
          });
          if (violations.length) {
            const details = violations
              .flatMap((entry) => Object.values(entry.constraints ?? {}))
              .join('; ');
            return guidedError(
              `Los datos no pasaron la validación: ${details || 'revisa los campos enviados'}.`,
            );
          }

          const fired = await kitchenFireService.fireOrderItems(dto);
          const dishNames = result.items
            .map((item) => `${item.product_name} x${item.quantity}`)
            .join('; ');
          return JSON.stringify({
            resumen: `Enviados a cocina (${dishNames}) — ticket #${fired.kitchen_ticket_id}`,
            kitchen_ticket_id: fired.kitchen_ticket_id,
            kitchen_ticket_ids: fired.kitchen_ticket_ids,
            fired_item_ids: fired.fired_item_ids,
            skipped_item_ids: fired.skipped_item_ids,
            cogs_total: fired.cogs_total,
            ...(fired.stock_warnings
              ? { stock_warnings: fired.stock_warnings }
              : {}),
          });
        } catch (error) {
          const info = describeError(error);
          return guidedError(
            `No pude enviar a cocina: ${info.message}`,
            'Repite preview_kitchen_fire para ver el estado actual y reintenta.',
          );
        }
      },
    },

    // ─── K-4: list_kitchen_tickets (READ, KDS) ─────────────────────
    {
      name: 'list_kitchen_tickets',
      version: '1',
      domain: 'kitchen',
      readOnly: true,
      description:
        'Lee los tickets activos del KDS (tablero de cocina): estado por ticket y por plato, orden y mesa. Si pasas ticket_id, devuelve además la verificación de recetas de ese ticket (insumos por plato y qué va excluido). Es el paso OBLIGATORIO antes de transition_kitchen_ticket: ese write exige el estado que esta lectura devuelve. El stream SSE del KDS no es una tool: esta lectura es la foto.',
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: [
              'pending',
              'in_preparation',
              'ready',
              'delivered',
              'cancelled',
            ],
            description: 'Filtra por estado del ticket (opcional).',
          },
          order_id: {
            type: 'number',
            description: 'Filtra por orden (opcional).',
          },
          limit: {
            type: 'number',
            description: 'Tope de tickets (por defecto 50, máximo 200).',
          },
          ticket_id: {
            type: 'number',
            description:
              'Si se pasa, devuelve el detalle y la verificación de recetas de ese ticket.',
          },
        },
        required: [],
      },
      requiredPermissions: ['store:kitchen_fire:read'],
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la lectura del KDS');

        try {
          const ticketId = toPositiveInt(args.ticket_id);
          if (ticketId) {
            const ticket =
              await kitchenFireService.findTicketById(ticketId);
            const verification =
              await kitchenFireService.getTicketVerification(ticketId);
            return JSON.stringify({
              ticket: {
                ticket_id: ticket.id,
                status: ticket.status,
                order_id: ticket.order_id,
                table: (ticket as any).table ?? null,
                fired_at: ticket.fired_at,
              },
              verification,
              next_step:
                'Para mover este ticket pasa ticket_id y este estado tal cual (ticket_status_seen) a transition_kitchen_ticket.',
            });
          }

          const status = args.status
            ? String(args.status)
            : undefined;
          const allowed = [
            'pending',
            'in_preparation',
            'ready',
            'delivered',
            'cancelled',
          ];
          if (status && !allowed.includes(status)) {
            return guidedError(
              `status "${status}" inválido. Usa uno de: ${allowed.join(', ')}.`,
            );
          }
          const limit = Math.min(
            Math.max(Number(args.limit ?? 50) || 50, 1),
            200,
          );
          const result = await kitchenFireService.findTickets({
            ...(status ? { status: status as any } : {}),
            ...(args.order_id ? { order_id: Number(args.order_id) } : {}),
            limit,
          } as any);
          const tickets = (result.data ?? []).map((ticket: any) => ({
            ticket_id: ticket.id,
            status: ticket.status,
            order_id: ticket.order_id,
            order_number: ticket.order?.order_number ?? null,
            table: ticket.table ?? null,
            fired_at: ticket.fired_at,
            items: (ticket.items ?? []).map((item: any) => ({
              product_name: item.product?.name ?? `#${item.id}`,
              quantity: item.quantity,
              status: item.status,
              notes: item.notes ?? null,
            })),
          }));
          return JSON.stringify({
            tickets,
            total: result.total,
            next_step: tickets.length
              ? 'Para mover un ticket pasa su ticket_id y el estado que ves aquí (ticket_status_seen) a transition_kitchen_ticket.'
              : 'No hay tickets con ese filtro.',
          });
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'KITCHEN_TICKET_NOT_FOUND') {
            return guidedError(
              `El ticket #${args.ticket_id} no existe en esta tienda.`,
              'Lista los tickets activos y elige un ticket_id de la lista.',
            );
          }
          return guidedError(
            `No pude leer el KDS: ${info.message}`,
            'Revisa los filtros e inténtalo de nuevo.',
          );
        }
      },
    },

    // ─── K-5: transition_kitchen_ticket (WRITE, exige K-4) ─────────
    {
      name: 'transition_kitchen_ticket',
      version: '1',
      domain: 'kitchen',
      description:
        'Mueve un ticket del KDS: start (a en preparación), ready (lista para entregar), delivered (entregada) o revert (devuelve al estado anterior). EXIGE haber llamado list_kitchen_tickets primero: pasa el estado que viste (ticket_status_seen) tal cual y el handler lo re-verifica. Pasar a en preparación sin receta activa se rechaza con KITCHEN_TICKET_NO_RECIPE (adjunta la receta o marca delivered directo). Anular no está disponible por agente: se hace desde el KDS.',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: {
            type: 'number',
            description: 'ID del ticket del KDS.',
          },
          action: {
            type: 'string',
            enum: ['start', 'ready', 'delivered', 'revert'],
            description:
              'start: pendiente → en preparación. ready: en preparación → lista. delivered: lista → entregada. revert: devuelve al estado anterior.',
          },
          ticket_status_seen: {
            type: 'string',
            enum: [
              'pending',
              'in_preparation',
              'ready',
              'delivered',
              'cancelled',
            ],
            description:
              'El estado que devolvió list_kitchen_tickets para este ticket. Sin haber llamado esa lectura, la transición no procede.',
          },
        },
        required: ['ticket_id', 'action', 'ticket_status_seen'],
      },
      requiredPermissions: ['store:kitchen_fire:update'],
      requiresConfirmation: true,
      preview: async (args, context) => {
        if (!context.store_id) {
          return previewError(
            'Transición de ticket',
            'Sin tienda en contexto: el KDS siempre vive dentro de una tienda.',
          );
        }
        const ticketId = toPositiveInt(args.ticket_id);
        const action = String(args.action ?? '');
        const seen = String(args.ticket_status_seen ?? '').trim();
        if (!ticketId) {
          return previewError('Transición de ticket', 'ticket_id inválido.');
        }
        if (!['start', 'ready', 'delivered', 'revert'].includes(action)) {
          return previewError(
            'Transición de ticket',
            `action "${action}" inválida. Usa start, ready, delivered o revert.`,
          );
        }
        if (!seen) {
          return previewError(
            'Transición de ticket',
            'Toda transición exige list_kitchen_tickets primero: llama a esa lectura y pasa el estado que viste (ticket_status_seen) tal cual.',
          );
        }

        try {
          const ticket =
            await kitchenFireService.findTicketById(ticketId);
          if (ticket.status !== seen) {
            return previewError(
              `Ticket #${ticketId}`,
              `El ticket cambió desde que lo leíste (viste ${seen}, ahora está ${ticket.status}). Repite list_kitchen_tickets y usa el estado nuevo.`,
            );
          }
          const allowedFrom: Record<string, string[]> = {
            start: ['pending'],
            ready: ['in_preparation'],
            delivered: ['ready'],
            revert: ['in_preparation', 'ready'],
          };
          if (!allowedFrom[action].includes(ticket.status)) {
            return previewError(
              `Ticket #${ticketId}`,
              `No se puede aplicar ${action} sobre un ticket en ${ticket.status}.`,
            );
          }
          if (action === 'start') {
            const verification =
              await kitchenFireService.getTicketVerification(ticketId);
            const withoutRecipe = (verification.items ?? [])
              .filter((item: any) => !item.has_active_recipe)
              .map((item: any) => item.product_name);
            if (withoutRecipe.length) {
              return previewError(
                `Ticket #${ticketId}`,
                `KITCHEN_TICKET_NO_RECIPE: estos platos no tienen receta activa: ${withoutRecipe.join('; ')}. Adjunta la receta primero o marca delivered directo.`,
              );
            }
          }
          const dishNames = ((ticket as any).items ?? [])
            .map(
              (item: any) =>
                `${item.product?.name ?? `#${item.id}`} x${item.quantity}`,
            )
            .join('; ');
          const actionLabel: Record<string, string> = {
            start: 'en preparación',
            ready: 'lista',
            delivered: 'entregada',
            revert: 'estado anterior',
          };
          return {
            status: 'ok',
            target: `Ticket #${ticketId} → ${actionLabel[action]} (${dishNames || 'sin platos'})`,
            changes: [
              {
                field: 'status',
                label: 'Estado',
                from: ticket.status,
                to: actionLabel[action],
              },
            ],
            domain: 'kitchen',
          };
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'KITCHEN_TICKET_NOT_FOUND') {
            return previewError(
              'Transición de ticket',
              `El ticket #${ticketId} no existe en esta tienda.`,
            );
          }
          return previewError('Transición de ticket', info.message);
        }
      },
      handler: async (args, context) => {
        if (!context.store_id) return noStore('la transición del KDS');
        const ticketId = toPositiveInt(args.ticket_id);
        const action = String(args.action ?? '');
        const seen = String(args.ticket_status_seen ?? '').trim();
        if (!ticketId || !action || !seen) {
          return guidedError(
            'Toda transición exige list_kitchen_tickets primero.',
            'Llama list_kitchen_tickets y pasa ticket_id, action y el estado visto (ticket_status_seen).',
          );
        }

        try {
          // Re-verificación: el ticket pudo avanzar en el KDS tras el preview.
          const ticket =
            await kitchenFireService.findTicketById(ticketId);
          if (ticket.status !== seen) {
            return guidedError(
              `El ticket cambió desde la confirmación (viste ${seen}, ahora está ${ticket.status}): no moví nada.`,
              'Repite list_kitchen_tickets para ver el estado actual y pide la confirmación de nuevo.',
            );
          }

          if (action === 'start') {
            await kitchenFireService.startPreparation(ticketId);
          } else if (action === 'ready') {
            await kitchenFireService.markReady(ticketId);
          } else if (action === 'delivered') {
            await kitchenFireService.markDelivered(ticketId);
          } else if (action === 'revert') {
            await kitchenFireService.revertTicket(ticketId);
          } else {
            return guidedError(
              `action "${action}" inválida. Usa start, ready, delivered o revert.`,
            );
          }
          return JSON.stringify({
            resumen: `Ticket #${ticketId}: ${seen} → ${action}`,
            ticket_id: ticketId,
            from: seen,
            action,
          });
        } catch (error) {
          const info = describeError(error);
          if (info.code === 'KITCHEN_TICKET_NOT_FOUND') {
            return guidedError(
              `El ticket #${ticketId} no existe en esta tienda.`,
              'Lista los tickets activos y elige un ticket_id de la lista.',
            );
          }
          if (info.code === 'KITCHEN_TICKET_NO_RECIPE') {
            return guidedError(
              `KITCHEN_TICKET_NO_RECIPE: ${info.message}`,
              'Adjunta la receta activa a los platos del ticket o marca delivered directo.',
            );
          }
          return guidedError(
            `No pude mover el ticket: ${info.message}`,
            'Repite list_kitchen_tickets para ver el estado actual y reintenta.',
          );
        }
      },
    },
  ];
}
