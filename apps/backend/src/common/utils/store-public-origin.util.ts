import type { app_type_enum } from '@prisma/client';

/** Public apps that serve the `/pagar/:token` page, in order of preference. */
const PUBLIC_PAYMENT_APPS: readonly app_type_enum[] = [
  'STORE_ECOMMERCE',
  'STORE_BOOKING',
  'STORE_LANDING',
  'STORE_HOME',
  'STORE_SERVICE_PAGE',
  'STORE_PRODUCT_PAGE',
];

interface DomainReader {
  domain_settings: {
    findMany(args: {
      where: { store_id: number; status: 'active'; app_type: { in: app_type_enum[] } };
      select: { hostname: true; app_type: true };
    }): Promise<Array<{ hostname: string; app_type: app_type_enum | string }>>;
  };
}

/**
 * Public origin (`https://<host>`) where the store's customers open a payment
 * page: the active e-commerce domain, else another active public app. Never the
 * admin host, whose app has no `/pagar` route. Null when none exists or the
 * lookup fails (callers keep the relative path).
 */
export async function resolveStorePublicOrigin(prisma: DomainReader, storeId: number): Promise<string | null> {
  try {
    const rows = await prisma.domain_settings.findMany({
      where: { store_id: storeId, status: 'active', app_type: { in: [...PUBLIC_PAYMENT_APPS] } },
      select: { hostname: true, app_type: true },
    });
    for (const app of PUBLIC_PAYMENT_APPS) {
      const row = rows.find((r) => r.app_type === app && r.hostname);
      if (row) return `https://${row.hostname}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function publicPaymentUrl(origin: string | null, paymentPath: string): string | null {
  return origin ? `${origin}${paymentPath}` : null;
}
