import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import {
  AppDomainAlias,
  parseAppDomainAliases,
} from '../shared/app-domain-aliases';
import { sellableProductsWhere } from '../product-page/product-page.reader';

/** Longest offer title the landing shows. */
export const MAX_OFFER_TITLE = 120;
/** Longest offer description the landing shows. */
export const MAX_OFFER_DESCRIPTION = 400;

/**
 * - `info`: the offer only captures the lead (the landing contact form).
 * - `product`: one product with a buy button, through the shared cart and
 *   checkout of the other apps.
 */
export type LandingOfferMode = 'info' | 'product';

/** Shape of `store_apps.config` for `kind = 'landing'` (Fase 6). */
export interface LandingPageConfig {
  offer_mode: LandingOfferMode;
  offer_title: string | null;
  offer_description: string | null;
  /** Only read when `offer_mode = 'product'`. */
  offer_product_id: number | null;
  /**
   * When the landing is published on one of the store's custom domains, the
   * `app_type` that domain had before, so unpublishing gives it back.
   */
  custom_domain_previous_app_type?: string | null;
  /**
   * Apps F5: the store's own domains that also serve this app, besides its
   * primary Vendix subdomain (`shared/app-domain-aliases.ts`).
   */
  custom_domain_aliases?: AppDomainAlias[];
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}

/** Parses the stored JSON defensively. */
export function parseLandingPageConfig(raw: unknown): LandingPageConfig {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const productId = obj.offer_product_id;
  const previous = obj.custom_domain_previous_app_type;
  return {
    offer_mode: obj.offer_mode === 'product' ? 'product' : 'info',
    offer_title: text(obj.offer_title, MAX_OFFER_TITLE),
    offer_description: text(obj.offer_description, MAX_OFFER_DESCRIPTION),
    offer_product_id:
      typeof productId === 'number' && Number.isInteger(productId)
        ? productId
        : null,
    custom_domain_previous_app_type:
      typeof previous === 'string' ? previous : null,
    custom_domain_aliases: parseAppDomainAliases(raw),
  };
}

export interface PublishedLandingOffer {
  mode: LandingOfferMode;
  title: string;
  description: string | null;
  /** Present only in `product` mode while the product is still sold online. */
  product: { id: number; slug: string; name: string } | null;
}

export interface PublishedLandingPage {
  /** Hostname of the landing's own (primary) domain. */
  hostname: string;
  /**
   * Apps F5: the primary hostname plus its active aliases. The landing and
   * its offer show on any of them, never on `{tienda}-store`.
   */
  hostnames: string[];
  offer: PublishedLandingOffer;
}

/**
 * The offer the landing shows. A product offer whose product stopped being
 * sold online degrades to an informative one instead of a broken buy button.
 */
export function resolveLandingOffer(
  config: LandingPageConfig,
  product: { id: number; slug: string; name: string } | null,
): PublishedLandingOffer {
  const sellsProduct = config.offer_mode === 'product' && !!product;
  return {
    mode: sellsProduct ? 'product' : 'info',
    title:
      config.offer_title ??
      (sellsProduct ? product!.name : 'Déjanos tus datos y te contactamos'),
    description: config.offer_description,
    product: sellsProduct ? product : null,
  };
}

/**
 * The landing published as an app on its own domain. `null` when the app is
 * not published there, the domain is not active, or the landing has no
 * published content in "Landing de captación" (the content always comes from
 * `crm_landing_pages`, unchanged). Tenant comes only from `storeId`.
 */
export async function readPublishedLandingPage(
  prisma: GlobalPrismaService,
  storeId: number,
): Promise<PublishedLandingPage | null> {
  const app = await prisma.store_apps.findFirst({
    where: { store_id: storeId, kind: 'landing', status: 'published' },
    select: {
      config: true,
      domain_settings: { select: { hostname: true, status: true } },
    },
  });
  if (!app?.domain_settings || app.domain_settings.status !== 'active') {
    return null;
  }

  const content = await prisma.crm_landing_pages.findFirst({
    where: { store_id: storeId },
    select: { enabled: true, published_json: true },
  });
  if (!content?.enabled || !content.published_json) return null;

  const config = parseLandingPageConfig(app.config);
  const product =
    config.offer_mode === 'product' && config.offer_product_id
      ? await prisma.products.findFirst({
          where: sellableProductsWhere(storeId, [config.offer_product_id]),
          select: { id: true, slug: true, name: true },
        })
      : null;

  const aliasIds = (config.custom_domain_aliases ?? []).map((a) => a.domain_id);
  const aliases = aliasIds.length
    ? await prisma.domain_settings.findMany({
        where: {
          id: { in: aliasIds },
          store_id: storeId,
          app_type: 'STORE_LANDING',
          status: 'active',
        },
        select: { hostname: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const hostname = app.domain_settings.hostname.toLowerCase();

  return {
    hostname,
    hostnames: [hostname, ...aliases.map((a) => a.hostname.toLowerCase())],
    offer: resolveLandingOffer(config, product),
  };
}
