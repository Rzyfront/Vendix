import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';

/**
 * Public feature keys exposed to unauthenticated callers.
 * NEVER include cost_*, partner_*, internal_*, max_partner_margin_pct,
 * resellable, promo_rules, or billing internals.
 */
const PUBLIC_AI_FEATURE_KEYS = [
  'text_generation',
  'streaming_chat',
  'conversations',
  'tool_agents',
  'rag_embeddings',
  'async_queue',
] as const;

/**
 * Strips sensitive fields from ai_feature_flags / feature_matrix,
 * returning only the keys safe for public consumption.
 */
function pickPublicFeatures(
  matrix: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!matrix || typeof matrix !== 'object') return {};
  return Object.fromEntries(
    PUBLIC_AI_FEATURE_KEYS.filter((key) => key in matrix).map((key) => [
      key,
      matrix[key],
    ]),
  );
}

export interface PublicPlanFeatureDto {
  key: string;
  label: string;
  enabled: boolean;
  /** Short qualifier shown next to the label ("Ilimitados", "1 usuario"). */
  value?: string | null;
  /** true renders the item as partially included ("limitado"). */
  is_limited?: boolean;
  limit?: number | null;
  unit?: string | null;
}

export interface PublicPlanDto {
  id: number;
  code: string;
  name: string;
  description: string | null;
  plan_type: string;
  billing_cycle: string;
  base_price: number;
  currency: string;
  is_popular: boolean;
  is_promotional: boolean;
  sort_order: number;
  features: PublicPlanFeatureDto[];
  ai_features: Record<string, unknown>;
  /** Long-form markdown written by the super-admin; rendered in the landing
   *  "Ver todo lo que incluye" detail. */
  details_md: string | null;
  /** Multi-cycle group key: every billing cycle of the same plan shares it. */
  plan_group_code: string | null;
}

const FEATURE_HUMAN_LABELS: Record<string, string> = {
  pos: 'Punto de Venta POS (Online/Offline)',
  ecommerce: 'Tienda Online & Pedidos WhatsApp',
  accounting: 'Facturación Electrónica DIAN',
  inventory: 'Gestión de Inventario en Tiempo Real',
  inventory_advanced: 'Inventario Multi-bodega & Traslados',
  stores: 'Sucursales / Tiendas',
  users: 'Usuarios con Roles',
  support: 'Soporte Técnico',
  integrations: 'Integraciones ERP & API',
};

function parseFeatureMatrix(matrix: unknown): PublicPlanFeatureDto[] {
  // Canonical shape: array of items edited by the super-admin.
  if (Array.isArray(matrix)) {
    const seen = new Set<string>();
    const items: PublicPlanFeatureDto[] = [];

    matrix.forEach((f: any, index: number) => {
      // An item without a resolvable label has nothing to render: drop it
      // instead of publishing an empty bullet.
      const label = String(f?.label ?? f?.key ?? '').trim();
      if (!label) return;

      // A missing key still needs a stable identity so the public comparison
      // table can key rows; derive it from the position.
      const key = String(f?.key ?? '').trim() || `item-${index + 1}`;
      // Duplicated keys would render the same row twice: first one wins.
      if (seen.has(key)) return;
      seen.add(key);

      items.push({
        key,
        label,
        enabled: f?.enabled ?? true,
        value: f?.value ?? null,
        is_limited: f?.is_limited === true,
        limit: f?.limit ?? null,
        unit: f?.unit ?? null,
      });
    });

    return items;
  }

  // Legacy object shape (`{ pos: true, users: { max: 3 } }`): read-only
  // compatibility for rows created before the array contract.
  if (matrix && typeof matrix === 'object') {
    return Object.entries(matrix as Record<string, any>)
      .filter(([k]) => !k.startsWith('cost_') && !k.startsWith('partner_') && !k.startsWith('internal_'))
      .map(([k, val]) => {
        const enabled = typeof val === 'boolean' ? val : true;
        let label = FEATURE_HUMAN_LABELS[k] || k.replace(/_/g, ' ');
        let limit: number | null = null;
        let value: string | null = null;
        let isLimited = false;
        if (typeof val === 'object' && val !== null) {
          if ('max' in val) {
            limit = val.max;
            label = val.max === null ? `${label} Ilimitadas` : `Hasta ${val.max} ${label}`;
            // A numeric cap is the legacy way of saying "limitado"; a null cap
            // is unlimited, so it stays fully included. `value` stays null on
            // purpose: the legacy label already embeds the cap ("Hasta 3 ..."),
            // and emitting it again would render the number twice on the card.
            isLimited = val.max !== null;
          } else if ('channel' in val) {
            label = `Soporte ${val.channel === 'priority' ? 'Prioritario WhatsApp' : val.channel === 'dedicated' ? 'VIP Dedicado 4h' : 'Estándar'}`;
          }
        }
        return {
          key: k,
          label,
          enabled,
          value,
          is_limited: isLimited,
          limit,
          unit: null,
        };
      });
  }
  return [];
}

/**
 * 📦 PublicPlansService
 *
 * Returns only the active, non-archived subscription plans with
 * a whitelist of public-safe fields. Sensitive fields such as
 * cost_multiplier, partner_overrides, resellable, promo_rules, and
 * max_partner_margin_pct are intentionally excluded.
 */
@Injectable()
export class PublicPlansService {
  private readonly logger = new Logger(PublicPlansService.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  async findAll(): Promise<PublicPlanDto[]> {
    this.logger.log('Fetching public subscription plans');

    const plans = await this.globalPrisma.subscription_plans.findMany({
      where: {
        state: 'active',
        archived_at: null,
        resellable: true,
        is_promotional: false,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        plan_type: true,
        billing_cycle: true,
        base_price: true,
        currency: true,
        is_popular: true,
        is_promotional: true,
        sort_order: true,
        ai_feature_flags: true,
        feature_matrix: true,
        details_md: true,
        plan_group_code: true,
      },
      orderBy: [{ sort_order: 'asc' }, { base_price: 'asc' }],
    });

    return plans.map((plan) => ({
      id: plan.id,
      code: plan.code,
      name: plan.name,
      description: plan.description,
      plan_type: plan.plan_type,
      billing_cycle: plan.billing_cycle,
      base_price: Number(plan.base_price),
      currency: plan.currency,
      is_popular: plan.is_popular,
      is_promotional: plan.is_promotional,
      sort_order: plan.sort_order,
      features: parseFeatureMatrix(plan.feature_matrix),
      ai_features: pickPublicFeatures(
        plan.ai_feature_flags as Record<string, unknown> | null,
      ),
      details_md: plan.details_md,
      plan_group_code: plan.plan_group_code,
    }));
  }
}
