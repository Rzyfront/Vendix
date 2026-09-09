/**
 * Restaurant Suite — Phase F (KDS).
 * Source of truth for the Kitchen Display System domain in the frontend.
 *
 * Mirrors the Prisma models `kitchen_tickets` and `kitchen_ticket_items`
 * and the SSE envelope produced by
 * `apps/backend/src/domains/store/kitchen-fire/kitchen-fire.service.ts`.
 */

export type KitchenTicketStatus =
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export type KitchenTicketItemStatus = KitchenTicketStatus;

export interface KitchenTicketProductRef {
  id: number;
  name: string;
  sku?: string | null;
  stock_unit?: string | null;
  /**
   * Restaurant Suite — Fase K Gap 5: preparation time in minutes
   * (sourced from `products.preparation_time_minutes` via the
   * kitchen-fire service include). Used to drive the urgency
   * tier on the KDS card. Missing/0 ⇒ treated as the default
   * (10 min).
   */
  preparation_time_minutes?: number | null;
  /**
   * Restaurant Suite — KDS recipe-readiness: las recetas del producto,
   * anidadas por el include del kitchen-fire service. Recetas-por-variante
   * (paso 5): `products.recipes` es TO-MANY — `recipes.product_id` ya NO es
   * `@unique`, así que llega la receta BASE (`product_variant_id === null`)
   * más una receta por variante. La card y el modal derivan la presencia de
   * receta ACTIVA resolviendo por par `(product_id, product_variant_id)` con
   * caída a la base, en memoria y sin un fetch extra por línea — ver
   * `itemHasActiveRecipe`.
   */
  recipes?: Array<{
    id: number;
    is_active: boolean;
    product_variant_id: number | null;
  }> | null;
}

export interface KitchenTicketItem {
  /**
   * QUI-655 — insumos que NO se van a usar en este plato, tal como los quito
   * quien tomo el pedido. El KDS los muestra TACHADOS en el modal de confirmacion
   * para que el cocinero vea "sin papas" sin tener que leer una nota.
   */
  exclusions?: Array<{
    component_product_id: number;
    path_recipe_ids: number[];
  }>;
  /**
   * QUI-653 — el plato va empacado para llevar. Lo decide quien toma el pedido
   * pero lo EJECUTA la cocina, asi que el flag viaja con el ticket: sin esto el
   * cocinero emplata en loza algo que debia salir en caja.
   */
  order_item?: { is_takeaway: boolean } | null;
  id: number;
  kitchen_ticket_id: number;
  order_item_id: number;
  product_id: number;
  /**
   * CP-POLLO-ARABE-727 C.4 (QUI-736) — la variante vendida viaja a cocina para
   * que "Pollo" y "Pollo Picante" no sean indistinguibles en el tablero.
   * `product_variant_id` es el FK a `product_variants`; `variant_label` es el
   * snapshot inmutable al fire (denormalizado por A.6, A.3). El include del
   * backend usa `include` sin `select`, así que ambas columnas llegan por SSE
   * automáticamente — el tipo y el template deben leerlas explícitamente.
   */
  product_variant_id?: number | null;
  variant_label?: string | null;
  quantity: number;
  status: KitchenTicketItemStatus;
  notes?: string | null;
  product?: KitchenTicketProductRef;
}

/**
 * Restaurant Suite — KDS recipe-readiness helper. Derivación en memoria de
 * "¿este plato tiene receta activa?" sobre `product.recipes[]`, que viaja con
 * el ticket (snapshot + todo evento SSE `ticket.*`), sin un fetch por línea.
 *
 * Recetas-por-variante (paso 5): la relación es TO-MANY (una receta BASE más
 * una por variante), así que la resolución replica exactamente el guard del
 * backend `KitchenFireService.startPreparation` /
 * `resolveRecipeForVariant`:
 *   1. se consideran SÓLO las recetas con `is_active === true` (una receta
 *      inactiva de la variante no bloquea la caída a la base);
 *   2. si la línea trae `product_variant_id`, gana la receta activa con ESE
 *      `product_variant_id`;
 *   3. si esa variante no tiene la suya, cae a la receta BASE activa
 *      (`product_variant_id === null`);
 *   4. si no hay ninguna, la línea es «sin receta».
 *
 * Una línea sin receta activa bloquea la transición a `in_preparation`
 * (guard backend `KITCHEN_TICKET_NO_RECIPE`), así que el KDS lo anticipa en
 * la card en vez de esperar al clic fallido.
 */
export function itemHasActiveRecipe(item: KitchenTicketItem): boolean {
  const recipes = item.product?.recipes;
  if (!recipes?.length) return false;

  const variantId = item.product_variant_id ?? null;
  let base: { id: number; is_active: boolean } | null = null;

  for (const recipe of recipes) {
    if (recipe.is_active !== true) continue;
    if (recipe.product_variant_id == null) {
      base = recipe;
    } else if (variantId != null && recipe.product_variant_id === variantId) {
      // Receta exacta de la variante: gana sobre la base, corta la búsqueda.
      return true;
    }
  }

  return base != null;
}

export interface KitchenTicket {
  id: number;
  store_id: number;
  order_id: number;
  /**
   * QUI-651 — el consecutivo diario es POR ESTACION: cada tablero cuenta desde 1,
   * asi cocina canta #1 y barra canta #1 el mismo dia.
   */
  daily_number?: number | null;
  /** QUI-651 — estacion que prepara este ticket. NOT NULL en la DB. */
  kds_id?: number;
  order?: {
    order_number: string;
    customer_alias?: string | null;
    users?: { first_name: string; last_name: string } | null;
  } | null;
  /**
   * QUI-756 — rótulo humano de la mesa, anidado por `KITCHEN_TICKET_INCLUDE`
   * en el backend. `table_id` (el FK crudo) sigue presente para queries
   * internas, pero el card renderiza `table?.name` y cae a `#table_id`
   * como fallback defensivo si el include no viaja (snapshot legacy).
   */
  table?: { id: number; name: string } | null;
  table_id?: number | null;
  status: KitchenTicketStatus;
  fired_at: string | Date;
  /**
   * Business date (tz + ticket_closing_hour aware) assigned at fire time.
   * Drives the KDS board reset: the board shows only the current business
   * day's tickets. Serialized as an ISO string over SSE/REST (UTC midnight
   * of the local business date). Null on legacy pre-migration tickets.
   */
  business_date?: string | Date | null;
  ready_at?: string | Date | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
  items: KitchenTicketItem[];
}

/**
 * SSE envelope — a tagged union over the KDS event types. The server
 * emits one of these for every state change; the KDS page reconciles
 * the current `tickets` array using the embedded `ticket` payload.
 */
export type KdsEvent =
  | {
      type: 'snapshot';
      tickets: KitchenTicket[];
      total: number;
      server_ts: number;
      window_minutes: number;
      error?: string;
    }
  | {
      type: 'ticket.created';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.started';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.ready';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.delivered';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.cancelled';
      ticket: KitchenTicket;
      ts: number;
    }
  | {
      type: 'ticket.reverted';
      ticket: KitchenTicket;
      ts: number;
    };

export interface KdsSnapshotResponse {
  tickets: KitchenTicket[];
  total: number;
  server_ts: number;
  window_minutes: number;
}

/**
 * Column definition for the KDS board. Mirrors the `pending → ready`
 * workflow. `delivered` and `cancelled` are soft columns that hold the
 * most recent closed tickets so the kitchen can see what just left —
 * kept visually distinct (green vs red) instead of mixed together.
 */
export type KdsColumn =
  | 'pending'
  | 'in_preparation'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export const KDS_COLUMNS: readonly KdsColumn[] = [
  'pending',
  'in_preparation',
  'ready',
  'delivered',
  'cancelled',
] as const;
