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
  if (Array.isArray(matrix)) {
    return matrix.map((f: any) => ({
      key: f.key ?? '',
      label: f.label ?? f.key ?? '',
      enabled: f.enabled ?? true,
      limit: f.limit ?? null,
      unit: f.unit ?? null,
    }));
  }
  if (matrix && typeof matrix === 'object') {
    return Object.entries(matrix as Record<string, any>)
      .filter(([k]) => !k.startsWith('cost_') && !k.startsWith('partner_') && !k.startsWith('internal_'))
      .map(([k, val]) => {
        const enabled = typeof val === 'boolean' ? val : true;
        let label = FEATURE_HUMAN_LABELS[k] || k.replace(/_/g, ' ');
        let limit: number | null = null;
        if (typeof val === 'object' && val !== null) {
          if ('max' in val) {
            limit = val.max;
            label = val.max === null ? `${label} Ilimitadas` : `Hasta ${val.max} ${label}`;
          } else if ('channel' in val) {
            label = `Soporte ${val.channel === 'priority' ? 'Prioritario WhatsApp' : val.channel === 'dedicated' ? 'VIP Dedicado 4h' : 'Estándar'}`;
          }
        }
        return {
          key: k,
          label,
          enabled,
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
    }));
  }
}
