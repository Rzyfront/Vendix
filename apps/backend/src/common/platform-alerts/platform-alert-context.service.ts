import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import type { AlertEntityType } from './platform-alert-catalog';
import {
  contextLines,
  readStoredContext,
  scopeLabelOf,
  type AlertNames,
  type StoreName,
  type UserName,
} from './platform-alert-format';
import type {
  PlatformAlertRow,
  ResolvedAlertContext,
} from './platform-alert.types';

/** Un nombre cambia poco: 5 min de caché bastan para una tormenta de alertas. */
const NAME_TTL_MS = 5 * 60_000;
/** El cupo sí cambia: se relee al minuto. */
const USAGE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 2_000;
/** Si la base está lenta (justo cuando hay alertas) la alerta sale con ids. */
const LOOKUP_TIMEOUT_MS = 1_500;

const AI_FEATURE_LABELS: Record<string, string> = {
  rag_embeddings: 'indexación para la búsqueda con IA',
  text_generation: 'tokens de generación con IA',
  streaming_chat: 'mensajes de chat con IA',
  tool_agents: 'acciones del agente',
  async_queue: 'trabajos de IA en segundo plano',
  realtime_voice: 'segundos de voz con IA',
  vex_agent: 'acciones de Vex',
};

type AlertLike = Pick<
  PlatformAlertRow,
  'id' | 'organization_id' | 'store_id' | 'affected_store_ids' | 'details'
>;

interface UsageEntry {
  used: number;
  cap: number | null;
  period: 'daily' | 'monthly';
}

/** Lo único que se usa de `SubscriptionAccessService`. */
interface AIUsageReader {
  getAIUsageSnapshot(storeId: number): Promise<Partial<Record<string, UsageEntry>>>;
}

class LookupTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms = LOOKUP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LookupTimeout(`más de ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function fullName(first?: string | null, last?: string | null): string | null {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || null;
}

const NUMBER = new Intl.NumberFormat('es-CO');

/**
 * Resuelve los nombres de una alerta (QUI-1031, S1/S4/S5): tienda (nombre +
 * slug), organización, usuario (nombre + correo), registro afectado, y en un
 * «Límite de plan» el plan de la tienda y el cupo consumido.
 *
 * Nunca lanza: cada búsqueda tiene tiempo máximo y lo que falle queda con su
 * id. La caché es en memoria y corta; solo se guarda lo que la base respondió
 * (también «no existe»), nunca un fallo.
 */
@Injectable()
export class PlatformAlertContextService {
  private readonly logger = new Logger(PlatformAlertContextService.name);
  private readonly cache = new Map<string, { value: unknown; expiresAt: number }>();
  private usageReader: AIUsageReader | null | undefined;

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly config: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async resolve(alert: AlertLike): Promise<ResolvedAlertContext> {
    const [resolved] = await this.resolveMany([alert]);
    return resolved;
  }

  /** Varias alertas (lista de Superadmin) con una consulta por tipo de nombre. */
  async resolveMany(alerts: readonly AlertLike[]): Promise<ResolvedAlertContext[]> {
    const storeIds = new Set<number>();
    const orgIds = new Set<number>();
    const userIds = new Set<number>();
    for (const alert of alerts) {
      if (alert.store_id) storeIds.add(alert.store_id);
      if (alert.organization_id) orgIds.add(alert.organization_id);
      for (const id of (alert.affected_store_ids ?? []).slice(0, 11)) storeIds.add(id);
      const userId = readStoredContext(alert.details).userId;
      if (userId) userIds.add(userId);
    }
    const [stores, organizations, users] = await Promise.all([
      this.lookupMany<StoreName>('store', storeIds, (ids) => this.findStores(ids)),
      this.lookupMany<string>('org', orgIds, (ids) => this.findOrganizations(ids)),
      this.lookupMany<UserName>('user', userIds, (ids) => this.findUsers(ids)),
    ]);
    return Promise.all(
      alerts.map(async (alert) => {
        try {
          const context = readStoredContext(alert.details);
          const names: AlertNames = { stores, organizations, users };
          if (context.entityType && context.entityId) {
            names.entityName = await this.entityName(context.entityType, context.entityId);
          }
          if (context.category === 'plan_limit' && alert.store_id) {
            names.plan = await this.planName(alert.store_id);
            names.quota = await this.quota(alert.store_id, context.aiFeature ?? null);
          }
          return {
            lines: contextLines(alert, names),
            scopeLabel: scopeLabelOf(alert, names),
            superadminUrl: this.superadminUrl(alert.id),
          };
        } catch (error) {
          this.logger.warn(`Contexto de la alerta #${alert.id} sin nombres: ${(error as Error)?.message}`);
          return {
            lines: contextLines(alert),
            scopeLabel: scopeLabelOf(alert),
            superadminUrl: this.superadminUrl(alert.id),
          };
        }
      }),
    );
  }

  /** Detalle de la alerta en Superadmin (abre el modal con `?alert=<id>`). */
  superadminUrl(alertId: number): string | null {
    const base = String(this.config.get<string>('FRONTEND_URL') ?? '')
      .trim()
      .replace(/\/+$/, '');
    return base ? `${base}/super-admin/monitoring/alerts?alert=${alertId}` : null;
  }

  // ---------------------------------------------------------------------------
  // Búsquedas
  // ---------------------------------------------------------------------------

  private async findStores(ids: number[]): Promise<Map<number, StoreName>> {
    const rows = await this.prisma.stores.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, slug: true },
    });
    return new Map(rows.map((r) => [r.id, { name: r.name, slug: r.slug ?? null }]));
  }

  private async findOrganizations(ids: number[]): Promise<Map<number, string>> {
    const rows = await this.prisma.organizations.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async findUsers(ids: number[]): Promise<Map<number, UserName>> {
    const rows = await this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, first_name: true, last_name: true, username: true, email: true },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        { name: fullName(r.first_name, r.last_name) ?? r.username ?? null, email: r.email ?? null },
      ]),
    );
  }

  private entityName(type: AlertEntityType, id: number): Promise<string | null> {
    return this.lookupOne<string>(`entity:${type}`, id, NAME_TTL_MS, () =>
      this.findEntityName(type, id),
    );
  }

  private async findEntityName(type: AlertEntityType, id: number): Promise<string | null> {
    const where = { where: { id } };
    switch (type) {
      case 'product':
        return (await this.prisma.products.findFirst({ ...where, select: { name: true } }))?.name ?? null;
      case 'customer': {
        const user = await this.prisma.users.findFirst({
          ...where,
          select: { first_name: true, last_name: true, username: true },
        });
        return user ? (fullName(user.first_name, user.last_name) ?? user.username ?? null) : null;
      }
      case 'order':
        return (await this.prisma.orders.findFirst({ ...where, select: { order_number: true } }))?.order_number ?? null;
      case 'purchase_order':
        return (
          (await this.prisma.purchase_orders.findFirst({ ...where, select: { order_number: true } }))
            ?.order_number ?? null
        );
      case 'supplier':
        return (await this.prisma.suppliers.findFirst({ ...where, select: { name: true } }))?.name ?? null;
      case 'expense':
        return (
          (await this.prisma.expenses.findFirst({ ...where, select: { description: true } }))
            ?.description ?? null
        );
      case 'received_document':
        return (
          (await this.prisma.received_documents.findFirst({ ...where, select: { invoice_number: true } }))
            ?.invoice_number ?? null
        );
      case 'subscription_invoice':
        return (
          (await this.prisma.subscription_invoices.findFirst({ ...where, select: { invoice_number: true } }))
            ?.invoice_number ?? null
        );
      default:
        // Registros sin un nombre útil (configuración DIAN, asiento fallido…): solo el id.
        return null;
    }
  }

  private planName(storeId: number): Promise<string | null> {
    return this.lookupOne<string>('plan', storeId, USAGE_TTL_MS, async () => {
      const subscription = await this.prisma.store_subscriptions.findFirst({
        where: { store_id: storeId },
        select: { state: true, plan: { select: { name: true, code: true } } },
      });
      if (!subscription) return 'sin suscripción';
      const plan = subscription.plan
        ? `${subscription.plan.name} (${subscription.plan.code})`
        : 'sin plan asignado';
      return `${plan} · estado ${subscription.state}`;
    });
  }

  /**
   * Cupo consumido: el de la funcionalidad que se agotó o, si no se sabe cuál,
   * las que ya llegaron a su tope.
   */
  private quota(storeId: number, aiFeature: string | null): Promise<string | null> {
    return this.lookupOne<string>(`quota:${aiFeature ?? '*'}`, storeId, USAGE_TTL_MS, async () => {
      const reader = await this.aiUsageReader();
      if (!reader) return null;
      const snapshot = await reader.getAIUsageSnapshot(storeId);
      const entries = Object.entries(snapshot).filter(
        (pair): pair is [string, UsageEntry] => {
          const [feature, entry] = pair;
          if (!entry) return false;
          return aiFeature ? feature === aiFeature : entry.cap !== null && entry.used >= entry.cap;
        },
      );
      if (entries.length === 0) return null;
      return entries
        .map(([feature, entry]) => {
          const cap = entry.cap === null ? 'sin tope' : NUMBER.format(entry.cap);
          const period = entry.period === 'daily' ? 'hoy' : 'este mes';
          return `${NUMBER.format(entry.used)} de ${cap} ${AI_FEATURE_LABELS[feature] ?? feature} (${period})`;
        })
        .join('; ');
    });
  }

  /**
   * `SubscriptionAccessService` se carga al primer «Límite de plan»: importarlo
   * arriba arrastraría todo el dominio de suscripciones a cada consumidor del
   * monitor (y suscripciones también reporta alertas).
   */
  private async aiUsageReader(): Promise<AIUsageReader | null> {
    if (this.usageReader !== undefined) return this.usageReader;
    try {
      const { SubscriptionAccessService } = await import(
        '../../domains/store/subscriptions/services/subscription-access.service'
      );
      this.usageReader = this.moduleRef.get<AIUsageReader>(SubscriptionAccessService, {
        strict: false,
      });
    } catch (error) {
      this.logger.warn(`Cupo de IA no disponible para las alertas: ${(error as Error)?.message}`);
      this.usageReader = null;
    }
    return this.usageReader;
  }

  // ---------------------------------------------------------------------------
  // Caché
  // ---------------------------------------------------------------------------

  private cached<T>(key: string): { hit: boolean; value: T | null } {
    const entry = this.cache.get(key);
    if (!entry) return { hit: false, value: null };
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return { hit: false, value: null };
    }
    return { hit: true, value: entry.value as T | null };
  }

  private remember(key: string, value: unknown, ttlMs: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /** Una búsqueda; un fallo o tiempo agotado da `null` sin quedar en caché. */
  private async lookupOne<T>(
    kind: string,
    id: number,
    ttlMs: number,
    load: () => Promise<T | null>,
  ): Promise<T | null> {
    const key = `${kind}:${id}`;
    const hit = this.cached<T>(key);
    if (hit.hit) return hit.value;
    try {
      const value = await withTimeout(load());
      this.remember(key, value, ttlMs);
      return value;
    } catch (error) {
      this.logger.warn(`Nombre ${key} no resuelto: ${(error as Error)?.message}`);
      return null;
    }
  }

  /** Varios ids de un tipo en una consulta; los que falten quedan como «no existe». */
  private async lookupMany<T>(
    kind: string,
    ids: ReadonlySet<number>,
    load: (ids: number[]) => Promise<Map<number, T>>,
  ): Promise<Map<number, T | null>> {
    const out = new Map<number, T | null>();
    const missing: number[] = [];
    for (const id of ids) {
      const hit = this.cached<T>(`${kind}:${id}`);
      if (hit.hit) out.set(id, hit.value);
      else missing.push(id);
    }
    if (missing.length === 0) return out;
    try {
      const found = await withTimeout(load(missing));
      for (const id of missing) {
        const value = found.get(id) ?? null;
        this.remember(`${kind}:${id}`, value, NAME_TTL_MS);
        out.set(id, value);
      }
    } catch (error) {
      this.logger.warn(`Nombres de ${kind} no resueltos: ${(error as Error)?.message}`);
    }
    return out;
  }
}
