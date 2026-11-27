import { AsyncLocalStorage } from 'node:async_hooks';
import { RegisteredTool } from '../interfaces/tool.interface';
import { STOREFRONT_TOOL_DOMAIN } from '../agent-tool-catalog';

/**
 * Vexi público F2 — the storefront tools of the public Vexi.
 *
 * They read ONLY what the store already publishes (the public catalog, scoped
 * to the store by `DomainResolverMiddleware`) and they NEVER write: a
 * `storefront_propose_*` tool returns a proposal card that the visitor's
 * browser turns into a real cart/checkout, booking or PQR through the existing
 * public endpoints, with the visitor's own identity. Prices shown in a card
 * are catalog hints; the checkout recalculates every total.
 *
 * Domain `storefront`: the registry offers and executes these tools only for a
 * closed-catalog agent (Vexi público) and hides them from staff turns.
 */

/** Minimal public-catalog port (implemented by `CatalogService`). */
export interface StorefrontCatalogPort {
  getProducts(query: {
    search?: string;
    ids?: string;
    limit?: number;
    page?: number;
    include_variants?: string;
  }): Promise<{ data?: unknown[] } | unknown>;
}

export interface StorefrontToolDeps {
  catalog: StorefrontCatalogPort;
}

export const STOREFRONT_CARD_TOOLS = Object.freeze([
  'storefront_propose_order',
  'storefront_propose_booking',
  'storefront_propose_request',
] as const);

export type StorefrontCard =
  | {
      kind: 'order';
      items: Array<{
        product_id: number;
        variant_id: number | null;
        name: string;
        variant_name: string | null;
        sku: string | null;
        quantity: number;
        /** Catalog price hint for the cart line; the checkout recalculates. */
        unit_price: number;
      }>;
    }
  | { kind: 'booking'; product_id: number; name: string; slug: string | null }
  | {
      kind: 'request';
      pqr_type: 'PETITION' | 'COMPLAINT' | 'CLAIM' | 'SUGGESTION';
      subject: string;
      description: string;
    };

const PQR_TYPES = ['PETITION', 'COMPLAINT', 'CLAIM', 'SUGGESTION'] as const;
const MAX_ORDER_LINES = 20;
const MAX_QUANTITY = 99;

type CatalogProduct = {
  id: number;
  name: string;
  slug?: string | null;
  sku?: string | null;
  final_price?: number | string | null;
  product_type?: string | null;
  requires_booking?: boolean | null;
  is_available?: boolean | null;
  stock_quantity?: number | null;
  variants?: CatalogVariant[];
};
type CatalogVariant = {
  id: number;
  name?: string | null;
  sku?: string | null;
  final_price?: number | string | null;
  is_available?: boolean | null;
  stock_quantity?: number | null;
};

function rows(result: unknown): CatalogProduct[] {
  const data = (result as { data?: unknown })?.data;
  return Array.isArray(data) ? (data as CatalogProduct[]) : [];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fail(error: string, next_step: string): string {
  return JSON.stringify({ ok: false, error, next_step });
}

function isService(p: CatalogProduct): boolean {
  return p.product_type === 'service' || p.requires_booking === true;
}

async function loadByIds(
  deps: StorefrontToolDeps,
  ids: number[],
): Promise<Map<number, CatalogProduct>> {
  const unique = [...new Set(ids)];
  const result = await deps.catalog.getProducts({
    ids: unique.join(','),
    limit: unique.length,
    page: 1,
    include_variants: 'true',
  });
  return new Map(rows(result).map((p) => [Number(p.id), p]));
}

const ACCESS_REASON =
  'Public storefront surface: reads only the store published catalog (same data as the public catalog endpoint) and never writes; offered only to the closed-catalog public agent.';

export function createStorefrontTools(deps: StorefrontToolDeps): RegisteredTool[] {
  return [
    {
      name: 'storefront_search_products',
      access: 'public',
      accessReason: ACCESS_REASON,
      version: '1',
      domain: STOREFRONT_TOOL_DOMAIN,
      readOnly: true,
      description:
        'Busca productos y servicios publicados de esta tienda. Devuelve id, nombre, tipo, precio de catálogo, disponibilidad y variantes. Úsalo antes de proponer un pedido o una reserva.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: {
            type: 'string',
            maxLength: 120,
            description: 'Lo que busca el cliente (nombre, tipo de producto).',
          },
          limit: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
      },
      handler: async (args: { query: string; limit?: number }) => {
        const result = await deps.catalog.getProducts({
          search: String(args.query ?? '').slice(0, 120),
          limit: Math.min(Math.max(Number(args.limit) || 6, 1), 10),
          page: 1,
          include_variants: 'true',
        });
        const products = rows(result).map((p) => ({
          id: p.id,
          name: p.name,
          type: isService(p) ? 'service' : 'product',
          price: num(p.final_price),
          available: p.is_available !== false,
          variants: (p.variants ?? []).map((v) => ({
            id: v.id,
            name: v.name ?? v.sku ?? null,
            price: num(v.final_price),
            available: v.is_available !== false,
          })),
        }));
        return JSON.stringify({ ok: true, products });
      },
    },
    {
      name: 'storefront_propose_order',
      access: 'public',
      accessReason: ACCESS_REASON,
      version: '1',
      domain: STOREFRONT_TOOL_DOMAIN,
      readOnly: true,
      description:
        'Propone un pedido con productos del catálogo (ids de storefront_search_products). NO crea el pedido: muestra al cliente una tarjeta para agregarlos al carrito e ir al pago de la tienda, que calcula el total.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_ORDER_LINES,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                product_id: { type: 'integer', minimum: 1 },
                variant_id: { type: 'integer', minimum: 1 },
                quantity: { type: 'integer', minimum: 1, maximum: MAX_QUANTITY },
              },
              required: ['product_id', 'quantity'],
            },
          },
        },
        required: ['items'],
      },
      handler: async (args: {
        items: Array<{ product_id: number; variant_id?: number; quantity: number }>;
      }) => {
        const lines = Array.isArray(args.items) ? args.items : [];
        if (!lines.length || lines.length > MAX_ORDER_LINES)
          return fail(
            'El pedido no tiene productos válidos.',
            'Busca los productos con storefront_search_products y vuelve a proponer.',
          );
        const byId = await loadByIds(
          deps,
          lines.map((l) => Number(l.product_id)),
        );
        const items: Extract<StorefrontCard, { kind: 'order' }>['items'] = [];
        for (const line of lines) {
          const product = byId.get(Number(line.product_id));
          if (!product)
            return fail(
              `El producto ${line.product_id} no está publicado en esta tienda.`,
              'Busca el producto con storefront_search_products; no inventes ids.',
            );
          if (isService(product))
            return fail(
              `"${product.name}" es un servicio con reserva.`,
              'Usa storefront_propose_booking para ese servicio.',
            );
          const quantity = Math.trunc(Number(line.quantity));
          if (!(quantity >= 1 && quantity <= MAX_QUANTITY))
            return fail('Cantidad inválida.', `Usa una cantidad entre 1 y ${MAX_QUANTITY}.`);
          let variant: CatalogVariant | undefined;
          if (line.variant_id != null) {
            variant = (product.variants ?? []).find(
              (v) => Number(v.id) === Number(line.variant_id),
            );
            if (!variant)
              return fail(
                `La variante ${line.variant_id} no pertenece a "${product.name}".`,
                'Usa los ids de variante que devolvió storefront_search_products.',
              );
          } else if ((product.variants ?? []).length > 0) {
            return fail(
              `"${product.name}" tiene variantes.`,
              'Pregunta al cliente cuál quiere y propone con variant_id.',
            );
          }
          if ((variant ?? product).is_available === false)
            return fail(
              `"${product.name}" no está disponible ahora.`,
              'Dile al cliente que no está disponible y ofrece alternativas del catálogo.',
            );
          items.push({
            product_id: Number(product.id),
            variant_id: variant ? Number(variant.id) : null,
            name: product.name,
            variant_name: variant ? (variant.name ?? variant.sku ?? null) : null,
            sku: (variant?.sku ?? product.sku) || null,
            quantity,
            unit_price: num(variant?.final_price ?? product.final_price),
          });
        }
        const card: StorefrontCard = { kind: 'order', items };
        emit(card);
        return JSON.stringify({
          ok: true,
          card,
          next_step:
            'Dile al cliente que revise la tarjeta y toque el botón para ir al pago. No des un total: lo calcula la página de pago.',
        });
      },
    },
    {
      name: 'storefront_propose_booking',
      access: 'public',
      accessReason: ACCESS_REASON,
      version: '1',
      domain: STOREFRONT_TOOL_DOMAIN,
      readOnly: true,
      description:
        'Propone agendar un servicio publicado (id de storefront_search_products). NO crea la reserva: muestra una tarjeta que lleva al cliente a la página de reservas de la tienda para elegir fecha y hora.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: { product_id: { type: 'integer', minimum: 1 } },
        required: ['product_id'],
      },
      handler: async (args: { product_id: number }) => {
        const product = (await loadByIds(deps, [Number(args.product_id)])).get(
          Number(args.product_id),
        );
        if (!product)
          return fail(
            'Ese servicio no está publicado en esta tienda.',
            'Busca el servicio con storefront_search_products; no inventes ids.',
          );
        if (!isService(product))
          return fail(
            `"${product.name}" no es un servicio con reserva.`,
            'Para productos usa storefront_propose_order.',
          );
        const card: StorefrontCard = {
          kind: 'booking',
          product_id: Number(product.id),
          name: product.name,
          slug: product.slug ?? null,
        };
        emit(card);
        return JSON.stringify({
          ok: true,
          card,
          next_step:
            'Dile al cliente que toque la tarjeta para elegir fecha y hora. No confirmes la cita: la confirma la página de reservas.',
        });
      },
    },
    {
      name: 'storefront_propose_request',
      access: 'public',
      accessReason: ACCESS_REASON,
      version: '1',
      domain: STOREFRONT_TOOL_DOMAIN,
      readOnly: true,
      description:
        'Prepara una petición, queja, reclamo o sugerencia (PQR) para la tienda. NO la radica: muestra una tarjeta donde el cliente confirma nombre y correo y recibe su número de radicado.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pqr_type: { type: 'string', enum: [...PQR_TYPES] },
          subject: { type: 'string', minLength: 3, maxLength: 120 },
          description: { type: 'string', minLength: 10, maxLength: 2000 },
        },
        required: ['pqr_type', 'subject', 'description'],
      },
      handler: async (args: {
        pqr_type: (typeof PQR_TYPES)[number];
        subject: string;
        description: string;
      }) => {
        if (!PQR_TYPES.includes(args.pqr_type))
          return fail('Tipo de PQR inválido.', `Usa uno de: ${PQR_TYPES.join(', ')}.`);
        const card: StorefrontCard = {
          kind: 'request',
          pqr_type: args.pqr_type,
          subject: String(args.subject).trim().slice(0, 120),
          description: String(args.description).trim().slice(0, 2000),
        };
        emit(card);
        return JSON.stringify({
          ok: true,
          card,
          next_step:
            'Dile al cliente que complete su nombre y correo en la tarjeta y la envíe; ahí recibe su radicado.',
        });
      },
    },
  ];
}

/**
 * Per-turn card sink. The public chat service runs the agent inside
 * `storefrontCardSink.run([], ...)`; each successful `storefront_propose_*`
 * pushes its card here, so the cards reach the visitor exactly as built
 * (never re-parsed from a possibly compacted tool result).
 */
export const storefrontCardSink = new AsyncLocalStorage<StorefrontCard[]>();

function emit(card: StorefrontCard): void {
  storefrontCardSink.getStore()?.push(card);
}
